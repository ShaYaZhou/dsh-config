const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {withOutputLock} = require('./test-output-lock.cjs');

function assertIsolatedHome(home, production = path.join(os.homedir(), '.dsh')) {
  const canonical = value => {
    const absolute = path.resolve(value);
    const resolved = fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute;
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  assert.notEqual(canonical(home), canonical(production), 'Use an isolated --home for agent tests');
}

function withAgentTestHomeLock(home, action) {
  assert(typeof home === 'string' && home.length > 0, 'Set DSH_HOME to an isolated installed profile');
  assertIsolatedHome(home);
  return withOutputLock(path.join(home, '.portable-harness', 'agent-test'), action);
}

module.exports = {assertIsolatedHome, withAgentTestHomeLock};
