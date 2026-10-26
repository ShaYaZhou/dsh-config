import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {renderDailyPlan, settingsFrom, repository} from '../scripts/harness.mjs';

test('daily profile uses native PTC and private browsers while enhanced capabilities remain opt-in', () => {
 const home=path.join(os.tmpdir(),'daily profile with spaces');
 const plan=renderDailyPlan(home,settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const daily=JSON.parse(plan.get('profiles/desktop/package.json'));
 assert.deepEqual(Object.keys(daily.dependencies),['@playwright/mcp']);
 assert.deepEqual(daily.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']);
 const patch=JSON.parse(plan.get('profiles/desktop/cordis.patch.yml'));
 assert.equal(patch.find(p=>p.id==='agent-preset-registry').config.default,'ptc');
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.step,'done');
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.completion,'api-key');
 assert(!patch.some(p=>p.id==='preset-ptc'||p.id==='preset-standard'));
 assert(!plan.has('profiles/desktop/agent-capabilities/ultracode.mjs'));
 assert(![...plan.keys()].some(p=>p.startsWith('profiles/desktop/agent-capabilities/skills/')));
 assert(plan.has('profiles/enhanced/agent-capabilities/ultracode.mjs'));
 assert(plan.has('profiles/enhanced/agent-capabilities/skills/ponytail/SKILL.md'));
 const enhanced=plan.get('profiles/enhanced/cordis.patch.yml');
 assert(!enhanced.includes('/profiles/desktop/'));
 assert(enhanced.includes('workflow-command.mjs'));
 assert.equal(plan.get('cordis.patch.yml').trim(),'[]');
});

test('browser boundary rejects privileged code and custom export destinations', () => {
 const source=fs.readFileSync(new URL('../modules/isolated-browser.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('export function browserRefusal'),source.indexOf('export function apply')).replace('export ','');
 const scope={};vm.createContext(scope);vm.runInContext(fn+'\nthis.guard=browserRefusal;',scope);
 assert.equal(scope.guard({name:'read',arguments:{filename:'ok'}}),undefined);
 assert.equal(scope.guard({name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
 assert(scope.guard({name:'mcp__playwright__browser_take_screenshot',arguments:{filename:'../escape'}}));
 assert(scope.guard({name:'mcp__playwright__browser_run_code_unsafe',arguments:{}}));
 assert(scope.guard({name:'mcp__playwright__browser_snapshot',arguments:{sandbox_permissions:'require_escalated'}}));
});

test('browser lifecycle closes stopped sessions without automatic restart and owns teardown', async () => {
 const source=fs.readFileSync(new URL('../modules/isolated-browser.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('export function browserRefusal')).replaceAll('export ','');
 const events=new Map();let cleanup,disposals=0,starts=0;
 const context={mcp:{},path,createHash:()=>({update:()=>({digest:()=> 'fixture-id'})})};
 vm.createContext(context);vm.runInContext(code+'\nthis.install=apply;',context);
 context.install({on:(name,fn)=>events.set(name,fn),effect:fn=>{cleanup=fn();}},
  {command:'node',cli:'browser.js',browser:'chrome',outputRoot:'/output'});
  const guards=new Map();
  const make=id=>({id,ctx:{tools:{guard:fn=>guards.set(id,fn)},plugin:()=>{starts++;return {await:async()=>{},dispose:async()=>{disposals++;}};}}});
 const first=make('one'),second=make('two');
 await events.get('agent/created')({agent:first});await events.get('agent/created')({agent:second});
 await events.get('session/event')({id:'one'},{type:'turn/end',data:{reason:{kind:'aborted'}}});
 assert.equal(disposals,1);assert.equal(starts,2);
  assert(guards.get('one')({agent:first,name:'mcp__playwright__browser_snapshot',arguments:{}}));
  assert.equal(guards.get('one')({agent:second,name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
  assert.equal(guards.get('two')({agent:second,name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
 await events.get('session/event')({id:'one'},{type:'turn/start',data:{}});
 assert.equal(starts,2,'stop must not recreate browser automatically');
 await cleanup();assert.equal(disposals,2);
  const broken=make('broken');
  broken.ctx.plugin=()=>{starts++;return {await:async()=>{},dispose:async()=>{throw new Error('unconfirmed cleanup');}};};
  await events.get('agent/created')({agent:broken});
  await assert.rejects(events.get('session/event')({id:'broken'},{type:'turn/end',data:{reason:{kind:'error'}}}),/unconfirmed cleanup/);
  assert(guards.get('broken')({agent:broken,name:'mcp__playwright__browser_snapshot',arguments:{}}));
  const before=starts;await events.get('agent/created')({agent:broken});assert.equal(starts,before);
  await assert.rejects(cleanup(),/unconfirmed cleanup/);
});
