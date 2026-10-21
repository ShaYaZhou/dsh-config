const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

function assertIsolatedHome(home, production = path.join(os.homedir(), '.dsh')) {
  const canonical = value => {
    const absolute = path.resolve(value);
    const resolved = fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute;
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  assert.notEqual(canonical(home), canonical(production), 'Use an isolated --home for agent tests');
}

module.exports = {assertIsolatedHome};
