import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {repository,renderPlan,settingsFrom,emitYaml,parseArgs,status,capture,staleModulePaths} from '../scripts/harness.mjs';
import {createHash} from 'node:crypto';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
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
 if(plugins.length){assert(patch.includes(pathToFileURL(path.join(target,'profiles/desktop/agent-capabilities')).href));assert(patch.includes('!!js "process.platform'));}
 assert(!patch.includes('${'));
 if(plugins.length)assert(plan.get('profiles/headless/cordis.patch.yml').includes('"disabled": true'));
 for(const profile of ['desktop','headless'])assert.doesNotThrow(()=>JSON.parse(plan.get('profiles/'+profile+'/package.json')));
 fs.rmdirSync(base);
});
test('only explicit expression nodes emit JS tags; scalar strings retain their text',()=>{
 const rendered=emitYaml([{value:{$js:'process.cwd()'},text:'!!js dangerous()',nested:{value:'ordinary'}}]);
 assert(rendered.includes('"value": !!js "process.cwd()"'));assert(rendered.includes('"text": "!!js dangerous()"'));
 assert.deepEqual(parseArgs(['install','--home','relative home','--dry-run']).dryRun,true);
 assert.throws(()=>parseArgs(['install','--settings']),/Missing/);
});

test('idle maintenance installs only on desktop and binds inside native compaction isolation',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'idle portable home'),settings);
 const config=JSON.parse(fs.readFileSync(path.join(repository,'config/desktop.patch.json'),'utf8'));
 const globalPolicy=config.flatMap(row=>row.insert??[]).find(row=>row.id==='idle-compaction');
 assert.deepEqual(globalPolicy.config,{enabled:true,idleMs:3240000,minTokens:200000});
 const preset=config.find(row=>row.id==='preset-standard');
 const group=preset.config.plugins.find(row=>row.id==='compaction');
 assert.equal(group.isolate.compaction,true);
 assert(group.config.some(row=>row.id==='idle-compaction-agent'));
 for(const role of ['explore','planner','reviewer']){
  const rolePreset=config.flatMap(row=>row.insert??[]).find(row=>row.id==='preset-'+role);
  const roleGroup=rolePreset.config.plugins.find(row=>row.id==='compaction');
  assert.equal(roleGroup.isolate.compaction,true);
  assert(roleGroup.config.some(row=>row.id==='idle-compaction-agent'));
 }
 for(const file of ['idle-compaction.mjs','idle-compaction-agent.mjs'])assert(plan.has('profiles/desktop/agent-capabilities/'+file));
 assert(!plan.get('profiles/headless/cordis.patch.yml').includes('idle-compaction'));
 assert(!renderPlan(path.join(os.tmpdir(),'native idle home'),settings,{}, {clean:true}).get('profiles/desktop/cordis.patch.yml').includes('idle-compaction'));
});

test('official OpenSpec skills deploy portably and native cleanup removes only managed skill files',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'spec portable home'),settings),base='profiles/desktop/agent-capabilities/skills/';
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
 assert(plan.get('profiles/desktop/cordis.patch.yml').includes('customSkillDirs'));
 const delivery=base+'dsh-spec-delivery/SKILL.md';
 assert.equal(plan.get(delivery),fs.readFileSync(path.join(repository,'skills/dsh-spec-delivery/SKILL.md'),'utf8'));
 assert.deepEqual(staleModulePaths({sources:{[delivery]:'old'}},new Map()),[delivery]);
});

