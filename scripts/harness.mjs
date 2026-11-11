import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import testHome from './test-home.cjs';
import {checkRtk} from './check-rtk.mjs';
import {stableNodeCommand} from './node-command.mjs';
import {auditInstalledManifests} from './installation-audit.mjs';
import {parseHooksFile, describeHooks, readStateFile, writeStateFile} from '../plugins/codex-hooks/lib/core.js';
import {reconcileDeployment, deploymentInputs, baselinePath, preservedConfig, pluginPreferenceFiles, assertNoUncapturedCode, assertManagedSkillPath} from './deployment-state.mjs';

export const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);};
const json=value=>JSON.stringify(value,null,2)+'\n';
const digest=file=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const configuration=name=>readJson(path.join(repository,'config',name));
const provenance=readJson(path.join(repository,'provenance.json'));
const stamp=()=>new Date().toISOString().replaceAll(':','-').replaceAll('.','-');

function dependencyPatches(manifest,{includeTransitive=false}={}){
 // Desktop patches may target a dependency of a bundle (for example agentero-dsh-pdf); the daily
 // desktop manifest is the only profile that receives patchedDependencies.
 if(includeTransitive)return {...configuration('dependency-patches.json')};
 return Object.fromEntries(Object.entries(configuration('dependency-patches.json')).filter(([key])=>Object.entries(manifest.dependencies??{}).some(([name,version])=>key===name+'@'+version||key===name)));
}

