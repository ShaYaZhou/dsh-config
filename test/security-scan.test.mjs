import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {scanText, scanPath} from '../skills/security-review/scan.mjs';

const fakeKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const fakePassword = 'hunter2hunter2';
const cli = fileURLToPath(new URL('../skills/security-review/scan.mjs', import.meta.url));

test('secrets are reported with line numbers and redacted; placeholders are ignored', () => {
  const text = [
    `const key = "${fakeKey}";`,
    `const password = "${fakePassword}";`,
    'const password = "example";',
    'eval("x")',
  ].join('\n');
  const findings = scanText(text, 'sample.js');
  const aws = findings.find((row) => row.rule === 'aws-access-key');
  assert.equal(aws.line, 1);
  assert.equal(aws.severity, 'high');
  assert.equal(aws.match, '[redacted]');
  assert.doesNotMatch(aws.preview, new RegExp(fakeKey));
  const password = findings.find((row) => row.rule === 'hardcoded-secret');
  assert.equal(password.line, 2);
  assert.doesNotMatch(password.preview, new RegExp(fakePassword));
  assert(!findings.some((row) => row.line === 3));
  assert(findings.some((row) => row.rule === 'dynamic-code' && row.line === 4));
  assert.equal(findings.filter((row) => row.rule === 'aws-access-key').length, 1);
  assert.equal(findings.filter((row) => row.rule === 'hardcoded-secret').length, 1);
});

test('directory scans skip dependency and build directories', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-'));
  fs.mkdirSync(path.join(base, 'node_modules', 'pkg'), {recursive: true});
  fs.mkdirSync(path.join(base, 'src'), {recursive: true});
  fs.writeFileSync(path.join(base, 'node_modules', 'pkg', 'index.js'), `const key = "${fakeKey}";`);
  fs.writeFileSync(path.join(base, 'src', 'app.js'), `const token = "${fakePassword}";`);
  const report = scanPath(base);
  assert.equal(report.filesScanned, 1);
  assert(report.findings.every((row) => row.file.endsWith('app.js')));
  assert(report.skipped.some((row) => row.path.includes('node_modules')));
  assert.equal(report.counts.high + report.counts.medium + report.counts.low, report.findings.length);
  fs.rmSync(base, {recursive: true, force: true});
});

test('report keeps a stable schema for scripted gates', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-contract-'));
  fs.writeFileSync(path.join(base, 'app.js'), `const key = "${fakeKey}";`);
  const report = scanPath(base);
  assert.deepEqual(Object.keys(report).sort(), ['counts', 'filesScanned', 'findings', 'root', 'schemaVersion', 'skipped', 'truncated']);
  assert.equal(report.schemaVersion, 1);
  assert(report.findings.length > 0);
  for (const row of report.findings) assert.deepEqual(Object.keys(row).sort(), ['file', 'line', 'match', 'preview', 'rule', 'severity']);
  fs.rmSync(base, {recursive: true, force: true});
});

test('fail-on gates the exit code and rejects a missing threshold', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-clean-'));
  const dirty = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-scan-dirty-'));
  fs.writeFileSync(path.join(clean, 'ok.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dirty, 'app.js'), `const key = "${fakeKey}";`);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});
  assert.equal(run(clean, '--fail-on', 'high').status, 0);
  assert.equal(run(dirty, '--fail-on', 'high').status, 1);
  assert.equal(run(dirty, '--fail-on', 'medium').status, 1);
  assert.equal(run(dirty, '--fail-on').status, 2);
  assert.equal(run(dirty, '--fail-on=').status, 2);
  const json = run(dirty, '--json');
  assert.equal(json.status, 0);
  assert(!json.stdout.includes(fakeKey), 'raw secret must not reach stdout');
  assert.equal(JSON.parse(json.stdout).schemaVersion, 1);
  fs.rmSync(clean, {recursive: true, force: true});
  fs.rmSync(dirty, {recursive: true, force: true});
});
