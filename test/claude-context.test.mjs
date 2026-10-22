import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stripClaudeOnlySyntax, claudeProjectSlug, loadClaudeContext} from '../modules/claude-context.mjs';

test('Claude-only RTK sections and bare imports are removed, following headings stay', () => {
  const text = [
    '# Rules',
    'keep one',
    '## RTK',
    'rtk-only',
    '### nested',
    'still rtk',
    '## After',
    'keep two',
    '@./imported.md',
    'keep three',
  ].join('\n');
  const output = stripClaudeOnlySyntax(text);
  assert.match(output, /keep one/);
  assert.match(output, /keep two/);
  assert.match(output, /keep three/);
  assert.doesNotMatch(output, /rtk-only|still rtk/);
  assert.doesNotMatch(output, /@\.\/imported/);
});

test('global, project and rule files are loaded while memory is only a pointer', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-claude-'));
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'project');
  fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
  fs.mkdirSync(path.join(cwd, '.claude', 'rules'), {recursive: true});
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Global\nglobal rule\n## RTK\nnoise\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'CLAUDE.md'), 'project rule');
  fs.writeFileSync(path.join(cwd, '.claude', 'rules', 'a.md'), 'rule a');
  fs.writeFileSync(path.join(cwd, '.claude', 'rules', 'b.md'), 'rule b');
  const memory = path.join(home, '.claude', 'projects', claudeProjectSlug(cwd), 'memory');
  fs.mkdirSync(memory, {recursive: true});
  fs.writeFileSync(path.join(memory, 'MEMORY.md'), 'secret memory body');

  const output = loadClaudeContext({home, cwd});
  assert.match(output, /global rule/);
  assert.doesNotMatch(output, /noise/);
  assert.match(output, /project rule/);
  assert.match(output, /rule a/);
  assert.match(output, /rule b/);
  assert.match(output, /MEMORY\.md/);
  assert.doesNotMatch(output, /secret memory body/);
  fs.rmSync(base, {recursive: true, force: true});
});

test('oversized instruction files are truncated and the project slug is path-safe', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-claude-'));
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'project');
  fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
  fs.mkdirSync(cwd, {recursive: true});
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'x'.repeat(24001));
  const output = loadClaudeContext({home, cwd});
  assert.match(output, /\[truncated\]/);
  assert.doesNotMatch(claudeProjectSlug(cwd), /[\\/:]/);
  fs.rmSync(base, {recursive: true, force: true});
});