export function emitYaml(value){
 // JSON is YAML flow syntax; only explicit $js nodes become Harness expression tags.
 return json(value).replace(/\{\s*"\$js":\s*("(?:[^"\\]|\\.)*")\s*\}/g,'!!js $1');
}
export function substitute(value,tokens){
 if(Array.isArray(value))return value.map(x=>substitute(x,tokens));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,substitute(v,tokens)]));
 if(typeof value!=='string')return value;
 if(Object.hasOwn(tokens,value))return tokens[value];
 return value.replace(/\$\{[A-Z_]+\}/g,key=>{assert(Object.hasOwn(tokens,key),'Unknown template token: '+key);return String(tokens[key]);});
}
export function settingsFrom(file,env=process.env){
 const value={...configuration('local.example.json'),...(fs.existsSync(file)?readJson(file):{})};
 if(env.OPENAI_BASE_URL)value.proxyBaseUrl=env.OPENAI_BASE_URL;
 const allowed=Object.keys(configuration('local.example.json'));
 for(const key of Object.keys(value))assert(allowed.includes(key),'Unknown local setting (credentials belong in environment/credential store): '+key);
 const url=new URL(value.proxyBaseUrl);
 assert(['http:','https:'].includes(url.protocol),'Proxy must use HTTP(S)');
 assert(!url.username&&!url.password&&!url.search&&!url.hash,'Do not put credentials or query parameters in proxyBaseUrl');
 assert(['read-only','workspace-write','danger-full-access'].includes(value.permissionPreset),'Unknown permission preset');
 assert(['chrome','msedge','chromium','firefox','webkit'].includes(value.browser),'Unsupported browser');
 assert(value.additionalProviders&&typeof value.additionalProviders==='object'&&!Array.isArray(value.additionalProviders),'additionalProviders must be an object');
 for(const [id,provider] of Object.entries(value.additionalProviders)){
  assert(/^[a-z][a-z0-9_-]*$/i.test(id)&&!['__proto__','prototype','constructor'].includes(id),'Invalid additional provider id');
  assert(provider&&typeof provider==='object'&&!Array.isArray(provider),'Invalid additional provider');
  for(const key of Object.keys(provider))assert(['displayName','apiKeyEnv','api','baseURL','models'].includes(key),'Unsupported provider field; keep secrets in the credential store');
  if(provider.apiKeyEnv!==undefined)assert(typeof provider.apiKeyEnv==='string','apiKeyEnv must name an environment/credential reference');
  assert(Array.isArray(provider.models)&&provider.models.every(m=>m&&typeof m.id==='string'&&m.id.length>0),'Additional provider needs model ids');
  if(provider.baseURL){const endpoint=new URL(provider.baseURL);assert(['http:','https:'].includes(endpoint.protocol)&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'Provider URL must not embed credentials');}
 }
 const providers={...configuration('desktop.patch.json').find(x=>x.id==='llm-pi-ai').config.providers,...value.additionalProviders};
 assert(providers[value.defaultProvider]?.models?.some(x=>x.id===value.defaultModel),'Configure the selected provider/model before deploying');
 return value;
}
export function renderPlan(home,settings,artifacts={}, {clean=true}={}){
 home=path.resolve(home);
 const directory=path.join(repository,'presets/native');
 const config=name=>readJson(path.join(directory,name));
 const moduleNames=[];
 const desktop=path.join(home,'profiles','desktop');
 const tokens={
  '${DSH_HOME}':home,'${DESKTOP_DIR}':desktop,'${NODE_EXECUTABLE}':stableNodeCommand(),
  '${MODULE_URL}':pathToFileURL(path.join(desktop,'agent-capabilities')).href,
  '${PROXY_BASE_URL}':settings.proxyBaseUrl,'${DEFAULT_MODEL}':settings.defaultModel,'${BROWSER}':settings.browser,
  '${REASONING_EFFORT}':settings.reasoningEffort,'${PERMISSION_PRESET}':settings.permissionPreset,
  '${USER_HOME}':os.homedir(),
 };
 const files=new Map();
 for(const profile of ['desktop','headless']){
  const manifest=config(profile+'.package.json');
  for(const [pkg,spec]of Object.entries(manifest.dependencies??{}))if(spec.startsWith('@artifact/')){
   const id=spec.slice('@artifact/'.length);manifest.dependencies[pkg]='file:../../local-plugins/'+(artifacts[id]?.filename??id+'-preview.tgz');
  }
  files.set('profiles/'+profile+'/package.json',json(manifest));
  for(const relative of Object.values(dependencyPatches(manifest))){
   assert(/^patches\/[a-z0-9-]+\.patch$/.test(relative),'Unsupported dependency patch path');
   files.set('profiles/'+profile+'/'+relative,fs.readFileSync(path.join(repository,'config',relative),'utf8'));
  }
  files.set('profiles/'+profile+'/pnpm-workspace.yaml',json({...config('pnpm-workspace.json'),...(!clean?{patchedDependencies:dependencyPatches(manifest)}:{})}));
  const patch=substitute(config(profile+'.patch.json'),tokens);
  const modelAdapter=patch.find(row=>row.id==='llm-pi-ai');
  if(modelAdapter)Object.assign(modelAdapter.config.providers,settings.additionalProviders);
  const defaultModel=patch.find(row=>row.id==='agent-default-model');
  if(defaultModel){defaultModel.config.provider=settings.defaultProvider;if(settings.reasoningEffort===null)delete defaultModel.config.reasoningEffort;}
  files.set('profiles/'+profile+'/cordis.patch.yml',emitYaml(patch));

 }
 files.set('cordis.patch.yml',emitYaml(substitute(config('global.patch.json'),tokens)));
 files.set('AGENTS.md',fs.readFileSync(path.join(directory,'AGENTS.md'),'utf8'));
 for(const name of moduleNames){
  files.set('profiles/desktop/agent-capabilities/'+name,fs.readFileSync(path.join(repository,'modules',name),'utf8'));
 }
 files.set('profiles/desktop/agent-capabilities/manifest.json',json({managedBy:'deepseek-harness-config',flavor:clean?'native':provenance.flavor,runtime:provenance.runtime,modules:Object.fromEntries(moduleNames.map(name=>[name,digest(path.join(repository,'modules',name))])),artifacts}));
 return files;
}
const SKILL_RESOURCE_EXTENSIONS=new Set(['.mjs','.js','.json','.md','.py','.sh','.txt','.yaml','.yml','.html','.jsx','.xml','.png','.template']);
const skillContent=file=>fs.readFileSync(file,path.extname(file)==='.png'?undefined:'utf8');
function skillResources(directory,prefix=''){
 const found=[];
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const relative=prefix+entry.name;
  if(entry.isDirectory()){found.push(...skillResources(path.join(directory,entry.name),relative+'/'));continue}
  if(!entry.isFile()||relative==='SKILL.md')continue;
  if(SKILL_RESOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))found.push(relative);
 }
 return found;
}

