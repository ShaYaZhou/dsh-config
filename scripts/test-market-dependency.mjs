import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Exercise the installed marketplace's real classifier without a browser or model call.
const profile=path.resolve(process.argv[2]);
const {verifyActivation}=await import(pathToFileURL(path.join(profile,'node_modules/dshmarket/lib/verify.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'market dependency '));
try {
  const name='@playwright/mcp';
  const dir=path.join(root,'node_modules',name);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0',bin:{'playwright-mcp':'cli.js'}}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{[name]:'latest'},dsh:{profile:{bundles:[]}}}));
  const classify=(live=new Set(),observed=false)=>verifyActivation('desktop',name,live,root,false,{runtimeVersion:null,exemptions:{}},observed);
  const dependency=classify();assert.equal(dependency.library,true);assert.equal(dependency.hot,false);assert.notEqual(dependency.state,'live');
  assert.notEqual(classify(new Set([name])).library,true);
  assert.notEqual(classify(new Set(),true).library,true);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dsh:{profile:{bundles:[name]}}}));
  assert.equal(classify().state,'broken','MCP mistakenly mounted as a DSH bundle remains an error');
  console.log('MARKET_MCP_DEPENDENCY_PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
