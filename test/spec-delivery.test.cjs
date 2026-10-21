const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const {withOutputLock} = require('../scripts/test-spec-delivery.cjs');

test('real spec acceptance evidence has one writer and releases its lock after failures', async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-spec-evidence-'));
  try {
    await withOutputLock(folder,async()=>{
      assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'runner.lock'))).pid,process.pid);
      await assert.rejects(withOutputLock(folder,async()=>assert.fail('A second writer ran')),/serially/);
    });
    await assert.rejects(withOutputLock(folder,async()=>{throw new Error('fixture failure');}),/fixture failure/);
    assert.equal(fs.existsSync(path.join(folder,'runner.lock')),false);
    assert.equal(await withOutputLock(folder,async()=>42),42);
  } finally { fs.rmdirSync(folder); }
});
