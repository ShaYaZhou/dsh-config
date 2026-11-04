import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkRtkCommand, rtkContext } from '../modules/rtk-hooks.mjs';
import { parseHookOutput } from '../plugins/codex-hooks/lib/core.js';

test('RTK hook blocks before execution using the upstream JSON mapping',()=>{
  let calls=0;
  const result=checkRtkCommand({tool_name:'pwsh',tool_input:{command:'git status'}},(exe,args,options)=>{
    calls++;assert.match(exe,/^rtk(?:\.exe)?$/);assert.deepEqual(args,['hook','claude']);
    assert.equal(options.shell,false);assert.deepEqual(JSON.parse(options.input),{tool_name:'Bash',tool_input:{command:'git status'}});
    return {status:0,stdout:JSON.stringify({hookSpecificOutput:{updatedInput:{command:'rtk git status'}}})};
  });
  assert.equal(calls,1);assert.equal(result.decision,'block');assert.match(result.reason,/NOT run.*rtk git status/);
  assert.equal(parseHookOutput(JSON.stringify(result),{eventName:'tools/pre-execute'}).decision,'block');
});

test('already wrapped, complex, exact-output and unrelated calls remain unchanged',()=>{
  const never=()=>{throw Error('unexpected processor invocation');};
  for(const command of ['rtk git status','rtk.exe proxy git status','git status --porcelain','git log --format=json','git status; echo ok','$x = 1','git status | ConvertFrom-Json'])
    assert.deepEqual(checkRtkCommand({tool_name:'pwsh',tool_input:{command}},never),{});
  assert.deepEqual(checkRtkCommand({tool_name:'read',tool_input:{command:'git status'}},never),{});
});

test('unsupported commands are untouched and processor failures are visible',()=>{
  assert.deepEqual(checkRtkCommand({tool_name:'bash',tool_input:{command:'echo ok'}},()=>({status:0,stdout:''})),{});
  assert.throws(()=>checkRtkCommand({tool_name:'bash',tool_input:{command:'git status'}},()=>({status:1})),/processor failed/);
  const context=parseHookOutput(JSON.stringify(rtkContext()),{eventName:'agent/pre-step'});
  assert.match(context.additionalContext,/inside PTC/);assert.match(context.additionalContext,/Never repeat/);
});

test('installed RTK produces a usable guard receipt without executing git',()=>{
  const result=checkRtkCommand({tool_name:'bash',tool_input:{command:'git status'}},spawnSync);
  assert.equal(result.decision,'block');assert.match(result.reason,/rtk git status/);
});
