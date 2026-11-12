import test from 'node:test';
const renderPlan=(home,settings,artifacts,options)=>options?.clean?renderBasePlan(home,settings,artifacts,options):renderDailyPlan(home,settings,artifacts);
import {spawnSync} from 'node:child_process';
import {checkRtk} from '../scripts/check-rtk.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {assertMatchingRuntimes,bindRuntimeDependencies,latestDependencies,repository,renderPlan as renderBasePlan,renderDailyPlan,settingsFrom,emitYaml,parseArgs,status,capture,staleModulePaths} from '../scripts/harness.mjs';
import {createHash} from 'node:crypto';
import {deploymentInputs} from '../scripts/deployment-state.mjs';
import {applyAgentSkill,planAgentSkill,syncedSkillNames} from '../scripts/sync-agent-skills.mjs';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('matching desktop and CLI releases do not depend on the npm latest channel',()=>{
 assert.doesNotThrow(()=>assertMatchingRuntimes('0.2.2-rc.1','0.2.2-rc.1'));
 assert.doesNotThrow(()=>assertMatchingRuntimes('9.0.0','9.0.0'));
 assert.throws(()=>assertMatchingRuntimes('0.2.2-rc.1','0.2.1-rc.5'),/Install @deepseek-ai\/dsh@0.2.2-rc.1/);
 assert.throws(()=>assertMatchingRuntimes('invalid','invalid'),/Invalid runtime version/);
});
const settings=settingsFrom(path.join(repository,'config/local.example.json'),{});
const plugins=JSON.parse(fs.readFileSync(path.join(repository,'provenance.json'),'utf8')).plugins;

test('render to another home with spaces without changing source or creating files',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'dsh portable '));
 const target=path.join(base,'another home');
 const before=hash(path.join(repository,'config/desktop.patch.json'));
 const plan=renderPlan(target,settings);
 assert.equal(fs.existsSync(target),false);
 assert.equal(before,hash(path.join(repository,'config/desktop.patch.json')));
 const patch=plan.get('profiles/desktop/cordis.patch.yml');
 if(plugins.length)assert(patch.includes(pathToFileURL(path.join(target,'profiles/desktop/agent-capabilities')).href));
 assert(!patch.includes('${'));
 assert(!plan.get('profiles/headless/package.json').includes('dsh-memu-memory'));
 for(const profile of ['desktop','headless'])assert.doesNotThrow(()=>JSON.parse(plan.get('profiles/'+profile+'/package.json')));
 fs.rmdirSync(base);
});
test('only explicit expression nodes emit JS tags; scalar strings retain their text',()=>{
 const rendered=emitYaml([{value:{$js:'process.cwd()'},text:'!!js dangerous()',nested:{value:'ordinary'}}]);
 assert(rendered.includes('"value": !!js "process.cwd()"'));assert(rendered.includes('"text": "!!js dangerous()"'));
 assert.deepEqual(parseArgs(['install','--home','relative home','--dry-run']).dryRun,true);
 assert.throws(()=>parseArgs(['install','--settings']),/Missing/);
});

test('official OpenSpec skills deploy portably and native cleanup removes only managed skill files',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'spec portable home'),settings),base='profiles/desktop/agent-capabilities/inline-skills/catalog/';
 const source=JSON.parse(fs.readFileSync(path.join(repository,'provenance.json'),'utf8')).integrations.openspec;
 const names=['explore','propose','apply-change','update-change','sync-specs','archive-change'].map(id=>'openspec-'+id);
 for(const name of names){
  const target=base+name+'/SKILL.md',text=plan.get(target);
  assert.equal(text,fs.readFileSync(path.join(repository,'.dsh/skills',name,'SKILL.md'),'utf8'));
  assert(text.includes('generatedBy: "'+source.version+'"'));
  assert(!/(?<![a-zA-Z])[A-Za-z]:[\\/]/.test(text));
  assert.deepEqual(staleModulePaths({sources:{[target]:'old','skills/user/SKILL.md':'keep'}},new Map()),[target]);
 }
 const native=renderPlan(path.join(os.tmpdir(),'spec clean home'),settings,{}, {clean:true});
 assert(![...native.keys()].some(name=>name.includes('openspec-')));
 assert(!plan.get('profiles/headless/cordis.patch.yml').includes('agent-capabilities/skills'));
 assert(plan.get('profiles/desktop/cordis.patch.yml').includes('daily-managed-skills'));
 const delivery=base+'dsh-spec-delivery/SKILL.md';
 assert(!plan.has(delivery));
 assert.deepEqual(staleModulePaths({sources:{[delivery]:'old'}},new Map()),[delivery]);
});

