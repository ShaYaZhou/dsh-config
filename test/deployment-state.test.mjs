import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mergeManaged,reconcileDeployment,baselinePath,deploymentInputs,assertNoUncapturedCode} from '../scripts/deployment-state.mjs';

test('three-way deployment preserves market additions, model edits and user removals',()=>{
 const base={dependencies:{owned:'1'},bundles:['owned','removed'],providers:{a:{model:'old'}}};
 const live={dependencies:{owned:'1',market:'2'},bundles:['owned','market'],providers:{a:{model:'user'},local:{model:'extra'}}};
 const next={dependencies:{owned:'3',newUI:'1'},bundles:['owned','removed','newUI'],providers:{a:{model:'old'}}};
 assert.deepEqual(mergeManaged(base,live,next),{dependencies:{owned:'3',newUI:'1',market:'2'},bundles:['owned','newUI','market'],providers:{a:{model:'user'},local:{model:'extra'}}});
});
test('native keyed patch rows preserve local overrides while updating independent defaults',()=>{
 const base=[{id:'models',config:{providers:{a:{model:'old'}}}},{insert:[{id:'one',disabled:true}]}];
 const live=[...structuredClone(base),{id:'one',disabled:false}];live[0].config.providers.local={model:'custom'};
 const next=structuredClone(base);next[1].insert[0].disabled=false;next.push({id:'new',config:{enabled:true}});
 const merged=mergeManaged(base,live,next);
 assert.equal(merged.find(r=>r.id==='one').disabled,false);
 assert.equal(merged[0].config.providers.local.model,'custom');assert.equal(merged[1].insert[0].disabled,false);
});
test('conflicting edits and ambiguous arrays refuse without echoing values',()=>{
 assert.throws(()=>mergeManaged({value:'base'},{value:'private-local'},{value:'private-template'},'profile'),e=>e.message.includes('profile')&&!e.message.includes('private-'));
 assert.throws(()=>mergeManaged([1],[2],[3]),/conflict/);
 const local=JSON.parse('{"__proto__":{"polluted":true}}');
 const merged=mergeManaged({},local,{added:true});assert.equal(Object.getPrototypeOf(merged),Object.prototype);assert.equal({}.polluted,undefined);
});
test('local config remains only in the installed result, never the generated baseline',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-merge-'));
 try{
  const file='profiles/desktop/package.json',base={dependencies:{owned:'1'},dsh:{profile:{bundles:['owned']}}};
  const live={dependencies:{owned:'1',market:'2'},dsh:{profile:{bundles:['owned','market']}}};
  for(const [name,value]of [[file,live],[baselinePath(file),base]]){fs.mkdirSync(path.dirname(path.join(home,name)),{recursive:true});fs.writeFileSync(path.join(home,name),JSON.stringify(value));}
  const files=new Map([[file,JSON.stringify(base)],['profiles/desktop/pnpm-lock.yaml','template lock']]);
  const previous={generatedHashes:{[baselinePath(file)]:createHash('sha256').update(JSON.stringify(base)).digest('hex')}};
  const result=reconcileDeployment(home,files,previous, {parseYaml:JSON.parse,emitYaml:JSON.stringify});
  assert.equal(JSON.parse(files.get(file)).dependencies.market,'2');assert(!files.has('profiles/desktop/pnpm-lock.yaml'));
  assert(!result.baselines.get(baselinePath(file)).includes('market'));
  assert.equal(fs.readFileSync(path.join(home,file),'utf8'),JSON.stringify(live),'planning does not write home');
  fs.writeFileSync(path.join(home,baselinePath(file)),'{}');
  assert.throws(()=>reconcileDeployment(home,new Map([[file,JSON.stringify(base)]]),previous,{parseYaml:JSON.parse,emitYaml:JSON.stringify}),/changed deployment baseline/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('legacy drift cannot be silently adopted and uncaptured runtime code is protected',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-legacy-'));
 try{
  const file='AGENTS.md';fs.writeFileSync(path.join(home,file),'local instructions');
  assert.throws(()=>reconcileDeployment(home,new Map([[file,'new instructions']]),{files:{[file]:'old'}},{parseYaml:JSON.parse,emitYaml:JSON.stringify}),/trusted deployment baseline/);
  fs.writeFileSync(path.join(home,'runtime.mjs'),'local edit');fs.writeFileSync(path.join(home,'source.mjs'),'repository edit');
  assert.throws(()=>assertNoUncapturedCode(home,{sources:{'runtime.mjs':'source.mjs'},files:{'runtime.mjs':'old'}},home),/Uncaptured/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('deployment input fingerprints detect changed, added and removed deployment sources',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-inputs-'));try{
  fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config/a.json'),'{}');
  const before=deploymentInputs(dir);fs.writeFileSync(path.join(dir,'config/a.json'),'{"new":true}');fs.writeFileSync(path.join(dir,'config/b.json'),'{}');
  const after=deploymentInputs(dir);assert.notEqual(before['config/a.json'],after['config/a.json']);assert(after['config/b.json']);
  fs.unlinkSync(path.join(dir,'config/a.json'));assert(!Object.hasOwn(deploymentInputs(dir),'config/a.json'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
