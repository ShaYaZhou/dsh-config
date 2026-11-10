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

test('daily profile uses private browsers and the requested enhancement defaults', () => {
 const home=path.join(os.tmpdir(),'daily profile with spaces');
 const plan=renderDailyPlan(home,settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const daily=JSON.parse(plan.get('profiles/desktop/package.json'));
 for(const name of ['dsh-mnemon','@local/dsh-idle-settings','dsh-meme','dsh-whale-widget','dsh-comfyui','dsh-ego-browser','dsh-media-desk','dsh-guizang-design','dsh-context','agentero-dsh','@local/dsh-today-todo','@local/dsh-notion-mcp','@linxin666/dsh-client-ui-git-graph']) {
  assert(daily.dependencies[name]); assert(daily.dsh.profile.bundles.includes(name));
 }
 for(const name of ['@deepseek-ai/dsh-experimental-session-titles-bundle','@deepseek-ai/dsh-experimental-forge-bundle']){
  assert(daily.dsh.profile.bundles.includes(name));
 }
 for(const name of ['dsh-codex-hooks']){
  assert(daily.dependencies[name]);assert(!daily.dsh.profile.bundles.includes(name));
 }
 assert(!daily.dependencies['@dsh-external/workflow']);
 assert(!daily.dsh.profile.bundles.includes('@dsh-external/workflow'));
 assert(![...plan.keys()].some(file=>file.startsWith('profiles/enhanced/')));
 assert(!daily.dependencies['@local/dsh-delete-session']);
 assert(!daily.dsh.profile.bundles.includes('@local/dsh-delete-session'));
 assert(daily.dependencies['@michengai/dsh-archive-manager']);
 assert(daily.dsh.profile.bundles.includes('@michengai/dsh-archive-manager'));
 for(const name of ['@dsh-external/dsh-memory','@local/dsh-memory-policy','@local/dsh-workflow-ptc','@local/dsh-tool-workflow','@local/dsh-ultracode-control','@local/dsh-rtk-shell','@local/dsh-sidebar-layout','@kenz1117/dsh-ui-usage-billing'])assert(!daily.dependencies[name]);
 const patch=JSON.parse(plan.get('profiles/desktop/cordis.patch.yml'));
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.step,'done');
 assert.equal(patch.find(p=>p.id==='ui-settings-account').config.completion,'api-key');
 assert(!patch.some(p=>p.id==='preset-ptc'||p.id==='preset-standard'));
 assert(!plan.has('profiles/desktop/agent-capabilities/ultracode.mjs'));
 assert.equal(patch.find(p=>p.id==='dynamic-ui-view').config.skillDirectory,path.join(home,'profiles/desktop/agent-capabilities/inline-skills/dynamic-ui'));
 assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/SKILL.md'));
 assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/patterns/manifest.json'));
 for(const name of ['think','ponytail','rtk-reference','check','openspec-explore'])
  assert(plan.has('profiles/desktop/agent-capabilities/inline-skills/catalog/'+name+'/SKILL.md'),name+' must be portable without global skills');
 for(const name of ['workflow-orchestration','computer-use'])
  assert(!plan.has('profiles/desktop/agent-capabilities/inline-skills/catalog/'+name+'/SKILL.md'));
 assert.deepEqual([...plan.keys()].filter(p=>p.startsWith('profiles/desktop/agent-capabilities/skills/')),
  []);
 const optional=patch.flatMap(p=>p.insert??[]).filter(p=>typeof p.disabled==='boolean'&&p.name?.startsWith('file:'));
 assert.deepEqual(optional.filter(p=>p.disabled).map(p=>p.id),[]);
 assert.deepEqual(optional.filter(p=>!p.disabled).map(p=>p.id),['claude-context']);
 for(const row of optional) assert(plan.has('profiles/desktop/agent-capabilities/'+path.basename(new URL(row.name).pathname)));
 assert.deepEqual(JSON.parse(plan.get('cordis.patch.yml')),[]);
 assert.equal(patch.find(p=>p.id==='mnemon').config.embedding.model,'qwen3-embedding:0.6b');
 assert(!Object.hasOwn(patch.find(p=>p.id==='mnemon').config.embedding,'apiKey'));
 for(const id of ['mnemon-strategy-scoped','mnemon-strategy-auto-capture','mnemon-strategy-light-context'])assert.equal(patch.find(p=>p.id===id).disabled,false);
 assert.deepEqual(JSON.parse(plan.get('dsh-expression.json')),{sendGear:'active',pickerSendOnClick:false});
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

test('shared skills include binary and template resources without UTF-8 corruption',()=>{
 const plan=renderDailyPlan(path.join(os.tmpdir(),'shared skills home'),settingsFrom('/nonexistent'));
 const manifest=JSON.parse(fs.readFileSync(path.join(repository,'config/skill-sources.json'),'utf8'));
 const seen=new Set();
 function verify(dir,prefix){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name),relative=prefix+'/'+entry.name;
   if(entry.isDirectory()){verify(file,relative);continue;}
   const deployed=plan.get('skills/'+relative);
   assert.notEqual(deployed,undefined,'Missing skill resource: '+relative);
   assert.deepEqual(Buffer.from(deployed),fs.readFileSync(file),relative);
   seen.add(path.extname(entry.name));
  }
 }
 for(const name of Object.keys(manifest))verify(path.join(repository,'skills',name),name);
 for(const extension of ['.html','.jsx','.xml','.png'])assert(seen.has(extension));
 assert(plan.has('skills/rtk-reference/SKILL.md'));
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

test('desktop does not install the retired boot animation',()=>{
 const plan=renderDailyPlan(path.join(os.tmpdir(),'dsh-no-boot-plan'),settingsFrom('/nonexistent'));
 const manifest=JSON.parse(plan.get('profiles/desktop/package.json'));
 assert(!manifest.dependencies['dsh-boot-animation']);
 assert(!manifest.dsh.profile.bundles.includes('dsh-boot-animation'));
 assert(![...plan.keys()].some(key=>key.includes('boot-animation')));
});


test('daily and full instructions retain the same portable RTK execution guidance',()=>{
 const daily=fs.readFileSync(path.join(repository,'presets/daily/AGENTS.md'),'utf8');
 const full=fs.readFileSync(path.join(repository,'config/AGENTS.md'),'utf8');
 const section=text=>text.replaceAll('\r\n','\n').split('## RTK hooks\n')[1].split('\n---')[0].trim();
 assert.equal(section(daily),section(full));
 assert.match(section(daily),/including calls dispatched through PTC/);
 assert.match(section(daily),/rtk proxy/);
 assert.match(section(daily),/never repeat an already executed/);
 const plan=renderDailyPlan(path.join(os.tmpdir(),'dsh-rtk-plan'),settingsFrom('/nonexistent'));
 assert.match(plan.get('AGENTS.md'),/## RTK hooks/);
});
