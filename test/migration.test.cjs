const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {migrate,currentPreset}=require('../scripts/migrate-liangshen.cjs');

test('migration appends one selection, preserves every original event, backs up, and is idempotent',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-migration-'));
 const header={id:'old-session',agentPreset:'liangshen'};
 const events=[{type:'user/message',seq:0,time:1,data:{text:'preserve me'}}];const before=structuredClone(events);
 const source=path.join(home,'sessions','workspace','old-session','session.v4.jsonl');fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,'original physical log');
 const legacy=path.join(home,'.agent-presets/liangshen');fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'preset.yml'),'old preset');
 const storage={list:async()=>[{header}],locate:()=>({path:source}),open:async()=>({read:async()=>({events:structuredClone(events)}),close:async()=>{},flush:async()=>{},append:async rows=>events.push(...rows)})};
 try{
  assert.equal((await migrate(storage,home,false)).count,1);assert.deepEqual(events,before);
  const report=await migrate(storage,home,true);assert.equal(report.count,1);assert.deepEqual(events.slice(0,-1),before);assert.equal(currentPreset(header,events),'standard');
  assert.equal(fs.readFileSync(path.join(report.backup,'sessions/workspace/old-session/session.v4.jsonl'),'utf8'),'original physical log');
  assert(!fs.existsSync(legacy));assert.equal(fs.readFileSync(path.join(report.backup,'retired-liangshen/preset.yml'),'utf8'),'old preset');
  assert.equal((await migrate(storage,home,true)).count,0);assert.equal(events.length,2);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('a busy writer aborts before any append and releases acquired leases',async()=>{
 let closed=0,appends=0;const rows=['one','two'].map(id=>({header:{id,agentPreset:'liangshen'}}));
 const storage={list:async()=>rows,open:async(id,mode)=>{if(id==='two'&&mode==='write')throw Error('owned');return {read:async()=>({events:[]}),close:async()=>{if(mode==='write')closed++;},append:async()=>{appends++;}};}};
 await assert.rejects(migrate(storage,os.tmpdir(),true),/owned/);assert.equal(closed,1);assert.equal(appends,0);
});
