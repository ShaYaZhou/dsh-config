import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
test('embedded browser review keeps selection coordinates and sends only its own feedback to its owning session',async()=>{
 let plugin;vm.runInNewContext(fs.readFileSync(new URL('../plugins/desktop-commands/lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:definition=>{plugin=definition.factory();}}}});
 const box=plugin.reviewBounds({x:0.8,y:0.7},{x:-0.1,y:0.2},1000,500);assert.equal(JSON.stringify(box),JSON.stringify({x:0,y:100,width:800,height:250}));
 const review={sessionId:'original',url:'https://example.com/page',width:1000,height:500,capturedAt:'2026-10-20',image:'png',items:[{box,text:'完整批注'}]};
 const session={},sent=[],released=[];const context={sessions:{binding:id=>id==='original'?{session}:undefined},conversation:{createDrafts:(id,files)=>{assert.equal(id,'original');assert.equal(files[0],'file');return [{id:'review-image'}];},releaseDraftAttachments:rows=>released.push(...rows),sendSession:async(...args)=>{sent.push(args);return {kind:'success'};}}};
 await plugin.sendReview(context,review,'file');assert.equal(sent[0][0],session);assert(sent[0][1].includes('完整批注'));assert(sent[0][1].includes('https://example.com/page'));assert.equal(JSON.stringify(sent[0][2]),'["review-image"]');assert.equal(sent[0][3],'queue');assert.equal(released.length,0);
 context.conversation.sendSession=async()=>({kind:'error',text:'retry'});await assert.rejects(plugin.sendReview(context,review,'file'),/retry/);assert.equal(released.length,1);assert.equal(review.items[0].text,'完整批注');
});
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
