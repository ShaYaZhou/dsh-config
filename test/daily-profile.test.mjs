import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {renderDailyPlan, settingsFrom, repository} from '../scripts/harness.mjs';

test('machine-local provider definitions survive rendering without embedding credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-provider-'));
 try{
  const file=path.join(dir,'settings.json'),value={defaultProvider:'custom',defaultModel:'custom-model',reasoningEffort:null,
   additionalProviders:{custom:{baseURL:'https://models.example.invalid/v1',apiKeyEnv:'CUSTOM_API_KEY',api:'openai-completions',models:[{id:'custom-model',name:'Custom'}]}}};
  fs.writeFileSync(file,JSON.stringify(value));
  const plan=renderDailyPlan(path.join(dir,'home'),settingsFrom(file,{}));
  for(const profile of ['desktop','headless']){
   const rows=JSON.parse(plan.get('profiles/'+profile+'/cordis.patch.yml'));
   assert.equal(rows.find(r=>r.id==='llm-pi-ai').config.providers.custom.apiKeyEnv,'CUSTOM_API_KEY');
   const model=rows.find(r=>r.id==='agent-default-model').config;
   assert.equal(model.provider,'custom');assert.equal(model.model,'custom-model');assert(!Object.hasOwn(model,'reasoningEffort'));
  }
  value.additionalProviders.custom.apiKey='not-a-real-credential';fs.writeFileSync(file,JSON.stringify(value));
  assert.throws(()=>settingsFrom(file,{}),/keep secrets in the credential store/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('daily profile uses native PTC, private browsers and the requested enhancement defaults', () => {
 const home=path.join(os.tmpdir(),'daily profile with spaces');
 const plan=renderDailyPlan(home,settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const daily=JSON.parse(plan.get('profiles/desktop/package.json'));
 assert.deepEqual(Object.keys(daily.dependencies),['@playwright/mcp','@local/dsh-nested-sessions','@local/dsh-shared','dshmarket','@local/dsh-enhancement-settings','@local/dsh-dynamic-ui-view','@local/dsh-browser-review','@local/dsh-file-links','dsh-rewind-plugin','@local/dsh-desktop-commands','@local/dsh-delete-session','@michengai/dsh-btw','@tt-a1i/archify-dsh','dsh-better-sidebar','@michengai/dsh-code-review','dsh-subagent-workspace-ui','@michengai/dsh-skills-manager','@local/dsh-local-environments','@local/dsh-follow-ups','@local/dsh-team-view','@michengai/dsh-archive-manager','@michengai/dsh-simplify','dsh-init','@kenz1117/dsh-ui-usage-billing','dsh-boot-animation','@local/dsh-sidebar-layout']);
 assert.deepEqual(daily.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@local/dsh-nested-sessions','dshmarket','@local/dsh-enhancement-settings','@local/dsh-dynamic-ui-view','@local/dsh-browser-review','@local/dsh-file-links','dsh-rewind-plugin','@local/dsh-desktop-commands','@local/dsh-delete-session','@michengai/dsh-btw','@tt-a1i/archify-dsh','dsh-better-sidebar','@michengai/dsh-code-review','dsh-subagent-workspace-ui','@michengai/dsh-skills-manager','@local/dsh-local-environments','@local/dsh-follow-ups','@local/dsh-team-view','@michengai/dsh-archive-manager','@michengai/dsh-simplify','dsh-init','@kenz1117/dsh-ui-usage-billing','dsh-boot-animation','@local/dsh-sidebar-layout']);
 const patch=JSON.parse(plan.get('profiles/desktop/cordis.patch.yml'));
 assert.equal(patch.find(p=>p.id==='agent-preset-registry').config.default,'ptc');
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.step,'done');
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.completion,'api-key');
 assert(!patch.some(p=>p.id==='preset-ptc'||p.id==='preset-standard'));
 assert(!plan.has('profiles/desktop/agent-capabilities/ultracode.mjs'));
 assert.equal(patch.find(p=>p.id==='dynamic-ui-view').config.skillDirectory,path.join(home,'profiles/desktop/agent-capabilities/inline-skills/dynamic-ui'));
 assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/SKILL.md'));
 assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/patterns/manifest.json'));
 for(const name of ['think','ponytail','rtk-reference','check','openspec-explore'])
  assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/catalog/'+name+'/SKILL.md'),name+' must be portable without global skills');
 for(const name of ['workflow-orchestration','dsh-spec-delivery','computer-use'])
  assert(!plan.has('profiles/desktop/agent-capabilities/inline-skills/catalog/'+name+'/SKILL.md'));
 assert.deepEqual([...plan.keys()].filter(p=>p.startsWith('profiles/desktop/agent-capabilities/skills/')),
  ['profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md']);
 const optional=patch.flatMap(p=>p.insert??[]).filter(p=>typeof p.disabled==='boolean');
 assert.deepEqual(optional.filter(p=>p.disabled).map(p=>p.id),['agent-team-local','tool-agent-team-local','browser-guidance']);
 assert.deepEqual(optional.filter(p=>!p.disabled).map(p=>p.id),['tool-worktree','session-bus','claude-context','usage-report']);
 for(const row of optional) assert(plan.has('profiles/desktop/agent-capabilities/'+path.basename(new URL(row.name).pathname)));
 assert(plan.has('profiles/enhanced/agent-capabilities/ultracode.mjs'));
 assert(plan.has('profiles/enhanced/agent-capabilities/skills/ponytail/SKILL.md'));
 const enhanced=plan.get('profiles/enhanced/cordis.patch.yml');
 assert(!enhanced.includes('/profiles/desktop/'));
 assert(enhanced.includes('workflow-command.mjs'));
 assert.equal(plan.get('cordis.patch.yml').trim(),'[]');
});

test('every enhanced bundle is daily or has an explicit execution-policy exclusion',()=>{
 const enhanced=JSON.parse(fs.readFileSync(path.join(repository,'config/desktop.package.json')));
 const daily=JSON.parse(fs.readFileSync(path.join(repository,'presets/daily/desktop.package.json')));
 assert.deepEqual(enhanced.dsh.profile.bundles.filter(name=>!daily.dsh.profile.bundles.includes(name)),[
  '@deepseek-ai/dsh-experimental-agent-team-profile', // mutually exclusive with local Team
  '@dsh-external/dsh-memory', // automatic behavior has no isolated cost/quality ablation
  '@local/dsh-idle-settings', // requires the optional custom compaction implementation
 ]);
});

test('browser boundary rejects privileged code and custom export destinations', () => {
 const source=fs.readFileSync(new URL('../modules/isolated-browser.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('export function browserRefusal'),source.indexOf('const BLOCKED')).replace('export ','');
 const scope={};vm.createContext(scope);vm.runInContext(fn+'\nthis.guard=browserRefusal;',scope);
 assert.equal(scope.guard({name:'read',arguments:{filename:'ok'}}),undefined);
 assert.equal(scope.guard({name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
 assert(scope.guard({name:'mcp__playwright__browser_take_screenshot',arguments:{filename:'../escape'}}));
 assert(scope.guard({name:'mcp__playwright__browser_run_code_unsafe',arguments:{}}));
 assert(scope.guard({name:'mcp__playwright__browser_snapshot',arguments:{sandbox_permissions:'require_escalated'}}));
});

test('native stop remains blocked after later completed turns and cleanup markers survive folding', () => {
 const source=fs.readFileSync(new URL('../modules/isolated-browser.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const BLOCKED'),source.indexOf('const SAFE_WHILE_BLOCKED')).replaceAll('export ','');
 const scope={stateZ:{object:()=>({strict:()=>({})}),boolean:()=>({})}};
 vm.createContext(scope);vm.runInContext(code+'\nthis.projection=browserLifecycleProjection;',scope);
 const p=scope.projection;
 const completed={type:'turn/end',data:{reason:{kind:'completed'}}};
 assert.equal(p.apply(p.init(),completed).blocked,false);
 const stopped=p.apply(p.init(),{type:'turn/end',data:{reason:{kind:'aborted'}}});
 assert.equal(p.apply(stopped,completed).blocked,true);
 assert.equal(p.apply(p.init(),{type:'plugin:isolated-browser/blocked',data:{reason:'cleanup-unconfirmed'}}).blocked,true);
});

test('browser lifecycle closes stopped sessions without automatic restart and owns teardown', async () => {
 const source=fs.readFileSync(new URL('../modules/isolated-browser.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('export function browserRefusal')).replaceAll('export ','');
 const events=new Map();let cleanup,disposals=0,starts=0;
 const context={stateZ:{object:()=>({strict:()=>({})}),boolean:()=>({})},appendPluginRecord:(session,type,data)=>session.events.push({type,data}),mcp:{},path,createHash:()=>({update:()=>({digest:()=> 'fixture-id'})})};
 vm.createContext(context);vm.runInContext(code+'\nthis.install=apply;',context);
 let projection;
 context.install({sessionProjections:{register:value=>{projection=value;},stateOf:session=>session.events.reduce((state,event)=>projection.apply(state,event),projection.init())},logger:{warn:()=>{}},on:(name,fn)=>events.set(name,fn),effect:fn=>{cleanup=fn();}},
  {command:'node',cli:'browser.js',browser:'chrome',outputRoot:'/output'});
  const guards=new Map();
  const make=id=>({id,session:{id,events:[],snapshotEvents(){return this.events;}},ctx:{tools:{guard:fn=>guards.set(id,fn)},plugin:()=>{starts++;return {await:async()=>{},dispose:async()=>{disposals++;}};}}});
 const first=make('one'),second=make('two');
 await events.get('agent/created')({agent:first});await events.get('agent/created')({agent:second});
 await events.get('agent/disposed')({agent:second});
 const resumed=make('two');await events.get('agent/created')({agent:resumed});
 assert.equal(starts,3);assert.equal(guards.get('two')({agent:resumed,name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
 await events.get('agent/disposed')({agent:second});
 assert.equal(disposals,1,'stale disposal must not close the new generation');
 await events.get('session/event')(first.session,{type:'turn/end',data:{reason:{kind:'aborted'}}});
 assert.equal(disposals,2);assert.equal(starts,3);
  assert(guards.get('one')({agent:first,name:'mcp__playwright__browser_snapshot',arguments:{}}));
  assert(guards.get('one')({agent:first,name:'bash',arguments:{command:'python browser.py'}}));
  assert(guards.get('one')({agent:first,name:'run_code',arguments:{code:'launchAnything()'}}));
  assert.equal(guards.get('one')({agent:second,name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
  assert.equal(guards.get('two')({agent:second,name:'mcp__playwright__browser_snapshot',arguments:{}}),undefined);
 await events.get('session/event')({id:'one'},{type:'turn/start',data:{}});
 assert.equal(starts,3,'stop must not recreate browser automatically');
 await cleanup();assert.equal(disposals,3);
  const broken=make('broken');
  broken.ctx.plugin=()=>{starts++;return {await:async()=>{},dispose:async()=>{throw new Error('unconfirmed cleanup');}};};
  await events.get('agent/created')({agent:broken});
  await assert.rejects(events.get('session/event')(broken.session,{type:'turn/end',data:{reason:{kind:'error'}}}),/unconfirmed cleanup/);
  assert(guards.get('broken')({agent:broken,name:'mcp__playwright__browser_snapshot',arguments:{}}));
  const before=starts;await events.get('agent/created')({agent:broken});assert.equal(starts,before);
  await assert.rejects(cleanup(),/unconfirmed cleanup/);
});

test('nested mode routes only new dispatch and leaves legal communication available', () => {
 const s=fs.readFileSync(new URL('../plugins/nested-sessions/lib/index.js',import.meta.url),'utf8');
 const fn=s.slice(s.indexOf('export function delegationRefusal'),s.indexOf('function installTools')).replace('export ','');
 const scope={};vm.createContext(scope);vm.runInContext(fn+'\nthis.check=delegationRefusal;',scope);
 for(const tool of ['spawn_teammate','subagent','subagent_fork']){
  assert(scope.check('linked',tool));assert(scope.check('worker',tool));
  assert.equal(scope.check('auto',tool),undefined);assert.equal(scope.check('off',tool),undefined);
 }
 for(const tool of ['send_message','send_session_message','team_task_get','wait_for_sessions','read_session'])
  assert.equal(scope.check('linked',tool),undefined);
 assert(scope.check('worker','workflow'));
 assert.equal(scope.check('linked','workflow'),undefined);
});
