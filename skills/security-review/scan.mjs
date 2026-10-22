#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'build', 'dist', 'out', 'coverage', '.local',
  '.next', '.nuxt', '.cache', '.venv', 'venv', 'target', '__pycache__',
]);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib', '.wasm', '.woff', '.woff2', '.ttf', '.mp4', '.mp3']);
const MAX_FILE_BYTES = 1024 * 1024;

// ponytail: static patterns only. A match is a review lead, not a confirmed vulnerability.
const RULES = [
  {id: 'private-key', severity: 'high', secret: true,
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g},
  {id: 'aws-access-key', severity: 'high', secret: true,
    re: /\bAKIA[0-9A-Z]{16}\b/g},
  {id: 'github-token', severity: 'high', secret: true,
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g},
  {id: 'slack-token', severity: 'high', secret: true,
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g},
  {id: 'bearer-token', severity: 'high', secret: true,
    re: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi},
  {id: 'url-credentials', severity: 'medium', secret: true,
    re: /:\/\/[^/\s:@]+:[^/\s@]+@/g},
  {id: 'hardcoded-secret', severity: 'medium', secret: true,
    re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi},
  {id: 'tls-verification-off', severity: 'medium', secret: false,
    re: /\brejectUnauthorized\s*:\s*false\b/g},
  {id: 'world-writable', severity: 'medium', secret: false,
    re: /\bchmod(?:Sync)?\s*\(\s*['"`]?0?777\b/g},
  {id: 'shell-enabled', severity: 'low', secret: false,
    re: /\bshell\s*:\s*true\b/g},
  {id: 'dynamic-code', severity: 'low', secret: false,
    re: /\b(?:eval|new Function)\s*\(/g},
  {id: 'inner-html', severity: 'low', secret: false,
    re: /\.(?:innerHTML|outerHTML)\s*=/g},
];

const SEVERITY_ORDER = {low: 1, medium: 2, high: 3};

function countSeverities(findings) {
  const counts = {high: 0, medium: 0, low: 0};
  for (const row of findings) if (row.severity in counts) counts[row.severity]++;
  return counts;
}

function isPlaceholder(value) {
  return /^(?:x+|\*+|\.+|-+|changeme|change-me|placeholder|example|sample|test|dummy|redacted|your[_-].*)$/i.test(value)
    || /^\$\{.*\}$/.test(value)
    || /^<.*>$/.test(value);
}

function redactLine(line, rule) {
  // A fresh regex: replace() resets lastIndex on the shared scanner regex.
  const re = new RegExp(rule.re.source, rule.re.flags);
  return line.replace(re, (...args) => {
    if (rule.id === 'hardcoded-secret') {
      const value = args[1];
      if (isPlaceholder(value)) return args[0];
      return args[0].replace(value, '[redacted]');
    }
    return rule.secret ? '[redacted]' : args[0];
  }).trim().slice(0, 240);
}

export function scanText(text, file) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      rule.re.lastIndex = 0;
      let match;
      let count = 0;
      let preview;
      while ((match = rule.re.exec(line)) !== null) {
        count += 1;
        if (rule.id === 'hardcoded-secret' && isPlaceholder(match[1])) continue;
        preview ??= redactLine(line, rule);
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: index + 1,
          match: rule.secret ? '[redacted]' : match[0].slice(0, 80),
          preview,
        });
        if (count >= 10) break;
        if (match[0] === '') rule.re.lastIndex += 1;
      }
    }
  }
  return findings;
}

function listFiles(root, maxFiles) {
  const files = [];
  const skipped = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      skipped.push({path: dir, reason: 'unreadable'});
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push({path: full, reason: 'symlink'});
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped.push({path: full, reason: 'skipped-directory'});
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        skipped.push({path: full, reason: 'unreadable'});
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({path: full, reason: 'too-large'});
        continue;
      }
      files.push(full);
    }
  };
  walk(root);
  return {files, skipped};
}

export function scanPath(target, options = {}) {
  const root = path.resolve(target);
  const maxFiles = options.maxFiles ?? 20000;
  const stat = fs.statSync(root);
  const {files, skipped} = stat.isFile()
    ? {files: [root], skipped: []}
    : listFiles(root, maxFiles);
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      skipped.push({path: file, reason: 'unreadable'});
      continue;
    }
    findings.push(...scanText(text, path.relative(root, file) || path.basename(file)));
  }
  return {
    schemaVersion: 1,
    root,
    filesScanned: files.length,
    truncated: files.length >= maxFiles,
    skipped,
    findings,
    counts: countSeverities(findings),
  };
}

function usage() {
  return [
    'Usage: node scan.mjs [paths...] [--json] [--fail-on low|medium|high] [--max-files N]',
    '',
    'Read-only static scan for likely secrets and risky patterns.',
    'A match is a review lead, not a confirmed vulnerability. Secrets are redacted.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {json: false, failOn: null, maxFiles: 20000, paths: []};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--fail-on') {
      if (index + 1 >= argv.length) throw new Error('--fail-on requires low, medium or high');
      options.failOn = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--fail-on=')) options.failOn = arg.slice('--fail-on='.length);
    else if (arg === '--max-files') {
      options.maxFiles = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--max-files=')) options.maxFiles = Number(arg.slice('--max-files='.length));
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  if (options.failOn !== null && !SEVERITY_ORDER[options.failOn]) throw new Error(`Invalid --fail-on: ${options.failOn}`);
  if (!Number.isInteger(options.maxFiles) || options.maxFiles <= 0) throw new Error('--max-files must be a positive integer');
  return options;
}

function format(report) {
  const lines = [`Scanned ${report.filesScanned} file(s) under ${report.root}`];
  if (report.truncated) lines.push('WARNING: file limit reached; results are incomplete.');
  if (!report.findings.length) lines.push('No pattern matches.');
  for (const row of report.findings)
    lines.push(`${row.severity.toUpperCase().padEnd(6)} ${row.rule}  ${row.file}:${row.line}  ${row.preview}`);
  lines.push(`Summary: ${report.counts.high} high, ${report.counts.medium} medium, ${report.counts.low} low`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const targets = options.paths.length ? options.paths : ['.'];
  const reports = targets.map((target) => scanPath(target, {maxFiles: options.maxFiles}));
  const findings = reports.flatMap((row) => row.findings);
  const report = reports.length === 1 ? reports[0] : {
    schemaVersion: 1,
    root: process.cwd(),
    filesScanned: reports.reduce((sum, row) => sum + row.filesScanned, 0),
    truncated: reports.some((row) => row.truncated),
    skipped: reports.flatMap((row) => row.skipped),
    findings,
    counts: countSeverities(findings),
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(format(report));
  if (!options.failOn) return 0;
  const threshold = SEVERITY_ORDER[options.failOn];
  return report.findings.some((row) => SEVERITY_ORDER[row.severity] >= threshold) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`scan: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
  }
}
