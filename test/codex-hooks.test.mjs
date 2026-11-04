import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hookApplies } from '../plugins/codex-hooks/lib/events.js';
import { hookHash, readStateFile, writeStateFile } from '../plugins/codex-hooks/lib/core.js';
import { configureRtkHook, renderRtkHooks } from '../scripts/harness.mjs';

test('project hooks never run in another workspace',()=>{
  const cwd=path.join(os.tmpdir(),'project-one');
  const hook={group:'projects',sourcePath:path.join(cwd,'.dsh','hooks.json')};
  assert(hookApplies(hook,'agent/created',{cwd}));
  assert(!hookApplies(hook,'agent/created',{cwd:path.join(os.tmpdir(),'project-two')}));
  assert(!hookApplies(hook,'agent/created',{}));
});

test('RTK setup approves only managed handlers and preserves user choices',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rtk-hook-'));
  try {
    const file=path.join(home,'hooks.json'),config=renderRtkHooks(home);
    config.hooks['agent/created']=[{command:'echo unrelated'}];
    fs.writeFileSync(file,JSON.stringify(config));
    const stateFile=path.join(home,'hooks.state.json');
    writeStateFile(stateFile,{version:1,states:{user:{enabled:false,trustedHash:'keep'}}});
    configureRtkHook(home);
    const saved=readStateFile(stateFile);assert.deepEqual(saved.states.user,{enabled:false,trustedHash:'keep'});
    assert.equal(Object.keys(saved.states).length,3,'only the two RTK handlers gain trust');
    const key=Object.keys(saved.states).find(key=>key!=='user');
    assert(saved.states[key].trustedHash.startsWith('sha256:'));
    saved.states[key].enabled=false;writeStateFile(stateFile,saved);configureRtkHook(home);
    assert.equal(readStateFile(stateFile).states[key].enabled,false);
    assert.notEqual(hookHash({eventName:'agent/created',handler:{type:'command',command:'rtk --version'}}),hookHash({eventName:'agent/created',handler:{type:'command',command:'another command'}}));
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
