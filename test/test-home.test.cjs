const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const test = require('node:test');
const {assertIsolatedHome,withAgentTestHomeLock} = require('../scripts/test-home.cjs');

test('agent tests reject production homes including real directory aliases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-guard-'));
  const production = path.join(root, 'production'), alias = path.join(root, 'alias');
  fs.mkdirSync(production);
  try {
    assert.throws(() => assertIsolatedHome(production, production), /isolated/);
    assert.throws(() => assertIsolatedHome(path.join(production, '..', 'production'), production), /isolated/);
    if (process.platform === 'win32') assert.throws(() => assertIsolatedHome(production.toUpperCase(), production), /isolated/);
    fs.symlinkSync(production, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertIsolatedHome(alias, production), /isolated/);
    assert.doesNotThrow(() => assertIsolatedHome(path.join(root, 'isolated'), production));
  } finally {
    if (fs.existsSync(alias)) fs.unlinkSync(alias);
    fs.rmdirSync(production);
    fs.rmdirSync(root);
  }
});

test('different acceptance runners share one real-home lease',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-agent-test-home-'));
  const alias=home+'-alias';fs.symlinkSync(home,alias,process.platform==='win32'?'junction':'dir');
  try {
    await withAgentTestHomeLock(home,async()=>{
      await assert.rejects(withAgentTestHomeLock(alias,async()=>assert.fail('second native boot')),/serially/);
    });
    assert.equal(await withAgentTestHomeLock(alias,async()=>true),true);
  } finally {
    fs.unlinkSync(alias);fs.rmdirSync(path.join(home,'.portable-harness/agent-test'));fs.rmdirSync(path.join(home,'.portable-harness'));fs.rmdirSync(home);
  }
});
