const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');

function currentPreset(header,events){
 return events.reduce((preset,event)=>event.type==='agent-preset/selected'?event.data.agentPreset:preset,header.agentPreset);
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function migrate(storage,home,apply){
 const candidates=[];
 for(const {header}of await storage.list()){
  const handle=await storage.open(header.id,'read');
  try{const {events}=await handle.read();if(currentPreset(header,events)==='liangshen')candidates.push({header,events});}
  finally{await handle.close();}
 }
 const legacy=path.resolve(home,'.agent-presets','liangshen');
 if(!apply||(!candidates.length&&!fs.existsSync(legacy)))return {dryRun:!apply,count:candidates.length,sessions:candidates.map(row=>row.header.id)};
 const held=[];
 try{
  // Acquire every native writer lease before backing up or appending any session.
  for(const row of candidates){
   const handle=await storage.open(row.header.id,'write');held.push({...row,handle});
   assert.deepEqual((await handle.read()).events,row.events,'Session changed during migration; quit Harness and retry');
  }
  const backup=path.join(home,'backups','preset-migration-'+new Date().toISOString().replaceAll(':','-'));
  fs.mkdirSync(backup,{recursive:true});
  const report={from:'liangshen',to:'standard',sessions:[]};
  const reportPath=path.join(backup,'migration.json');
  for(const row of held){
   const source=path.dirname(storage.locate(row.header).path);
   const relative=path.relative(path.join(home,'sessions'),source);
   assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Session backup must stay within its root');
   fs.cpSync(source,path.join(backup,'sessions',relative),{recursive:true,errorOnExist:true,force:false});
   report.sessions.push({id:row.header.id,relative,eventCount:row.events.length,historySha256:digest(row.events),migrated:false});
  }
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  for(const [index,row]of held.entries()){
   const event={type:'agent-preset/selected',seq:row.events.length,time:Date.now(),data:{agentPreset:'standard'}};
   await row.handle.append([event]);await row.handle.flush();
   const after=(await row.handle.read()).events;
   assert.deepEqual(after.slice(0,-1),row.events,'History changed during migration');
   assert.deepEqual(after.at(-1),event);assert.equal(currentPreset(row.header,after),'standard');
   report.sessions[index].migrated=true;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  }
  if(fs.existsSync(legacy)){
   const archived=path.resolve(backup,'retired-liangshen');
   assert.equal(path.dirname(legacy),path.resolve(home,'.agent-presets'));
   assert.equal(path.dirname(archived),path.resolve(backup));
   fs.renameSync(legacy,archived);
  }
  return {count:held.length,backup,historyPreserved:true,legacyPresetRemoved:!fs.existsSync(legacy)};
 }finally{for(const row of held.reverse())await row.handle.close();}
}

async function main(){
 const root=process.env.DSH_NATIVE_ROOT;assert(root,'Run through harness.mjs migrate-liangshen');
 const home=path.resolve(process.env.DSH_HOME);const {Context}=await import(pathToFileURL(path.join(root,'cordis/lib/index.js')));
 const persistence=await import(pathToFileURL(path.join(root,'dsh-session-persistence-jsonl/lib/index.js')));
 const ctx=new Context();const plugin=ctx.plugin(persistence,{root:path.join(home,'sessions'),listConcurrency:8});await plugin.await();
 try{console.log(JSON.stringify(await migrate(ctx.get('sessionPersistence'),home,process.argv.includes('--apply')),null,2));}
 finally{await plugin.dispose();}
}
module.exports={currentPreset,migrate};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
