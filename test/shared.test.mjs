import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {configValue} from '../plugins/shared/lib/config.js';
import {runInitializers} from '../plugins/shared/lib/remote.js';

let z;
try {
  ({z} = createRequire(path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/package.json'))('zod'));
} catch {}
const nativeTest = (name, body) => test(name, {skip: !z && 'Requires the pinned Harness Zod runtime'}, body);

test('configValue reads volatile getters and passes plain values through', () => {
  assert.equal(configValue({thresholdPercent: {get: () => 65}}, 'thresholdPercent'), 65);
  assert.equal(configValue({ultracodeDefault: true}, 'ultracodeDefault'), true);
  assert.equal(configValue({}, 'missing'), undefined);
  assert.equal(configValue(undefined, 'missing'), undefined);
});

test('runInitializers runs every collected initializer against the target', () => {
  const calls = [];
  const target = {mark: value => calls.push(value)};
  runInitializers(target, [
    function () { this.mark('first'); },
    function () { this.mark('second'); },
  ]);
  assert.deepEqual(calls, ['first', 'second']);
});

nativeTest('the shared session id schema accepts one bounded path-safe segment', () => {
  const box = {z};
  vm.createContext(box);
  vm.runInContext(
    fs
      .readFileSync(path.resolve('plugins/shared/lib/session-id.js'), 'utf8')
      .replace(/^import[^;]*;\r?\n/gm, '')
      .replace(/^export /gm, '') + '\nthis.sessionId = sessionId;',
    box,
  );
  const {sessionId} = box;
  assert.equal(sessionId.parse('session-1'), 'session-1');
  assert.equal(sessionId.parse('a'.repeat(200)).length, 200);
  for (const input of ['', 'a'.repeat(201), 'a/b', 'a b', '../x'])
    assert.throws(() => sessionId.parse(input), `expected ${JSON.stringify(input.slice(0, 12))} to be rejected`);
});