test('enhanced modules and skills deploy with bounded workflow and both browser servers',()=>{
 const home=path.join(os.tmpdir(),'enhanced portable home');
 const plan=renderPlan(home,settings),base='profiles/desktop/agent-capabilities/skills/';
 for(const name of ['workflow-orchestration','dsh-code-review','security-review','claude-context','usage-report','dynamic-ui'])
  assert.equal(plan.get(base+name+'/SKILL.md'),fs.readFileSync(path.join(repository,'skills',name,'SKILL.md'),'utf8'));
 assert.equal(plan.get(base+'security-review/scan.mjs'),fs.readFileSync(path.join(repository,'skills/security-review/scan.mjs'),'utf8'));
 for(const relative of ['patterns/line.md','patterns/manifest.json','preview.py'])
  assert.equal(plan.get(base+'dynamic-ui/'+relative),fs.readFileSync(path.join(repository,'skills/dynamic-ui',relative),'utf8'),'动态图元资源必须随技能部署: '+relative);
 for(const name of ['claude-context.mjs','usage-report.mjs','session-bus.mjs'])
  assert.equal(plan.get('profiles/desktop/agent-capabilities/'+name),fs.readFileSync(path.join(repository,'modules',name),'utf8'));

 const config=JSON.parse(fs.readFileSync(path.join(repository,'config/desktop.patch.json'),'utf8'));
 const preset=config.find(row=>row.id==='preset-standard');
 const ids=config.flatMap(row=>row.insert??[]).map(row=>row.id);
 for(const id of ['claude-context','usage-report','session-bus'])assert(ids.includes(id),id+' must mount globally, not per preset');
 assert(!preset.config.plugins.some(row=>['claude-context','usage-report','session-bus'].includes(row.id)));
 const workflow=preset.config.plugins.find(row=>row.id==='delegation').config.find(row=>row.id==='workflow-ptc');
 assert.deepEqual(workflow.config,{provider:'spawn',maxConcurrentAgents:16,maxTotalAgents:1000});
 const subagent=config.find(row=>row.id==='subagent');
 assert.deepEqual(subagent.config,{maxActiveSubagents:20,maxDepth:3});
 const presetIds=config.flatMap(row=>row.insert??[]).map(row=>row.id);
 assert(!presetIds.includes('preset-cc'),'retired cc preset must not be declared');
 const allowed=preset.config.plugins.find(row=>row.id==='delegation').config.find(row=>row.id==='tool-subagent').config.allowedAgentPresets;
 assert(!allowed.includes('cc'),'retired cc preset must not be selectable');

 const browsers=config.flatMap(row=>row.insert??[]).filter(row=>row.id?.startsWith('mcp-playwright'));
 assert.equal(browsers.length,2);
 for(const row of browsers)assert(row.config.args.includes('${BROWSER}'));
 const session=browsers.find(row=>row.id==='mcp-playwright-session');
 assert(session.config.args.includes('--user-data-dir'));
 assert(session.config.args.some(arg=>arg.includes('browser-profiles/playwright-session')));

 const rendered=renderPlan(home,{...settings,browser:'msedge'}).get('profiles/desktop/cordis.patch.yml');
 assert.equal((rendered.match(/msedge/g)??[]).length,2);
 assert(!rendered.includes('${'));

 const stale=base+'security-review/scan.mjs';
 assert.deepEqual(staleModulePaths({sources:{[stale]:'old','skills/user/SKILL.md':'keep'}},new Map()),[stale]);
 const retired=base+'code-review/SKILL.md';
 assert.deepEqual(staleModulePaths({sources:{[retired]:'old'}},new Map()),[retired]);
});

test('desktop configuration does not register the retired liangshen preset',()=>{
 const rendered=renderPlan(path.join(os.tmpdir(),'legacy-session-home'),settings).get('profiles/desktop/cordis.patch.yml');
 const patch=JSON.parse(rendered.replace(/!!js ("(?:[^"\\]|\\.)*")/g,'{"$js":$1}'));
 assert(!patch.flatMap(row=>[row,...(row.insert??[])]).some(row=>row.config?.id==='liangshen'));
});
test('locks replace both tarball names and checksums for a different checkout build',()=>{
 const artifacts=Object.fromEntries(plugins.map(({id})=>[id,{filename:id+'-another-checkout.tgz',integrity:'sha512-'+id+'-another-checkout'}]));
 const text=renderPlan(path.join(os.tmpdir(),'separate-lock-home'),settings,artifacts).get('profiles/desktop/pnpm-lock.yaml');
 const source=fs.readFileSync(path.join(repository,'config/desktop.lock.yaml'),'utf8');
 for(const {id} of plugins){
  assert(source.includes('${'+id.toUpperCase()+'_INTEGRITY}'),'Checksums must remain template values');
  assert(text.includes(artifacts[id].integrity));assert(text.includes(artifacts[id].filename));
 }
 assert(!text.includes('${'));
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
 fs.writeFileSync(path.join(folder,'.portable-harness/state.json'),JSON.stringify({files:{'module.mjs':hash(file)}}));
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
 const safe='profiles/desktop/agent-capabilities/role-policy.mjs',skill='profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md';
 const previous={sources:{[safe]:'hash',[skill]:'hash','skills/user/SKILL.md':'hash','sessions/user.json':'hash','memories/user.md':'hash','profiles/desktop/node_modules/package/lib/index.js':'hash','profiles/desktop/agent-capabilities/../../outside.mjs':'hash'}};
 assert.deepEqual(staleModulePaths(previous,new Map()),[safe,skill]);assert.deepEqual(staleModulePaths(previous,new Map([[safe,'new'],[skill,'new']])),[]);
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

 test('PTC reuses standard capabilities and only changes tool presentation', () => {
  const text=renderPlan(path.join(os.tmpdir(),'ptc portable home'),settings).get('profiles/desktop/cordis.patch.yml');
  const rows=JSON.parse(text.replace(/!!js ("(?:[^"\\]|\\.)*")/g,'{"$js":$1}'));
  const standard=rows.find(row=>row.id==='preset-standard').config;
  const ptc=rows.find(row=>row.id==='preset-ptc').config;
  assert.deepEqual(ptc.plugins.slice(0,-1),standard.plugins);
  assert.deepEqual(ptc.plugins.at(-1).config,{mode:'ptc'});
  const delegation=ptc.plugins.find(row=>row.id==='delegation');
  assert.equal(delegation.config.find(row=>row.id==='tool-workflow').name,'@local/dsh-tool-workflow');
  assert.equal(delegation.config.find(row=>row.id==='workflow-ptc').config.maxConcurrentAgents,16);
 });
