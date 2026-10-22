import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../modules/usage-report.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.summarizeUsage = summarizeUsage;', sandbox);

const rows = [
  {
    sessionId: 'a',
    title: 'A',
    model: {provider: 'p', model: 'm1'},
    usage: {uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 20},
    context: {contextWindow: 1000, pressureTokens: 250, surfaceTokens: 500},
    stats: {turns: 2, steps: 4, llmMs: 100, toolMs: 50, ttftMs: 10, decodeMs: 20},
  },
  {
    sessionId: 'b',
    model: {provider: 'p', model: 'm2'},
    usage: {uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0},
  },
  {sessionId: 'c', unavailable: true},
];

test('usage totals, cache hit rate, pressure and priced cost are computed from native fields', () => {
  const report = sandbox.summarizeUsage(rows, {m1: {input: 2, output: 4, cacheRead: 0.5, cacheWrite: 1}});
  const first = report.sessions[0];
  assert.equal(first.totalTokens, 470);
  assert.equal(first.cacheHitRate, 0.75);
  assert.equal(first.context.pressurePercent, 0.25);
  assert.equal(first.cost, (100 * 2 + 50 * 4 + 300 * 0.5 + 20 * 1) / 1e6);
  assert.equal(report.sessions[1].cost, null);
  assert.equal(report.totals.totalTokens, 485);
  assert.equal(report.totals.cost, first.cost);
  assert.equal(report.totals.pricedSessions, 1);
  assert.equal(report.totals.unpricedSessions, 1);
  assert.equal(report.pricing.provided, true);
});

test('without configured pricing cost stays null instead of inventing a rate', () => {
  const report = sandbox.summarizeUsage(rows, {});
  assert(report.sessions.filter((row) => !row.unavailable).every((row) => row.cost === null));
  assert.equal(report.totals.cost, null);
  assert.equal(report.pricing.provided, false);
  assert.equal(report.sessions[2].unavailable, true);
});
