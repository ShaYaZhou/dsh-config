import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const ABSENT=Symbol('absent');
const object=value=>value!==ABSENT&&value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>a===b||(a!==ABSENT&&b!==ABSENT&&JSON.stringify(canonical(a))===JSON.stringify(canonical(b)));
const at=(value,key)=>object(value)&&Object.hasOwn(value,key)?value[key]:ABSENT;
function rowKey(row){
 if(!object(row))return undefined;
 if(typeof row.id==='string')return 'id:'+row.id;
 if(Array.isArray(row.insert)&&typeof row.insert[0]?.id==='string')return 'insert:'+row.insert[0].id;
}

// A true three-way merge: local additions/edits/removals survive when the
// template did not change the same value. Ambiguity fails before any write.
export function mergeManaged(base,live,next,label='managed configuration'){
 if(equal(live,base))return next;
 if(equal(next,base)||equal(live,next))return live;
 if(object(live)&&object(next)&&(object(base)||base===ABSENT)){
  const keys=new Set([...Object.keys(base===ABSENT?{}:base),...Object.keys(next),...Object.keys(live)]);
  return Object.fromEntries([...keys].flatMap(key=>{
   const value=mergeManaged(at(base,key),at(live,key),at(next,key),label);
   return value===ABSENT?[]:[[key,value]];
  }));
 }
 if(Array.isArray(base)&&Array.isArray(live)&&Array.isArray(next)){
  if([...base,...live,...next].every(x=>typeof x==='string')){
   const retained=next.filter(x=>!base.includes(x)||live.includes(x));
   return [...new Set([...retained,...live.filter(x=>!base.includes(x))])];
  }
  const rows=[base,live,next].map(items=>items.map(row=>[rowKey(row),row]));
  if(rows.every(items=>items.every(([key])=>key!==undefined)&&new Set(items.map(([key])=>key)).size===items.length)){
   const [b,l,n]=rows.map(items=>Object.fromEntries(items));
   const merged=mergeManaged(b,l,n,label);
   return [...new Set([...rows[2],...rows[1]].map(([key])=>key))].filter(key=>Object.hasOwn(merged,key)).map(key=>merged[key]);
  }
 }
 // Never include conflicting values: model settings may contain credentials.
 throw new Error('Local and template changes conflict in '+label+'; existing files were not overwritten');
}

export const preservedConfig=file=>file==='AGENTS.md'||file==='cordis.patch.yml'||/^profiles\/[^/]+\/(?:package\.json|cordis\.patch\.yml|pnpm-workspace\.yaml)$/.test(file);
export const baselinePath=file=>'.portable-harness/generated/'+file;
const digest=file=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;

export function reconcileDeployment(home,files,previous,{parseYaml,emitYaml}){
 const baselines=new Map(),customProfiles=new Set();
 for(const [file,desiredText]of files){
  if(!preservedConfig(file))continue;
  baselines.set(baselinePath(file),desiredText);
  const target=path.join(home,file);
  if(!fs.existsSync(target)){
   assert(!previous?.files?.[file],'Managed configuration was removed: '+file+'; existing state retained');
   continue;
  }
  const liveText=fs.readFileSync(target,'utf8');
  let baseText;
  const baseline=path.join(home,baselinePath(file));
  const baselineHash=previous?.generatedHashes?.[baselinePath(file)];
  if(fs.existsSync(baseline)){
   assert(baselineHash&&digest(baseline)===baselineHash,'Untrusted or changed deployment baseline for '+file+'; existing files retained');
   baseText=fs.readFileSync(baseline,'utf8');
  }
  else if(baselineHash)throw new Error('Missing deployment baseline for '+file+'; existing files retained');
  else if(previous?.files?.[file]===digest(target))baseText=liveText;
  else if(liveText===desiredText)baseText=liveText;
  else throw new Error('No trusted deployment baseline for changed '+file+'; existing files were not overwritten');
  const parse=text=>{
   if(file==='AGENTS.md')return text;
   try{return file.endsWith('.json')?JSON.parse(text):parseYaml(text);}
   catch{throw new Error('Cannot safely parse '+file+'; no configuration values printed');}
  };
  const desired=parse(desiredText),merged=mergeManaged(parse(baseText),parse(liveText),desired,file);
  if(equal(merged,desired))continue;
  if(file.endsWith('/package.json')){
   for(const group of ['dependencies','devDependencies','optionalDependencies'])for(const spec of Object.values(merged[group]??{})){
    assert(typeof spec==='string','Invalid dependency in '+file);
    assert(!/:\/\/[^/\s]*@|[?&](?:token|key|password|auth)=/i.test(spec),'Embedded credential in dependency spec in '+file+'; no values printed');
   }
   customProfiles.add(file.split('/')[1]);
  }
  files.set(file,file==='AGENTS.md'?merged:file.endsWith('.json')?JSON.stringify(merged,null,2)+'\n':emitYaml(merged));
 }
 // Preserve the local lock as resolution input for retained market installs.
 // Native pnpm reconciles new managed tarballs without upgrading unrelated pins.
 for(const profile of customProfiles)files.delete('profiles/'+profile+'/pnpm-lock.yaml');
 return {baselines,customProfiles};
}

export function deploymentInputs(repository){
 const files=['provenance.json','scripts/harness.mjs','scripts/deployment-state.mjs'];
 const walk=relative=>{
  const dir=path.join(repository,relative);if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(['node_modules','build','.git'].includes(entry.name))continue;
   const file=relative+'/'+entry.name;
   if(entry.isDirectory())walk(file);else if(entry.isFile())files.push(file);
  }
 };
 for(const root of ['config','presets','modules','plugins','skills','.dsh/skills'])walk(root);
 return Object.fromEntries(files.sort().map(file=>[file,digest(path.join(repository,file))]));
}

export function assertNoUncapturedCode(home,previous,repository,nextFiles=new Map()){
 const targets=new Set([...Object.keys(previous?.sources??{}),...Object.keys(previous?.files??{}).filter(file=>/\.(?:mjs|js)$/.test(file)||file.includes('/agent-capabilities/')&&file.endsWith('.md'))]);
 for(const target of targets){
  const source=previous?.sources?.[target];
  const live=digest(path.join(home,target));
  const desired=source?digest(path.join(repository,source)):nextFiles.has(target)?createHash('sha256').update(nextFiles.get(target)).digest('hex'):undefined;
  if(live===previous.files?.[target]||live===desired)continue;
  throw new Error('Uncaptured installed source change in '+target+'; existing code was not overwritten');
 }
}
