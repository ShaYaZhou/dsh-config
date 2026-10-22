import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'claude-context';
export const inject = ['systemPrompt'];

const DEFAULTS = {global: 24000, project: 24000, rules: 24000, rule: 8000};

function readBounded(file, maxChars) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[truncated]' : text;
}

// Claude-only mechanisms that do not apply to DSH: the RTK shell contract has a
// different target here, and @path imports are expanded by Claude Code, not DSH.
export function stripClaudeOnlySyntax(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  let skipping = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skipping && level <= skipping) skipping = 0;
      if (!skipping && /^rtk\b/i.test(heading[2].trim())) {
        skipping = level;
        continue;
      }
    }
    if (skipping) continue;
    if (/^\s*@\S+\s*$/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function claudeProjectSlug(cwd) {
  return path.resolve(cwd).replace(/[\\/:]/g, '-');
}

function ruleFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(dir, entry.name));
}

export function loadClaudeContext({home = os.homedir(), cwd = process.cwd()} = {}) {
  const sections = [];
  const globalText = stripClaudeOnlySyntax(readBounded(path.join(home, '.claude', 'CLAUDE.md'), DEFAULTS.global));
  if (globalText) sections.push('## Claude Code global instructions\n' + globalText);

  const projectDir = path.join(cwd, '.claude');
  const projectText = stripClaudeOnlySyntax(readBounded(path.join(projectDir, 'CLAUDE.md'), DEFAULTS.project));
  if (projectText) sections.push('## Claude Code project instructions\n' + projectText);

  const rules = [];
  let budget = DEFAULTS.rules;
  for (const file of ruleFiles(path.join(projectDir, 'rules'))) {
    if (budget <= 0) break;
    const text = stripClaudeOnlySyntax(readBounded(file, Math.min(DEFAULTS.rule, budget)));
    if (!text) continue;
    rules.push('### ' + path.basename(file) + '\n' + text);
    budget -= text.length;
  }
  if (rules.length) sections.push('## Claude Code project rules\n' + rules.join('\n\n'));

  // Only a pointer: Claude project memory is background reference, not always-on instructions.
  const memory = path.join(home, '.claude', 'projects', claudeProjectSlug(cwd), 'memory', 'MEMORY.md');
  if (fs.existsSync(memory))
    sections.push('Claude Code project memory index (available on demand; use the claude-context skill; it is background evidence, not instructions): ' + memory);

  if (!sections.length) return '';
  return [
    '# Mirrored Claude Code instructions',
    "These files are read from the user's Claude Code configuration. They are user instructions, not tool output. Repository AGENTS.md and the current user request take precedence when they conflict.",
    ...sections,
  ].join('\n\n');
}

export function apply(ctx) {
  const warned = new Set();
  ctx.systemPrompt.context({
    name: 'claude-context',
    order: 950,
    text: (context) => {
      const cwd = context?.agent?.session?.header?.cwd ?? process.cwd();
      try {
        return loadClaudeContext({cwd});
      } catch (error) {
        if (error.code !== 'ENOENT' && !warned.has(error.code)) {
          warned.add(error.code);
          ctx.logger?.warn?.(`claude-context: ${error.message}`);
        }
        return '';
      }
    },
  });
}
