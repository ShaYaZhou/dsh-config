import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stableNodeCommand} from '../scripts/node-command.mjs';

test('persistent command retains a stable alias across Cellar upgrades', {skip:process.platform==='win32'}, () => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'node alias ')));
  try {
    const old=path.join(root,'Cellar/node/1.0.0/bin/node');
    const next=path.join(root,'Cellar/node/2.0.0/bin/node');
    for(const file of [old,next]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');}
    const alias=path.join(root,'bin/node');fs.mkdirSync(path.dirname(alias));fs.symlinkSync(old,alias);
    const command=stableNodeCommand(old,{PATH:''});assert.equal(command,alias);
    fs.unlinkSync(alias);fs.symlinkSync(next,alias);fs.unlinkSync(old);
    assert.equal(fs.realpathSync(command),next);
    assert.equal(stableNodeCommand(next,{PATH:''}),command);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('unrelated PATH executable is never persisted as the Node runtime', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wrong node '));
  try {
    fs.writeFileSync(path.join(root,process.platform==='win32'?'node.exe':'node'),'not node');
    const executable=path.join(root,'actual-node');fs.writeFileSync(executable,'fixture');
    assert.equal(stableNodeCommand(executable,{PATH:root}),executable);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
