import fs from 'node:fs';
import path from 'node:path';

// Report declarations, never config values: preserved local additions are not source alignment.
export function compareInstalledManifest(expected,installed,artifacts={}){
 const wanted=expected.dependencies??{},actual=installed.dependencies??{};
 const bundles=expected.dsh?.profile?.bundles??[],live=installed.dsh?.profile?.bundles??[];
 return {
  extraDependencies:Object.keys(actual).filter(name=>!Object.hasOwn(wanted,name)),
  missingDependencies:Object.keys(wanted).filter(name=>!Object.hasOwn(actual,name)),
  differentPins:Object.keys(wanted).filter(name=>{
   if(!Object.hasOwn(actual,name))return false;
   if(!wanted[name].startsWith('@artifact/'))return wanted[name]!==actual[name];
   const id=wanted[name].slice(10),record=artifacts[id];
   return record?actual[name]!=='file:../../local-plugins/'+record.filename:!String(actual[name]).startsWith('file:../../local-plugins/'+id+'-');
  }),
  unverifiedArtifacts:Object.keys(wanted).filter(name=>wanted[name].startsWith('@artifact/')&&Object.hasOwn(actual,name)&&!artifacts[wanted[name].slice(10)]),
  extraBundles:live.filter(name=>!bundles.includes(name)),
  missingBundles:bundles.filter(name=>!live.includes(name)),
 };
}

export function auditInstalledManifests(home,repository,flavor='daily'){
 const findings=[];
 const profiles=path.join(home,'profiles');
 const artifactFile=path.join(repository,'build/artifacts.json');
 const artifacts=fs.existsSync(artifactFile)?JSON.parse(fs.readFileSync(artifactFile,'utf8')):{};
 const discovered=fs.existsSync(profiles)?fs.readdirSync(profiles,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name):[];
 for(const name of new Set(['desktop','headless',...discovered])){
  const file=path.join(profiles,name,'package.json');
  if(!fs.existsSync(file)){if(['desktop','headless'].includes(name))findings.push({profile:name,missingManifest:true});continue;}
  const template=path.join(repository,flavor==='native'||name==='headless'?'presets/native':'config',name+'.package.json');
  if(!fs.existsSync(template)){findings.push({profile:name,unmanagedProfile:true});continue;}
  const difference=compareInstalledManifest(JSON.parse(fs.readFileSync(template,'utf8')),JSON.parse(fs.readFileSync(file,'utf8')),artifacts);
  if(Object.values(difference).some(values=>values.length))findings.push({profile:name,...difference});
 }
 return findings;
}