test('desktop configuration does not register the retired liangshen preset',()=>{
 const rendered=renderPlan(path.join(os.tmpdir(),'legacy-session-home'),settings).get('profiles/desktop/cordis.patch.yml');
 const patch=JSON.parse(rendered.replace(/!!js ("(?:[^"\\]|\\.)*")/g,'{"$js":$1}'));
 assert(!patch.flatMap(row=>[row,...(row.insert??[])]).some(row=>row.config?.id==='liangshen'));
});
test('upstream packages track latest without distributing a frozen resolution',()=>{
 const artifacts=Object.fromEntries(plugins.map(({id})=>[id,{filename:id+'-another-checkout.tgz'}]));
 const plan=renderPlan(path.join(os.tmpdir(),'latest-home'),settings,artifacts);
 assert(![...plan.keys()].some(file=>file.endsWith('pnpm-lock.yaml')));
 const manifest=JSON.parse(plan.get('profiles/desktop/package.json'));
 for(const [name,spec] of Object.entries(manifest.dependencies)) {
  if(spec.startsWith('file:'))assert(!latestDependencies(manifest).includes(name));
  else assert.equal(spec,name.startsWith('@deepseek-ai/')?'${DSH_RUNTIME_VERSION}':'latest',name);
 }
 assert.equal(bindRuntimeDependencies({dependencies:{'@deepseek-ai/example':'${DSH_RUNTIME_VERSION}'}},'9.0.0-rc.1').dependencies['@deepseek-ai/example'],'9.0.0-rc.1');
 assert.throws(()=>bindRuntimeDependencies({dependencies:{community:'${DSH_RUNTIME_VERSION}'}},'9.0.0'));
 assert.deepEqual(latestDependencies({dependencies:{managed:'latest',personal:'1.2.3',local:'file:a.tgz'}}),['managed']);
 const patches=JSON.parse(plan.get('profiles/desktop/pnpm-workspace.yaml')).patchedDependencies;
 assert.deepEqual(Object.keys(patches).sort(), ['@ninkch/dsh-infinite-canvas', 'agentero-dsh-pdf', 'dsh-better-sidebar', 'dsh-memu-memory']);
 const metadata=JSON.parse(fs.readFileSync(path.join(repository,'provenance.json'),'utf8')).integrations.dependencyPatches;
 assert.deepEqual(Object.keys(metadata).sort(),Object.keys(patches).sort(),'Every deployed patch needs a source record');
 for(const [name,file] of Object.entries(patches))assert.equal(metadata[name].patch,'config/'+file);
});
test('machine settings reject embedded credentials and unsupported settings',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-settings-'));const file=path.join(folder,'settings.json');
 fs.writeFileSync(file,JSON.stringify({...settings,proxyBaseUrl:'https://user:password@proxy.example.invalid'}));
 assert.throws(()=>settingsFrom(file,{}),/credentials/);
 fs.writeFileSync(file,JSON.stringify({...settings,apiKey:'not-a-key'}));assert.throws(()=>settingsFrom(file,{}),/Unknown local setting/);
 fs.unlinkSync(file);fs.rmdirSync(folder);
});
test('drift detection reports changed deployed code without reading credentials',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-drift-'));fs.mkdirSync(path.join(folder,'.portable-harness'));
 const file=path.join(folder,'module.mjs');fs.writeFileSync(file,'original');
 fs.writeFileSync(path.join(folder,'.portable-harness/state.json'),JSON.stringify({files:{'module.mjs':hash(file)},inputHashes:deploymentInputs(repository)}));
 assert.deepEqual(status(folder),[]);fs.writeFileSync(file,'changed');assert.deepEqual(status(folder),['module.mjs']);
 fs.unlinkSync(file);fs.unlinkSync(path.join(folder,'.portable-harness/state.json'));fs.rmdirSync(path.join(folder,'.portable-harness'));fs.rmdirSync(folder);
});
test('capture refuses simultaneous repository and installed changes before writing',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-capture-'));fs.mkdirSync(path.join(folder,'.portable-harness'));fs.writeFileSync(path.join(folder,'local.mjs'),'different');
 const source=fs.existsSync(path.join(repository,'modules/role-policy.mjs'))?'modules/role-policy.mjs':'scripts/harness.mjs';const before=hash(path.join(repository,source));
 fs.writeFileSync(path.join(folder,'.portable-harness/state.json'),JSON.stringify({files:{'local.mjs':'old'},sources:{'local.mjs':source},sourceHashes:{[source]:'another-old-hash'}}));
 assert.throws(()=>capture(folder),/Both repository and deployed source changed/);assert.equal(hash(path.join(repository,source)),before);
 fs.unlinkSync(path.join(folder,'local.mjs'));fs.unlinkSync(path.join(folder,'.portable-harness/state.json'));fs.rmdirSync(path.join(folder,'.portable-harness'));fs.rmdirSync(folder);
});
test('status detects unapplied source changes independently of installed file drift',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-status-source-'));
 try{
  fs.mkdirSync(path.join(folder,'.portable-harness'));const file=path.join(folder,'.portable-harness/state.json');
  const inputs=deploymentInputs(repository);inputs['presets/daily/desktop.package.json']='not-deployed';
  fs.writeFileSync(file,JSON.stringify({files:{},inputHashes:inputs}));
  assert.deepEqual(status(folder),['source:presets/daily/desktop.package.json']);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('capture refuses divergent copies of one source across profiles',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-capture-copies-'));
 try{
  fs.mkdirSync(path.join(folder,'.portable-harness'));fs.writeFileSync(path.join(folder,'a.mjs'),'edit A');fs.writeFileSync(path.join(folder,'b.mjs'),'edit B');
  const source='modules/claude-context.mjs',before=hash(path.join(repository,source));
  fs.writeFileSync(path.join(folder,'.portable-harness/state.json'),JSON.stringify({files:{'a.mjs':'old','b.mjs':'old'},sources:{'a.mjs':source,'b.mjs':source},sourceHashes:{[source]:before}}));
  assert.throws(()=>capture(folder),/Different deployed copies/);assert.equal(hash(path.join(repository,source)),before);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('native preset mounts only official bundles and no external hooks or role modules',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'native-preset-home'),settings,{}, {clean:true});
 for(const profile of ['desktop','headless']){
  const manifest=JSON.parse(plan.get('profiles/'+profile+'/package.json'));
  assert.deepEqual(manifest.dependencies,{});assert(manifest.dsh.profile.bundles.every(x=>x.startsWith('@deepseek-ai/')));
  assert(!plan.get('profiles/'+profile+'/cordis.patch.yml').includes('agent-capabilities'));
 }
 assert.deepEqual(JSON.parse(plan.get('cordis.patch.yml')),[]);
 assert(![...plan.keys()].some(x=>x.endsWith('.mjs')));
});
test('reverting to native removes only old managed module files, never data or package-manager files',()=>{
 const safe='profiles/desktop/agent-capabilities/role-policy.mjs',skill='profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md',inline='profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/SKILL.md';
 const previous={sources:{[safe]:'hash',[skill]:'hash',[inline]:'hash','skills/user/SKILL.md':'hash','sessions/user.json':'hash','memories/user.md':'hash','profiles/desktop/node_modules/package/lib/index.js':'hash','profiles/desktop/agent-capabilities/../../outside.mjs':'hash'}};
 assert.deepEqual(staleModulePaths(previous,new Map()),[safe,skill,inline]);assert.deepEqual(staleModulePaths(previous,new Map([[safe,'new'],[skill,'new'],[inline,'new']])),[]);
});
test('versioned sources contain neither personal host paths nor credential files',()=>{
 function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.name.startsWith('.')||['node_modules','build'].includes(x.name)?[]:x.isDirectory()?scan(path.join(dir,x.name)):[path.join(dir,x.name)]);}
 for(const file of scan(repository)){
  if(/\.(png|woff2)$/.test(file))continue;
  const content=fs.readFileSync(file,'utf8');
  assert(!/(?<![a-zA-Z])[A-Za-z]:[\\/]/.test(content),'Drive-absolute path: '+path.relative(repository,file));
  assert(!/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(content),'Personal home path: '+path.relative(repository,file));
  assert(!/sk-[a-zA-Z0-9]{24,}/.test(content),'Possible credential: '+path.relative(repository,file));
 }
});


