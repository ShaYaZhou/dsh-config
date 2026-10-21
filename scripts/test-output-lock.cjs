const fs = require('node:fs');
const path = require('node:path');

async function withOutputLock(folder, action) {
  fs.mkdirSync(folder, { recursive: true });
  const lock = path.join(folder, 'runner.lock');
  let handle;
  try {
    handle = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another acceptance runner owns ${lock}. Run these checks serially; remove a stale lock only after its recorded process has exited.`);
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({pid: process.pid}));
    return await action();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

module.exports = {withOutputLock};
