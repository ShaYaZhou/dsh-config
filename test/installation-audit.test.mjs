import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compareInstalledManifest,auditInstalledManifests} from '../scripts/installation-audit.mjs';

test('preserved market installs are reported even when their deployed file hash is current',()=>{
 const expected={dependencies:{'@local/example':'@artifact/example',shared:'1.0.0'},dsh:{profile:{bundles:['shared']}}};
 const installed={dependencies:{'@local/example':'file:../../local-plugins/example.tgz',shared:'2.0.0','dsh-meme':'0.1.76','dsh-whale-widget':'0.4.2'},dsh:{profile:{bundles:['shared','dsh-meme','dsh-whale-widget']}}};
 const result=compareInstalledManifest(expected,installed,{example:{filename:'example.tgz'}});
 assert.deepEqual(result.extraDependencies,['dsh-meme','dsh-whale-widget']);
 assert.deepEqual(result.extraBundles,['dsh-meme','dsh-whale-widget']);
 assert.deepEqual(result.differentPins,['shared']);
 assert.deepEqual(result.missingDependencies,[]);
 assert.deepEqual(compareInstalledManifest(installed,installed),{extraDependencies:[],missingDependencies:[],differentPins:[],unverifiedArtifacts:[],extraBundles:[],missingBundles:[]});
 assert.deepEqual(compareInstalledManifest(expected,{}).missingDependencies,['@local/example','shared']);
});

test('artifact substitutions and unavailable artifact evidence cannot be reported as aligned',()=>{
 const expected={dependencies:{hooks:'@artifact/hooks'}};
 assert.deepEqual(compareInstalledManifest(expected,{dependencies:{hooks:'0.6.0'}}).differentPins,['hooks']);
 assert.deepEqual(compareInstalledManifest(expected,{dependencies:{hooks:'file:../../local-plugins/hooks-old.tgz'}},{hooks:{filename:'hooks-new.tgz'}}).differentPins,['hooks']);
 assert.deepEqual(compareInstalledManifest(expected,{dependencies:{hooks:'file:../../local-plugins/hooks-old.tgz'}}).unverifiedArtifacts,['hooks']);
});

test('missing desktop and headless manifests are explicit audit findings',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-missing-profile-'));
 try{assert.deepEqual(auditInstalledManifests(home,home),[{profile:'desktop',missingManifest:true},{profile:'headless',missingManifest:true}]);}
 finally{fs.rmSync(home,{recursive:true,force:true});}
});
