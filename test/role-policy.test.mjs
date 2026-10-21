import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('read-only roles can inspect and report within a linked family without gaining write or spawn tools',()=>{
 let create,guard,allowed;
 const code=fs.readFileSync(new URL('../modules/role-policy.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const sandbox={};vm.createContext(sandbox);vm.runInContext(code+'\nthis.install=apply;',sandbox);
 sandbox.install({on:(_event,callback)=>{create=callback;},effect:callback=>callback(),tools:{guard:callback=>{guard=callback;return()=>{};}},systemPrompt:{context:()=>()=>{}}},{id:'reviewer'});
 const globalTools=new Set(['read','read_image','glob','grep','write']);
 create({agent:{ctx:{tools:{restrict:({allow})=>{for(const name of allow)assert(globalTools.has(name),'Native restrict rejects unknown global tools: '+name);allowed=allow;}}}}});
 for(const name of ['read_session','list_linked_sessions','send_session_message','wait_for_sessions','list_recent_sessions','read_local_session','propose_followups']){assert(!allowed.includes(name));assert.equal(guard({name}),undefined);}
 for(const name of ['pwsh','edit','start_session']){assert(!allowed.includes(name));assert.match(guard({name}),/read-only/);}
});
