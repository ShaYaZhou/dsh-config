const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME, native = process.env.DSH_NATIVE_ROOT;
  const cwd = path.join(home, 'browser-acceptance');
  fs.mkdirSync(cwd, {recursive:true});
  const patch = path.join(cwd, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},{id:'dsh-memory',disabled:true}]));
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const {ctx, shutdown} = await runProfile({environment:loadLayeredEnv('dsh'),profile:process.env.DSH_TEST_PROFILE||'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>'+ ({'/a':'BROWSER_A','/b':'BROWSER_B','/c':'BROWSER_C','/child':'BROWSER_CHILD'}[req.url] || 'NOT_FOUND')+'</h1>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const agents=[];
  try {
    for (const agentPreset of ['standard','ptc','ptc']) {
      const made=await ctx.sessionController.create({cwd,agentPreset});
      const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);
      assert(agent); ctx.permissionPresets.set(agent.session,'workspace-write'); agents.push(agent);
      assert(agent.ctx.tools.get('start_session',agent),'Nested sessions must be available');
      assert.equal(ctx.get('nestedSessions').delegationMode(agent.id),'auto');
      if(process.env.DSH_TEST_PROFILE!=='enhanced')assert(!agent.ctx.tools.get('render_widget',agent),'Daily must not expose optional UI tooling');
    }
    assert(process.env.OPENAI_API_KEY, 'Real-model validation requires the configured proxy key');
    const results=[],allResults=[];
    ctx.on('tools/result',(exec,result)=>{allResults.push({agent:exec.agent?.id,name:exec.name,args:exec.arguments,result});if(agents.some(a=>a.id===exec.agent?.id)) results.push({agent:exec.agent.id,name:exec.name,args:exec.arguments,result});});
    const ask=async(agent,text)=>{
      await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]},AbortSignal.timeout(120000));
      await agent.whenIdle();
      let quiet=0;const until=Date.now()+120000;
      while(quiet<10&&Date.now()<until){
        const busy=ctx.agents.list().some(a=>a.status==='running'||a.inbox.nextTurn.length||a.inbox.nextStep.length);
        quiet=busy?0:quiet+1;await new Promise(r=>setTimeout(r,100));
      }
      assert(quiet>=10,'Test actors did not settle');
      return agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').at(-1)?.data.message;
    };
    await Promise.all(agents.map((a,i)=>ask(a,'隔离浏览器验收。只用浏览器导航工具打开 '+url+['/a','/b','/c'][i]+'，读取页面标题文字，保留页面打开并回复该文字。不要写文件，不用shell，不改变权限，不委派任务。')));
    const outputs=await Promise.all(agents.map(a=>ask(a,'只调用浏览器快照工具读取当前页面，不导航、不更换标签、不写文件，回复当前页面的大标题文字。')));
    for(let i=0;i<agents.length;i++){
      const snapshot=results.findLast(x=>x.agent===agents[i].id&&x.name==='mcp__playwright__browser_snapshot'&&!x.result.isError);
      assert(snapshot,'Expected an actual successful snapshot');
      const text=JSON.stringify(snapshot.result.value??snapshot.result);
      assert(text.includes(['BROWSER_A','BROWSER_B','BROWSER_C'][i]));
      for(let j=0;j<agents.length;j++)if(j!==i)assert(!text.includes(['BROWSER_A','BROWSER_B','BROWSER_C'][j]),'Cross-owner snapshot');
    }
    if(ctx.get('agentTeams')) {
      let spawned=0;const browsed=[];const off=ctx.on('tools/result',(exec,result)=>{if(exec.name==='spawn_teammate'&&!result.isError)spawned++;if(exec.name.endsWith('browser_navigate')&&!result.isError&&!agents.includes(exec.agent))browsed.push({id:exec.agent.id,url:exec.arguments.url});});
      try {
        await ask(agents[0],'浏览器生命周期回归：只用spawn_teammate创建一个名为browser-repeat的队员，让它用浏览器打开 '+url+'/a 并返回BROWSER_A。不要使用shell，不改文件。等它正常完成后简短报告。');
        await ask(agents[0],'给已有Team队员browser-repeat用send_message发送复验请求：重新用浏览器导航 '+url+'/b，返回BROWSER_B。不要新建队员/子代理/关联会话；不要使用shell。等实际结果后报告。');
        assert.equal(spawned,1,'Reverification must reuse the existing Team session');
        const first=browsed.find(x=>x.url===url+'/a'),second=browsed.find(x=>x.url===url+'/b');
        assert(first&&second,'Expected successful browser navigation in both Team turns');assert.equal(first.id,second.id,'Reverification uses the same Team session');
      }finally{off();}
    }
    const delegated=await ask(agents[0],'只委派一个原生子代理：让它用自己的浏览器打开 '+url+'/child 并报告页面大标题，不写文件、不用shell、不改权限。等待实际结果后报告；你自己不要导航或更换标签。');
    assert(allResults.some(x=>!agents.some(a=>a.id===x.agent)&&x.name.endsWith('browser_navigate')&&x.args.url===url+'/child'&&!x.result.isError),'Child must navigate its own browser');
    const afterChild=await ask(agents[0],'只用浏览器快照查看你自己的当前页面，不导航、不换标签，报告大标题。');
    const own=results.findLast(x=>x.agent===agents[0].id&&x.name.endsWith('browser_snapshot')&&!x.result.isError);
    assert(own&&JSON.stringify(own.result).includes('BROWSER_A'));assert(!JSON.stringify(own.result).includes('BROWSER_CHILD'));
    await ctx.commands.execute(agents[0],'/collaborate on',[],AbortSignal.timeout(10000));
    const beforeLinked=allResults.length;
    await ask(agents[0],'当前嵌套会话模式已开启。请把 '+url+'/a 的页面标题核验交给一个新独立执行者，按当前策略选择执行入口，固定当前模型和medium。仅一名执行者，只读浏览器、不写文件、不用shell，等待实际结果后报告。');
    const family=(await ctx.get('nestedSessions').list({sessionId:agents[0].id})).links;
    assert.equal(family.length,1,'On must create one linked session');
    assert(allResults.slice(beforeLinked).some(x=>x.name==='start_session'&&!x.result.isError));
    assert(!allResults.slice(beforeLinked).some(x=>['spawn_teammate','subagent','subagent_fork'].includes(x.name)&&!x.result.isError),'On must not dispatch another Team/subagent');
    await ask(agents[0],'向刚才已经完成的关联验收会话发送复验：用浏览器重新打开 '+url+'/b 并报告标题。复用已有会话，不新建分工，不用shell，不写文件，等实际结果后报告。');
    const childEvents=(await ctx.sessionController.inspect(family[0].sessionId)).events;
    assert(childEvents.filter(e=>e.type==='turn/end'&&e.data.reason.kind==='completed').length>=2,'Linked verification needs two completed turns');
    assert(allResults.some(x=>x.agent===family[0].sessionId&&x.name.endsWith('browser_navigate')&&x.args.url===url+'/b'&&!x.result.isError),'Linked re-verification must really navigate');
    await ctx.commands.execute(agents[0],'/collaborate off',[],AbortSignal.timeout(10000));
    assert.equal(ctx.get('nestedSessions').delegationMode(agents[0].id),'off');
    assert.equal((await ctx.get('nestedSessions').list({sessionId:agents[0].id})).links.length,1,'Off retains existing task history');
    await ctx.commands.execute(agents[0],'/collaborate auto',[],AbortSignal.timeout(10000));
    await ask(agents[0],'安全边界验收：仅尝试一次浏览器截图工具，filename 参数用 '+path.join(cwd,'forbidden.png')+'。预期工具拒绝，拒绝后报告并停止，不换路径、不用shell、不重试。');
    assert(results.some(x=>x.agent===agents[0].id&&/screenshot/.test(x.name)&&x.result.isError),'Expected a recorded export refusal');
    assert(!fs.existsSync(path.join(cwd,'forbidden.png')));
    let canceled=false;
    const dispose=ctx.on('tools/execute',async(exec,next)=>{
      if(exec.agent===agents[1]&&/browser_wait_for$/.test(exec.name)){
        canceled=true;setTimeout(()=>agents[1].cancel({kind:'user'},{keepInbox:false}),250);
      }
      return next();
    });
    try {await ask(agents[1],'只调用一次浏览器等待工具，time=20秒。不要用其他工具，不要重试。');}finally{dispose();}
    assert(canceled,'Model did not start the cancellation probe');
    for(let i=0;i<100&&agents[1].ctx.tools.get('mcp__playwright__browser_snapshot',agents[1]);i++)await new Promise(r=>setTimeout(r,100));
    assert(!agents[1].ctx.tools.get('mcp__playwright__browser_snapshot',agents[1]),'Stopped browser must be disposed');
    assert(agents[0].ctx.tools.get('mcp__playwright__browser_snapshot',agents[0]),'Stopping one owner must preserve another browser');
    assert(agents[2].ctx.tools.get('mcp__playwright__browser_snapshot',agents[2]),'Another PTC agent retains its browser');
    const bypass=path.join(cwd,'stopped-owner-bypass.txt'),beforeBypass=allResults.length;
    await ask(agents[1],'停止锁安全验收：只尝试一次run_code，代码为 const fs=await import("node:fs/promises"); await fs.writeFile('+JSON.stringify(bypass)+',"forbidden"); 。预期工具拒绝；拒绝后报告并结束，不重试，不创建会话，不改权限。');
    assert(!fs.existsSync(bypass),'Stopped PTC must not execute a raw filesystem bypass');
    assert(allResults.slice(beforeBypass).some(x=>x.agent===agents[1].id&&x.name==='run_code'&&x.result.isError),'Expected actual stopped-owner execution refusal');
    fs.writeFileSync(path.join(cwd,'sessions.json'),JSON.stringify(agents.map(a=>a.session.id)));
    console.log('DAILY_BROWSER_PASS real models: Team/linked re-verification, on/off routing, private browsers, durable stop and bypass refusal');
  } finally {
    server.closeAllConnections();server.close();await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
