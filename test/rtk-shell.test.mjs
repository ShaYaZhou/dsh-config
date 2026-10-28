import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {rewriteCommand,rewriteSpec} from '../plugins/rtk-shell/lib/rewrite.js';

test('RTK accepts only a bounded human-output Git grammar on either shell',()=>{
 for(const command of ['git status','git diff','git diff --stat','git diff --cached','git log -3','git log -n 3 --oneline','git show --stat']) assert.equal(rewriteCommand(command),'rtk '+command);
 for(const command of ['git status --porcelain','git status --short','git diff --name-only','git log --format=%H','git status | wc -l','git status > out','git status && git push','git status; touch file','git status\nwhoami','X=1 git status','env git status','git -C repo status','git status $(touch x)','git status `whoami`','git status #comment','git status\0','git push','git commit -m message','rtk git status','rtk.exe git status','rtk proxy git status','ls','Get-ChildItem','& git status','git log -n 0','git log -n','git log -- -n']) assert.equal(rewriteCommand(command),command,command);
});

test('RTK preserves native specs and calls the environment/native executor exactly once',async()=>{
 for(const dialect of ['bash','pwsh']){
  let calls=[];let mode='success';
  const handle={result:async()=>({exitCode:0}),kill(){},done:Promise.resolve()};
  class Base {
   static inject=['subprocess','sandbox','sandboxPolicy'];
   static Config={native:true};
   get sandboxMode(){return 'workspace-write';}
   execute(spec){calls.push(spec);if(mode==='throw')throw Error('execution started then failed');if(mode==='reject')return Promise.reject(Error('execution failed'));return Promise.resolve(handle);}
  }
  const source=fs.readFileSync(new URL(`../plugins/rtk-shell/lib/${dialect}.js`,import.meta.url),'utf8');
  const className=dialect==='bash'?'RtkBashExecutor':'RtkPwshExecutor';
  const code=source.slice(source.indexOf('export default class')).replace('export default class','class')+`;this.Executor=${className};`;
  const box={EnvironmentBashExecutor:Base,EnvironmentPwshExecutor:Base,rewriteSpec};vm.runInNewContext(code,box);
  const executor=new box.Executor();
  const controller=new AbortController();
  const spec={command:'git status',workdir:'workspace with spaces',env:{TEST_ENV:'selected'},dshEnv:{DSH_SESSION_ID:'fixture'},sandboxPolicy:{mode:'workspace-write',workspaceRoot:'root'},signal:controller.signal,timeoutMs:4321,onExpiry:'none',stdin:'literal'};
  assert.equal(await executor.execute(spec),handle);
  assert.equal(calls.length,1);assert.equal(calls[0].command,'rtk git status');assert.equal(spec.command,'git status');
  for(const key of Object.keys(spec).filter(k=>k!=='command'))assert.equal(calls[0][key],spec[key]);
  assert.equal(box.Executor.inject,Base.inject);assert.equal(box.Executor.Config,Base.Config);
  for(mode of ['throw','reject']) {calls=[];await assert.rejects(async()=>executor.execute(spec),/failed/);assert.equal(calls.length,1,'Never replay the raw command');}
  mode='success';calls=[];
  const originalResult=handle.result;
  handle.result=async()=>{throw Error('late process failure');};
  const published=await executor.execute(spec);
  await assert.rejects(published.result(),/late process failure/);assert.equal(calls.length,1);
  handle.result=async()=>({exitCode:null,timedOut:true,aborted:false});
  assert.equal((await published.result()).timedOut,true);assert.equal(calls.length,1);
  handle.result=originalResult;
  calls=[];controller.abort();assert.throws(()=>executor.execute(spec));assert.equal(calls.length,0);
 }
});
