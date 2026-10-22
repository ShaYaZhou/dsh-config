import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scanText, scanPath} from '../skills/security-review/scan.mjs';

const fakeKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const fakePassword = 'hunter2hunter2';

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
