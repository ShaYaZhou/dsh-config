import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
test('desktop commands choose real native presets and preserve source sessions',async()=>{
 let plugin;const listeners=new Map();let clicked=0;const row={querySelectorAll:()=>[{textContent:'help'}],dispatchEvent:event=>{assert.equal(event.type,'mousedown');clicked++;}};
 const document={addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:()=>{},querySelectorAll:()=>[row]};
 const source=fs.readFileSync(new URL('../plugins/desktop-commands/lib/client.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{document,MouseEvent:class {constructor(type){this.type=type;}},window:{__ModuleLoader__:{load:definition=>{plugin=definition.factory();}}}});
 assert(plugin.inject.includes('remote.commands'));assert(plugin.inject.includes('remote.agentPresets'));
 const commands=new Map(),started=[],opened=[],drafts=[];
 const context={effect:factory=>factory(),commandUi:{register:definition=>{assert(!commands.has(definition.name));commands.set(definition.name,definition);return ()=>{};}},uiWorkspace:{startSession:(...args)=>started.push(args),openSession:id=>opened.push(id),forkSession:async()=> 'forked'},sessions:{subagentAddress:()=>undefined,binding:()=>({session:{getSnapshot:()=>({projectionValues:{agentPreset:'reviewer'}})}}),list:{getSnapshot:()=>({byId:{old:{id:'old',title:'Old task',updatedAt:1},blank:{id:'blank',blank:true},child:{id:'child',origin:'subagent'}}})},scope:()=>({})},remote:{agentPresets:{list:async()=>({ok:true,value:{presets:[{id:'reviewer',name:'Reviewer'},{id:'broken',broken:'missing'}]}})},commands:{list:async()=>({ok:true,value:[{name:'btw',description:'side question'}]})}},conversation:{input:{for:()=>({setDraft:value=>drafts.push(value),focus:()=>{}})}}};
 plugin.apply(context);assert.deepEqual([...commands.keys()].sort(),['agents','clear','fork','help','resume']);
 assert(!commands.has('btw'));assert(!commands.has('rewind'));
 const roles=await commands.get('agents').ui.options();assert.equal(roles.length,2);
 commands.get('agents').ui.onSelect(roles[0],{sessionId:'current'});assert.equal(started[0][1].agentPreset,'reviewer');
 commands.get('clear').ui.run({sessionId:'current'});assert.equal(started[1][1].agentPreset,'reviewer');assert.equal(started[1][1].clearPreviousDraft,true);assert.equal(opened.length,0);
 const resumed=await commands.get('resume').ui.options();assert.equal(resumed.length,1);commands.get('resume').ui.onSelect(resumed[0],{sessionId:'current'});assert.equal(opened[0],'old');
 commands.get('help').ui.onSelect({id:'btw'},{sessionId:'current'});assert.equal(drafts[0],'/btw ');
 const event={key:'Enter',target:{closest:()=>({textContent:'/help'})},preventDefault:()=>{},stopImmediatePropagation:()=>{}};
 listeners.get('keydown')(event);assert.equal(clicked,1,'Exact command must win over a fuzzy skill');
 listeners.get('keydown')({...event,key:'ArrowDown'});listeners.get('keydown')(event);assert.equal(clicked,1,'Explicit picker navigation must stay in control');
 listeners.get('input')();listeners.get('keydown')(event);assert.equal(clicked,2);
});
test('rewind advertises argument support without replacing the original command handlers',()=>{
 const source=fs.readFileSync(new URL('../plugins/rewind/lib/index.js',import.meta.url),'utf8');
 for(const name of ['rewind','undo'])assert(source.includes('name: "'+name+'",')&&source.includes('input: {hint:"[@消息序号 chat|code|both]"}'));
 const client=fs.readFileSync(new URL('../plugins/rewind/lib/client.js',import.meta.url),'utf8');assert(client.includes('dsh-rewind-header'));assert(client.includes('createRewindBridge'));
});