// The desktop uses native presets plus individually managed capabilities.
export function renderDailyPlan(home, settings, artifacts = {}) {
 const files = renderPlan(home, settings, {}, {clean:true});
 for(const [file,value] of Object.entries(configuration('plugin-preferences.json'))){
  assert(pluginPreferenceFiles.has(file),'Unsupported plugin preference file');
  files.set(file,json(value));
 }
 const oldPath = path.join(path.resolve(home),'profiles','desktop');
 files.set('hooks.json',json(renderRtkHooks(home)));
 files.set('profiles/desktop/agent-capabilities/rtk-hooks.mjs',fs.readFileSync(path.join(repository,'modules/rtk-hooks.mjs'),'utf8'));
 const daily = configuration('desktop.package.json');
 for(const [pkg,spec]of Object.entries(daily.dependencies))if(spec.startsWith('@artifact/')){
  const id=spec.slice(10);daily.dependencies[pkg]='file:../../local-plugins/'+(artifacts[id]?.filename??id+'-preview.tgz');
 }
 files.set('profiles/desktop/package.json',json(daily));
 files.set('profiles/desktop/pnpm-workspace.yaml',json({...JSON.parse(files.get('profiles/desktop/pnpm-workspace.yaml')),patchedDependencies:dependencyPatches(daily,{includeTransitive:true}),
 }));
 for(const relative of Object.values(dependencyPatches(daily,{includeTransitive:true}))){
  assert(/^patches\/[a-z0-9-]+\.patch$/.test(relative),'Unsupported dependency patch path');
  files.set('profiles/desktop/'+relative,fs.readFileSync(path.join(repository,'config',relative),'utf8'));
 }
 const patch = JSON.parse(files.get('profiles/desktop/cordis.patch.yml'));
 // Preserve the configured API-key setup and native appearance; removing these
 // UI preferences would send an already configured desktop back into onboarding.
 for(const row of configuration('desktop.patch.json'))
  if(['ui-settings-account','locale','ui-theme'].includes(row.id))patch.push(row);
 patch.push({id:'agent-preset-registry',config:{default:'standard',selectedDefault:'standard'}});
 // dsh-memu-memory 自带 cordis.patch.yml 注册宿主工具与客户端界面，用户设置存在
 // <DSH_HOME>/dsh-memu-memory/state.json，不进 profile patch，这里无需追加行。
 patch.push({insert:[
  {id:'computer-use',name:'@deepseek-ai/dsh-computer-use'},
  {id:'computer-use-native',name:'@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'},
 ]});
 patch.push({id:'compaction-basic',name:pathToFileURL(path.join(oldPath,'agent-capabilities','compaction-basic.mjs')).href});
 files.set('profiles/desktop/agent-capabilities/compaction-basic.mjs',fs.readFileSync(path.join(repository,'modules/compaction-basic.mjs'),'utf8'));

 const widgetSkill=path.join(oldPath,'agent-capabilities','inline-skills','dynamic-ui');
 patch.push({id:'dynamic-ui-view',config:{skillDirectory:widgetSkill}});
 patch.push({id:'liclick-adapter',config:{stateDirectory:path.join(oldPath,'liclick-adapter')}});
 for(const file of ['SKILL.md',...skillResources(path.join(repository,'skills/dynamic-ui'))])
  files.set('profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/'+file,
   fs.readFileSync(path.join(repository,'skills/dynamic-ui',file),'utf8'));
 patch.push(substitute(configuration('desktop.patch.json').find(row=>row.id==='permission'),{'${PERMISSION_PRESET}':settings.permissionPreset}));
 patch.push({insert:[{id:'isolated-browser',name:pathToFileURL(path.join(oldPath,'agent-capabilities','isolated-browser.mjs')).href,config:{
  command:stableNodeCommand(),cli:path.join(oldPath,'node_modules','@playwright','mcp','cli.js'),browser:settings.browser,outputRoot:path.join(home,'browser-output','isolated')
 }}]});
 // Daily defaults follow the selected management switches; native
 // pluginManager still controls each entry after deployment.
 const optionalModules = {
  'claude-context':'claude-context.mjs',
 };
 patch.push({insert:Object.entries(optionalModules).map(([id,file])=>({id,
  name:pathToFileURL(path.join(oldPath,'agent-capabilities',file)).href,
  disabled:false}))});
 for(const file of Object.values(optionalModules))
  files.set('profiles/desktop/agent-capabilities/'+file,fs.readFileSync(path.join(repository,'modules',file),'utf8'));
 // Restore on-demand skills without the removed automatic orchestration policy.
 // Dynamic UI has its own provider; optional computer-use guidance stays separate.
 const separateSkills = new Set(['dynamic-ui']);
 const sharedSkills = new Set(Object.keys(configuration('skill-sources.json')));
 for(const [file,source] of Object.entries(desktopSkillSources())) {
  const skill=file.split('/')[4];
  if(!separateSkills.has(skill))files.set(sharedSkills.has(skill)?source:file.replace('/skills/','/inline-skills/catalog/'),skillContent(path.join(repository,source)));
 }
 files.set('skills/rtk-reference/SKILL.md',fs.readFileSync(path.join(repository,'skills/rtk-reference/SKILL.md'),'utf8'));
 patch.push({insert:[{id:'daily-managed-skills',name:'@deepseek-ai/dsh-skill-filesystem',config:{
  providerName:'daily-managed',includeDefaultRoots:false,
  bundledSkillDir:path.join(oldPath,'agent-capabilities','inline-skills','catalog'),
 }}]});
 files.set('profiles/desktop/cordis.patch.yml',emitYaml(patch));
 files.set('profiles/desktop/agent-capabilities/isolated-browser.mjs',fs.readFileSync(path.join(repository,'modules/isolated-browser.mjs'),'utf8'));
 files.set('profiles/desktop/agent-capabilities/manifest.json',json({managedBy:'deepseek-harness-config',flavor:'daily',runtime:provenance.runtime,
  modules:Object.fromEntries(['isolated-browser.mjs','compaction-basic.mjs','rtk-hooks.mjs',...Object.values(optionalModules)].map(file=>[file,digest(path.join(repository,'modules',file))])),artifacts:{}}));

 files.set('AGENTS.md',fs.readFileSync(path.join(repository,'presets/daily/AGENTS.md'),'utf8'));
 return files;
}
function plannedProfiles(files) {
 return [...files.keys()].flatMap(file=>file.match(/^profiles\/([^/]+)\/package\.json$/)?.[1]??[]);
}
function desktopSkillSources(){
 const base='profiles/desktop/agent-capabilities/skills/';
 const sources={};
 const root=path.join(repository,'skills');
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const directory=path.join(root,entry.name);
  const files=fs.readdirSync(directory,{withFileTypes:true});
  if(!files.some(file=>file.isFile()&&file.name==='SKILL.md'))continue;
  sources[base+entry.name+'/SKILL.md']='skills/'+entry.name+'/SKILL.md';
  for(const relative of skillResources(directory))sources[base+entry.name+'/'+relative]='skills/'+entry.name+'/'+relative;
 }
 for(const entry of fs.readdirSync(path.join(repository,'.dsh/skills'),{withFileTypes:true}))if(entry.isDirectory()&&/^openspec-[a-z0-9-]+$/.test(entry.name))sources[base+entry.name+'/SKILL.md']='.dsh/skills/'+entry.name+'/SKILL.md';
 return sources;
}
function execute(command,args,options={}){
 const result=spawnSync(command,args,{encoding:'utf8',...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(path.basename(command)+' failed ('+result.status+')\n'+(result.stderr??'')+'\n'+(result.stdout??''));
 return result.stdout??'';
}
function npmCli(){
 const candidates=[process.env.NPM_CLI_JS,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),path.resolve(path.dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js')].filter(Boolean);
 const found=candidates.find(fs.existsSync);assert(found,'Cannot find npm-cli.js; set NPM_CLI_JS locally');return found;
}
export function runner(){
 const appRoot=process.env.DSH_APP_DIR??path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'Programs','DeepSeek Harness');
 const executable=process.env.DSH_EXECUTABLE??path.join(appRoot,'DeepSeek Harness.exe');
 const cli=process.env.DSH_CLI_JS??path.join(appRoot,'resources','app.asar','dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');
 assert(fs.existsSync(executable),'Desktop runtime not found; set DSH_EXECUTABLE and DSH_CLI_JS locally');
 return {executable,cli};
}
function native(command,home,profile,args,stdio='inherit'){
 return execute(command.executable,['--expose-internals',command.cli,'plugin','--profile',profile,...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home},stdio});
}
export function build({clean=false}={}){
 const folder=path.join(repository,'build');fs.mkdirSync(folder,{recursive:true});
 const records={};
 for(const plugin of clean?[]:provenance.plugins){
  const packed=JSON.parse(execute(process.execPath,[npmCli(),'pack','--ignore-scripts','--json','--pack-destination',folder],{cwd:path.join(repository,'plugins',plugin.id)}))[0];
  const source=path.join(folder,packed.filename);const hash=digest(source);
  const filename=plugin.id+'-'+plugin.version+'-'+hash.slice(0,12)+'.tgz';
  fs.copyFileSync(source,path.join(folder,filename));records[plugin.id]={filename,sha256:hash,integrity:packed.integrity};
 }
 write(path.join(folder,'artifacts.json'),json(records));return records;
}
function globalRuntime(){
 const root=execute(process.execPath,[npmCli(),'root','-g']).trim();
 const location=path.join(root,'@deepseek-ai','dsh');
 const manifest=path.join(location,'package.json');
 assert(fs.existsSync(manifest),'Install the matching global @deepseek-ai/dsh version first; see README');
 return path.join(location,'node_modules');
}
function linkRuntime(home,source){
 // Local modules use the same native dependency closure as the global CLI.
 const root=path.join(home,'profiles','node_modules');fs.mkdirSync(root,{recursive:true});
 function link(name){
  const from=path.join(source,name),to=path.join(root,name);
  if(!fs.existsSync(from))return;
  if(fs.lstatSync(to,{throwIfNoEntry:false}))return;
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.symlinkSync(from,to,process.platform==='win32'?'junction':'dir');
 }
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  if(entry.name.startsWith('.'))continue;
  if(entry.name.startsWith('@'))for(const child of fs.readdirSync(path.join(source,entry.name)))link(entry.name+'/'+child);
  else if(entry.isDirectory()||entry.isSymbolicLink())link(entry.name);
 }
}
function backup(home,files){
 const folder=path.join(home,'backups','portable-harness-'+stamp());
 const records=[];
 for(const relative of files){
  assert(!path.isAbsolute(relative)&&!relative.split('/').includes('..'),'Unsafe backup path');
  const target=path.join(home,relative);const exists=fs.existsSync(target);
  if(exists){fs.mkdirSync(path.dirname(path.join(folder,relative)),{recursive:true});fs.copyFileSync(target,path.join(folder,relative));}
  records.push({path:relative,existed:exists});
 }
 write(path.join(folder,'backup.json'),json(records));return folder;
}
export function staleModulePaths(previous,next){
 const base='profiles/desktop/agent-capabilities/';
 return Object.keys(previous?.sources??{}).filter(relative=>{
  if(relative.startsWith('skills/')&&previous.sources[relative]===relative&&!relative.split('/').includes('..'))return !next.has(relative);
  if(!relative.startsWith(base))return false;
  const rest=relative.slice(base.length).split('/');
  return ((rest.length===1&&rest[0].endsWith('.mjs'))||(rest.length>=3&&['skills','inline-skills'].includes(rest[0])))&&!next.has(relative);
 });
}
export function renderRtkHooks(home) {
 const quote=value=>{
  if(process.platform==='win32'){
   assert(!/["%\r\n]/.test(value),'Unsupported characters in the RTK hook path');
   return '"'+value+'"';
  }
  return "'"+value.replaceAll("'", "'\"'\"'")+"'";
 };
 const script=path.join(path.resolve(home),'profiles','desktop','agent-capabilities','rtk-hooks.mjs');
 const command=quote(stableNodeCommand())+' '+quote(script);
 return substitute(configuration('rtk-hooks.json'),{'${RTK_CONTEXT_COMMAND}':command+' context','${RTK_CHECK_COMMAND}':command+' check'});
}
export function configureRtkHook(home) {
 const file=path.join(home,'hooks.json');
 const options={sourceKey:file,platform:process.platform};
 const expected=new Set(describeHooks(parseHooksFile(json(renderRtkHooks(home))),options).map(hook=>hook.hash));
 const hooks=describeHooks(parseHooksFile(fs.readFileSync(file,'utf8')),options);
 const stateFile=path.join(home,'hooks.state.json'),state=readStateFile(stateFile);
 for(const hook of hooks)if(expected.has(hook.hash))state.states[hook.key]={...state.states[hook.key],trustedHash:hook.hash};
 writeStateFile(stateFile,state);
}
export function install(home,settings,{dryRun=false,refreshLock=false,clean=false,settings:settingsFile}={}){
 if(!clean&&!dryRun)checkRtk();
 const runtime=globalRuntime();
 const runtimeVersion=readJson(path.join(runtime,'..','package.json')).version;
 const command=runner();
 const desktopVersion=execute(command.executable,['--expose-internals',command.cli,'--version'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}).trim();
 assertMatchingRuntimes(desktopVersion,runtimeVersion);
 const plan = records => {
  const files=clean ? renderPlan(home,settings,records,{clean:true}) : renderDailyPlan(home,settings,records);
  for(const profile of plannedProfiles(files)){
   const file='profiles/'+profile+'/package.json';
   files.set(file,json(bindRuntimeDependencies(JSON.parse(files.get(file)),runtimeVersion)));
  }
  return files;
 };
 const stateFile=path.join(home,'.portable-harness/state.json');
 const previous=fs.existsSync(stateFile)?readJson(stateFile):undefined;
 assert(!previous?.pending,'Previous installation is incomplete; rollback before installing again');
 const parseYaml=text=>{
  try{return JSON.parse(text);}catch{}
  const yaml=createRequire(path.join(globalRuntime(),'..','package.json'))('yaml');
  const document=yaml.parseDocument(text,{logLevel:'silent',customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>({$js:value})}]});
  assert(!document.errors.length&&!document.warnings.some(w=>w.code==='TAG_RESOLVE_FAILED'),'Unsupported configuration syntax');
  return document.toJS({maxAliasCount:100});
 };
 const prepare=files=>{
  if(clean)return {
   baselines:new Map([...files].filter(([file])=>preservedConfig(file)).map(([file,text])=>[baselinePath(file),text])),
   customProfiles:new Set(),
  };
  return reconcileDeployment(home,files,previous,{parseYaml,emitYaml});
 };
 const existingArtifacts=path.join(repository,'build/artifacts.json');
 const preview=plan(fs.existsSync(existingArtifacts)?readJson(existingArtifacts):{});
 if(!clean)for(const [file,content] of preview)if(file.startsWith('skills/')){
  assertManagedSkillPath(home,file);
  const target=path.join(home,file);
  if(fs.existsSync(target)&&!previous?.files?.[file])
   assert(fs.readFileSync(target).equals(Buffer.from(content)),'Existing DSH skill differs: '+file+'; retain it and resolve before deployment');
 }
 if(!clean)assertNoUncapturedCode(home,previous,repository,preview);
 prepare(preview);
 if(dryRun){console.log('Would manage '+preview.size+' files in the selected DSH_HOME; source templates remain unchanged.');return preview;}
 assert(new URL(settings.proxyBaseUrl).hostname!=='proxy.example.invalid','Configure .local/settings.json or OPENAI_BASE_URL before deploying');
 assert.equal(migrateLiangshen(home,{dryRun:true}).count,0,'Legacy sessions remain; quit Harness and run: node scripts/harness.mjs migrate-liangshen');
 const records=build({clean});const files=plan(records);
 const {baselines}=prepare(files);
 const profiles=plannedProfiles(files);
 if(refreshLock)for(const profile of profiles)files.delete('profiles/'+profile+'/pnpm-lock.yaml');
 const extra=[...profiles.flatMap(profile=>['profiles/'+profile+'/pnpm-lock.yaml','profiles/'+profile+'/pnpm-workspace.yaml']),'.portable-harness/state.json','hooks.state.json'];
 const stale=[...staleModulePaths(previous,files),...Object.keys(previous?.files??{}).filter(file=>/^profiles\/(?:desktop|headless)\/patches\/[a-z0-9-]+\.patch$/.test(file)&&!files.has(file)),...Object.keys(previous?.files??{}).filter(file=>file.startsWith('profiles/enhanced/')&&!file.includes('/node_modules/'))];
 for(const file of stale)if(file.startsWith('skills/'))assertManagedSkillPath(home,file);
 const saved=backup(home,[...new Set([...files.keys(),...baselines.keys(),...stale,...extra])]);
 write(path.join(home,'.portable-harness/state.json'),json({backup:path.relative(home,saved).split(path.sep).join('/'),files:{},sources:{},sourceHashes:{},pending:true}));
 try{
  fs.mkdirSync(path.join(home,'local-plugins'),{recursive:true});
  for(const data of Object.values(records))fs.copyFileSync(path.join(repository,'build',data.filename),path.join(home,'local-plugins',data.filename));
  for(const [relative,content]of files){
   if(relative.startsWith('skills/'))assertManagedSkillPath(home,relative);
   write(path.join(home,relative),content);
  }
  for(const relative of stale){const target=path.join(home,relative);const info=fs.lstatSync(target,{throwIfNoEntry:false});if(info){assert(info.isFile()||info.isSymbolicLink(),'Old module must be a file');fs.unlinkSync(target);}}
  linkRuntime(home,runtime);
  for(const profile of profiles){
   const manifest=readJson(path.join(home,'profiles',profile,'package.json'));
   const targets=latestDependencies(manifest);
   // Explicit targets leave local artifacts and user-pinned market installs intact.
   native(command,home,profile,targets.length?['update',...targets,'--latest']:['install','--no-frozen-lockfile']);
  }
  if(!clean)configureRtkHook(home);
  for(const [relative,content]of baselines)write(path.join(home,relative),content);
  const tracked={};for(const relative of files.keys())if(!pluginPreferenceFiles.has(relative))tracked[relative]=digest(path.join(home,relative));
  for(const profile of profiles)tracked['profiles/'+profile+'/pnpm-lock.yaml']=digest(path.join(home,'profiles',profile,'pnpm-lock.yaml'));
  const sources={};
  if(!clean)Object.assign(sources,desktopSkillSources());
  if(!clean)for(const file of files.keys())if(file.startsWith('skills/'))sources[file]=file;
  if(!clean&&fs.existsSync(path.join(repository,'modules')))for(const name of fs.readdirSync(path.join(repository,'modules')).filter(x=>x.endsWith('.mjs')))sources['profiles/desktop/agent-capabilities/'+name]='modules/'+name;
  for(const plugin of clean?[]:provenance.plugins){
   const library=path.join(repository,'plugins',plugin.id,'lib');
   const pluginRoot=path.join(repository,'plugins',plugin.id);
   for(const name of fs.readdirSync(pluginRoot).filter(name=>/\.m?js$/.test(name)))sources['profiles/desktop/node_modules/'+plugin.package+'/'+name]='plugins/'+plugin.id+'/'+name;
   if(fs.existsSync(library))for(const entry of fs.readdirSync(library,{withFileTypes:true}))if(entry.isFile()&&/\.m?js$/.test(entry.name))sources['profiles/desktop/node_modules/'+plugin.package+'/lib/'+entry.name]='plugins/'+plugin.id+'/lib/'+entry.name;
  }
  if(!clean){
   for(const name of fs.readdirSync(path.join(repository,'modules')).filter(name=>name.endsWith('.mjs'))){
    const target='profiles/desktop/agent-capabilities/'+name;
    if(files.has(target))sources[target]='modules/'+name;
   }
   for(const [target,source]of Object.entries(desktopSkillSources()))if(files.has(target))sources[target]=source;
   for(const [target,source]of Object.entries(desktopSkillSources())){
    const dailyTarget=target.replace('/skills/','/inline-skills/catalog/');
    if(files.has(dailyTarget))sources[dailyTarget]=source;
   }
   for(const file of ['SKILL.md',...skillResources(path.join(repository,'skills/dynamic-ui'))])
    sources['profiles/desktop/agent-capabilities/inline-skills/dynamic-ui/'+file]='skills/dynamic-ui/'+file;

  }
  for(const relative of Object.keys(sources)){
   if(!fs.existsSync(path.join(home,relative))){delete sources[relative];continue;}
   tracked[relative]=digest(path.join(home,relative));
  }
  write(path.join(home,'.portable-harness/state.json'),json({
   at:new Date().toISOString(),flavor:clean?'native':'daily',runtime:runtimeVersion,
   backup:path.relative(home,saved).split(path.sep).join('/'),files:tracked,sources,
   generatedHashes:Object.fromEntries([...baselines].map(([file,text])=>[file,createHash('sha256').update(text).digest('hex')])),
   inputHashes:deploymentInputs(repository),
   ...(settingsFile?{settingsFile,settingsHash:createHash('sha256').update(json(settings)).digest('hex')}:{}),
   sourceHashes:Object.fromEntries(Object.values(sources).map(p=>[p,digest(path.join(repository,p))])),
  }));
  console.log('Installed portable configuration. Backup: '+path.relative(home,saved));
 }catch(error){console.error('Installation failed. Pre-install backup retained: '+path.relative(home,saved));throw error;}
 return files;
}
export function status(home){
 const file=path.join(home,'.portable-harness/state.json');assert(fs.existsSync(file),'No portable deployment state found; deploy first');
 const state=readJson(file);const changed=[];
 assert(!state.pending,'Previous installation is incomplete; run rollback');
 for(const [relative,hash]of Object.entries(state.files))if(digest(path.join(home,relative))!==hash)changed.push(relative);
 if(state.inputHashes){
  const current=deploymentInputs(repository);
  for(const file of new Set([...Object.keys(state.inputHashes),...Object.keys(current)]))if(current[file]!==state.inputHashes[file])changed.push('source:'+file);
 }else changed.push('source-baseline:unrecorded');
 if(state.settingsFile){
  try{if(createHash('sha256').update(json(settingsFrom(state.settingsFile))).digest('hex')!==state.settingsHash)changed.push('machine-settings:unapplied');}
  catch{changed.push('machine-settings:unreadable-or-invalid');}
 }
 console.log(changed.length?'Local deployment drift or unapplied source changes:\n'+changed.join('\n'):'Managed deployment has no local drift.');
 if(!state.inputHashes)console.log('Legacy deployment has no complete source baseline; latest-source status is unverified.');
 console.log('File/source consistency does not replace host and UI acceptance.');
 const installed=auditInstalledManifests(home,repository,state.flavor);
 console.log(installed.length?'Installed declarations differ from repository (local additions are preserved, not synchronized):\n'+json(installed):'Installed plugin dependencies and bundles match repository declarations.');
 return changed;
}
export function capture(home){
 const state=readJson(path.join(home,'.portable-harness/state.json'));
 const changes=[];
 const bySource=new Map();
 for(const [target,source]of Object.entries(state.sources)){
  if(target.startsWith('skills/'))assertManagedSkillPath(home,target);
  const live=path.join(home,target),file=path.join(repository,source);
  if(digest(live)===state.files[target]||digest(live)===digest(file))continue;
  assert(fs.existsSync(live),'Cannot capture a missing runtime source: '+target);
  assert.equal(digest(file),state.sourceHashes[source],'Both repository and deployed source changed; resolve manually: '+source);
  assert(!bySource.has(source)||bySource.get(source)===digest(live),'Different deployed copies changed the same source; resolve manually: '+source);
  bySource.set(source,digest(live));
  changes.push([live,file,source]);
 }
 for(const [live,file]of changes)fs.copyFileSync(live,file);
 console.log('Captured '+changes.length+' changed source files. Config drift must be edited in config templates or ignored local settings; credentials are never exported.');
}
export function rollback(home){
 const state=readJson(path.join(home,'.portable-harness/state.json'));
 const folder=path.resolve(home,state.backup);
 assert(folder.startsWith(path.join(path.resolve(home),'backups')+path.sep),'Backup must stay inside this DSH_HOME');
 const records=readJson(path.join(folder,'backup.json'));
 for(const entry of records)if(entry.path.startsWith('skills/'))assertManagedSkillPath(home,entry.path);
 backup(home,records.map(x=>x.path));
 for(const entry of records){
  assert(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..'),'Unsafe restore path');
  if(entry.existed)write(path.join(home,entry.path),fs.readFileSync(path.join(folder,entry.path)));
  else {
   const target=path.join(home,entry.path);const info=fs.lstatSync(target,{throwIfNoEntry:false});
   if(info){assert(info.isFile()||info.isSymbolicLink(),'Refusing to remove a directory during file rollback');fs.unlinkSync(target);}
  }
 }
 const command=runner();for(const profile of ['desktop','headless','enhanced'])if(fs.existsSync(path.join(home,'profiles',profile,'package.json')))native(command,home,profile,['install','--frozen-lockfile']);
 console.log('Previous files restored; session/memory stores and added unmounted modules retained.');
}
export function saveLocks(home){
 // Locks are installation receipts and rollback inputs, never shared version policy.
 for(const profile of ['desktop','headless'])
  assert(fs.existsSync(path.join(home,'profiles',profile,'pnpm-lock.yaml')),'Install first to generate a local lockfile');
 console.log('Local installation lockfiles retained; no pinned templates are written to the repository.');
}
export function assertMatchingRuntimes(desktopVersion,cliVersion){
 const version=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
 assert(version.test(desktopVersion)&&version.test(cliVersion),'Invalid runtime version');
 assert.equal(cliVersion,desktopVersion,'Desktop and CLI versions must match. Install @deepseek-ai/dsh@'+desktopVersion+'; npm latest may be a different release channel.');
}
export function bindRuntimeDependencies(manifest,runtimeVersion){
 assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtimeVersion),'Invalid native runtime version');
 return {...manifest,dependencies:Object.fromEntries(Object.entries(manifest.dependencies??{}).map(([name,spec])=>{
  if(spec!=='${DSH_RUNTIME_VERSION}')return [name,spec];
  assert(name.startsWith('@deepseek-ai/'),'Only native packages follow the runtime');
  return [name,runtimeVersion];
 }))};
}
export function latestDependencies(manifest){
 return Object.entries(manifest.dependencies??{}).filter(([,spec])=>spec==='latest').map(([name])=>name);
}
export function parseArgs(args){
 const options={command:args[0]??'status',home:path.resolve(process.env.DSH_HOME??path.join(os.homedir(),'.dsh')),settings:path.join(repository,'.local/settings.json'),dryRun:false};
 for(let i=1;i<args.length;i++){
  if(args[i]==='--dry-run')options.dryRun=true;
  else if(args[i]==='--refresh-lock')options.refreshLock=true;
  else if(['--home','--settings'].includes(args[i])){assert(args[i+1]&&!args[i+1].startsWith('--'),'Missing option value');options[args[i].slice(2)]=path.resolve(args[++i]);}
  else throw new Error('Unknown option: '+args[i]);
 }
 return options;
}
function runtimeCheck(home,script,marker,logFile='automatic-session-runtime.log'){
 assert(process.env.OPENAI_API_KEY,'Set OPENAI_API_KEY locally for the optional real-proxy smoke test');
 const command=runner();
 const state=readJson(path.join(home,'.portable-harness/state.json'));
 const output=execute(command.executable,['--expose-internals',path.join(repository,'scripts',script)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_SMOKE_FLAVOR:state.flavor??provenance.flavor,DSH_NATIVE_ROOT:path.resolve(path.dirname(command.cli),'..','..')}});
 assert(output.includes(marker),'Runtime check did not complete: '+marker);
 const safe=output.replaceAll(process.env.OPENAI_API_KEY,'<redacted>').replace(/([?&]token=)[^\s]+/g,'$1<redacted>');
 write(path.join(repository,'.local',logFile),safe);
 console.log(safe.split(/\r?\n/).filter(x=>x.startsWith(marker)).join('\n'));
}
export function smoke(home){runtimeCheck(home,'smoke.cjs','PORTABLE_SMOKE_PASS','smoke-runtime.log');}
const RUNTIME_TESTS={
 'workflow-test':['test-external-workflow.cjs','EXTERNAL_WORKFLOW_PASS','external-workflow-runtime.log'],
 'btw-test':['test-btw-concurrency.cjs','BTW_CONCURRENCY_PASS','btw-concurrency-runtime.log'],
};
function runtimeTest(home,command){testHome.assertIsolatedHome(home);runtimeCheck(home,...RUNTIME_TESTS[command]);}
export function migrateLiangshen(home,{dryRun=false}={}){
 const command=runner();
 return JSON.parse(execute(command.executable,['--expose-internals',path.join(repository,'scripts/migrate-liangshen.cjs'),...(dryRun?[]:['--apply'])],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_NATIVE_ROOT:path.resolve(path.dirname(command.cli),'..','..')}}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options=parseArgs(process.argv.slice(2));
  if(options.command==='build')console.log(json(build()));
  else if(options.command==='install')install(options.home,settingsFrom(options.settings),options);
  else if(options.command==='clean')install(options.home,settingsFrom(options.settings),{...options,clean:true});
  else if(options.command==='status'){if(status(options.home).length)process.exitCode=1;}
  else if(options.command==='capture')capture(options.home);
  else if(options.command==='rollback')rollback(options.home);
  else if(options.command==='lock')saveLocks(options.home);
  else if(options.command==='smoke')smoke(options.home);
  else if(RUNTIME_TESTS[options.command])runtimeTest(options.home,options.command);
  else if(options.command==='migrate-liangshen')console.log(json(migrateLiangshen(options.home,options)));
  else throw new Error('Unknown command: '+options.command);
 }catch(error){let message=error.message;if(process.env.OPENAI_API_KEY)message=message.replaceAll(process.env.OPENAI_API_KEY,'<redacted>');console.error(message.replace(/([?&]token=)[^\s]+/g,'$1<redacted>'));process.exitCode=1;}
}
