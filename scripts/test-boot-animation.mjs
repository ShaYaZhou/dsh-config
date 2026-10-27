// Validate the actually installed upstream package and portable patch without
// touching production selections. Usage: node scripts/test-boot-animation.mjs <package-dir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const {SelectionStore}=await load('lib/host/selection-store.js');
const {ClipRegistry}=await load('lib/host/clip-registry.js');
const {ClipResolver}=await load('lib/host/clip-resolver.js');
const {RandomController}=await load('lib/host/random-controller.js');
const {MediaServer}=await load('lib/host/media-server.js');
const {CLIPS}=await load('lib/clips.meta.js');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-boot-default-'));
try {
 const file=path.join(home,'selection.json');
 const selection=new SelectionStore(file);
 const registry=new ClipRegistry({embedded:CLIPS,scanDirs:()=>[]});
 const resolver=new ClipResolver({registry,selection,random:new RandomController()});
 assert.equal(registry.list()[1].id,'builtin:cyberpunk');
 assert.equal(selection.read().selectedClipId,'builtin:cyberpunk');
 assert.equal(selection.read().playOnAppStart,true);
 assert.equal(selection.read().randomPlayback,false);
 assert.equal(resolver.resolveActive().clip.id,'builtin:cyberpunk');
 assert.equal(fs.existsSync(file),false,'Default does not create user records');
 const media=new MediaServer({dataModulePath:pathToFileURL(path.join(root,'lib/clips.data.js')).href});
 const bytes=await media.embeddedBuffer('cyberpunk');
 assert.equal(bytes.length,1856280);
 assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0,16),'beabf5956e0b467e');
 assert.equal(bytes.toString('ascii',4,8),'ftyp');
 for(const selectedClipId of ['builtin:brand','builtin:awakening',null]) {
  const existing={version:4,selectedClipId,randomPlayback:true,fitMode:'contain',playOnAppStart:false,conversationOverrides:{fixture:'builtin:startup'}};
  const before=JSON.stringify(existing);fs.writeFileSync(file,before);
  const read=new SelectionStore(file).read();
  assert.deepEqual(read,existing);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 }
 const pinned=new ClipResolver({registry,selection:new SelectionStore(file),random:new RandomController()});
 assert.equal(pinned.resolveActive('fixture').clip.id,'builtin:startup');
 const before=fs.readFileSync(file,'utf8');
 assert.deepEqual(new SelectionStore(file).read(),JSON.parse(before),'Restart preserves choices');
 assert.equal(fs.readFileSync(file,'utf8'),before);
 if(process.platform!=='win32') {
  fs.unlinkSync(file);fs.symlinkSync(path.join(home,'missing'),file);
  assert.equal(new SelectionStore(file).read().selectedClipId,null,'Dangling user link is not a fresh install');
 }
 console.log('BOOT_ANIMATION_PASS: fresh default, embedded MP4 hash, existing choices, random/disabled/pins, restart, no writes');
} finally { fs.rmSync(home,{recursive:true,force:true}); }
