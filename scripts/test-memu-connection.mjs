import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

assert(process.argv[2], 'Pass the installed dsh-memu-memory package directory');
const source=fs.readFileSync(path.join(process.argv[2],'lib/memu-config.js'),'utf8');
const start=source.indexOf('export async function testMemuConfig()');
assert(start>=0);
for(const route of ['managed-local','remote-api']){
 const calls=[],removed=[];
 const scope={path,process:{pid:1},Date,ensureDir(){},dataDir:()=>'/isolated',
  fs:{rmSync:file=>removed.push(file)},effectiveVectorRoute:()=>route,globalDbPath:()=>'/local-active.sqlite3',
  getMemuConfig:()=>({provider:'openai'}),
  commit:async args=>calls.push({kind:'commit',...args}),
  retrieve:async args=>{calls.push({kind:'retrieve',...args});return{files:[{}]};}};
 vm.runInNewContext(source.slice(start).replace('export async function','async function')+'\nthis.testConnection=testMemuConfig;',scope);
 const result=await scope.testConnection();
 assert.equal(result.ok,true);assert.equal(result.files,1);
 if(route==='managed-local'){
  assert.equal(calls.length,1,'Local connection test must not commit to any memory database');
  assert.equal(calls[0].route,'managed-local','Local selection must not use the default remote API route');
  assert.equal(calls[0].db,'/local-active.sqlite3');assert.equal(result.provider,'local');assert.equal(removed.length,0);
  scope.retrieve=async()=>{throw new Error('local worker unavailable');};
  await assert.rejects(scope.testConnection(),/local worker unavailable/,'Never fall back to remote API');
 }else{assert.equal(calls[0].kind,'commit');assert.equal(calls[1].kind,'retrieve');assert.equal(path.dirname(calls[0].db),path.join('/isolated','tmp'));assert.equal(removed.length,3);}
}
console.log('MEMU_CONNECTION_PASS local read-only routing, no remote fallback, API fixture cleanup; zero network calls');
