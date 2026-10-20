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
 const previous={files:{[safe]:'hash',[skill]:'hash','skills/user/SKILL.md':'hash','sessions/user.json':'hash','memories/user.md':'hash','profiles/desktop/node_modules/package/lib/index.js':'hash','profiles/desktop/agent-capabilities/../../outside.mjs':'hash'}};
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