test('missing RTK rejects deployment before writing target configuration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-no-rtk-'));
 try {
  const home=path.join(dir,'home'),file=path.join(dir,'settings.json');
  fs.writeFileSync(file,JSON.stringify({...settings,proxyBaseUrl:'https://example.invalid/v1'}));
  const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
  const result=spawnSync(process.execPath,[path.join(repository,'scripts/harness.mjs'),'install','--home',home,'--settings',file],{encoding:'utf8',env:{...cleanEnv,PATH:'',OPENAI_BASE_URL:''}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/RTK CLI unavailable on PATH/);
  assert.equal(fs.existsSync(home),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('Windows RTK preflight checks the real executable and no-profile PowerShell without shell interpolation',()=>{
 const calls=[];
 const run=(file,args,options)=>{calls.push({file,args,options});return {status:0,stdout:args[0]==='hook'?JSON.stringify({hookSpecificOutput:{updatedInput:{command:'rtk git status'}}}):args.includes('--help')?'Usage: rtk '+args[0]:'rtk 0.38.0\r\n'};};
 assert.equal(checkRtk({platform:'win32',run}).executable,'rtk.exe');
 assert.deepEqual(calls.map(x=>x.file),['rtk.exe','rtk.exe','rtk.exe','rtk.exe','rtk.exe','rtk.exe','pwsh.exe']);
 assert.deepEqual(JSON.parse(calls[5].options.input),{tool_name:'Bash',tool_input:{command:'git status'}});
 for(const reply of [{status:1,stdout:''},{status:0,stdout:'not JSON'},{status:0,stdout:'{}'}])
  assert.throws(()=>checkRtk({platform:'win32',run:(file,args,opts)=>args[0]==='hook'?reply:run(file,args,opts)}),/hook JSON interface unavailable/);
 assert(calls.every(x=>x.options.shell===false&&x.options.windowsHide));
 assert(calls[6].args.includes('-NoProfile'));
 assert.match(calls[6].args.at(-1),/Get-Command rtk.exe -CommandType Application/);
 assert.throws(()=>checkRtk({platform:'win32',run:(file,args,opts)=>file==='pwsh.exe'?{status:1,stdout:''}:run(file,args,opts)}),/PowerShell 7 cannot run/);
 assert.throws(()=>checkRtk({platform:'win32',run:()=>({status:0,stdout:'unrelated program'})}),/RTK CLI unavailable/);
});


test('registered shared skills deploy from the repository into DSH_HOME/skills with their resources',()=>{
 const plan=renderDailyPlan(path.join(os.tmpdir(),'shared-skill-home'),settings,{});
 const sources=JSON.parse(fs.readFileSync(path.join(repository,'config/skill-sources.json'),'utf8'));
 for(const name of Object.keys(sources)){
  const source=path.join(repository,'skills',name,'SKILL.md');
  assert(fs.existsSync(source),'missing registered skill source: skills/'+name);
  assert.equal(plan.get('skills/'+name+'/SKILL.md'),fs.readFileSync(source,'utf8'),'not deployed to DSH_HOME/skills: '+name);
  assert(![...plan.keys()].some(key=>key.includes('/agent-capabilities/skills/'+name+'/')||key.includes('/inline-skills/catalog/'+name+'/')),'duplicate copy outside DSH_HOME/skills: '+name);
 }
 assert(plan.has('skills/wizard/template.sh'));
 assert(plan.has('skills/aisland-teach/references/assessment-rubric.md'));
});

test('cross-agent sync copies only registered upstream skills and refuses to overwrite extra files',()=>{
 const names=syncedSkillNames();
 assert(names.includes('aisland-teach'));assert(names.includes('grilling'));assert(names.includes('wizard'));
 assert(!names.includes('dynamic-ui'));assert(!names.includes('check'));
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-agent-sync-'));
 try{
  const root=path.join(home,'.claude','skills'),target=path.join(root,'grilling'),backup=path.join(home,'.claude','skill-backups','grilling.pre-sync-1');
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'SKILL.md'),'old copy');
  const first=planAgentSkill('grilling',root);
  assert.deepEqual(first.copy,['SKILL.md','agents/openai.yaml']);
  assert.equal(applyAgentSkill(first,backup),true);
  assert.equal(fs.readFileSync(path.join(backup,'SKILL.md'),'utf8'),'old copy');
  assert(fs.readFileSync(path.join(target,'SKILL.md')).equals(fs.readFileSync(path.join(repository,'skills/grilling/SKILL.md'))));
  assert.equal(planAgentSkill('grilling',root).copy.length,0);
  fs.writeFileSync(path.join(target,'LOCAL.md'),'local edit');
  const drift=planAgentSkill('grilling',root);
  assert.deepEqual(drift.localOnly,['LOCAL.md']);
  assert.throws(()=>applyAgentSkill(drift,path.join(home,'.claude','skill-backups','grilling.pre-sync-2')),/仓库没有的文件/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
