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
  fs.writeFileSync(patch, JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const {ctx, shutdown} = await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>'+ ({'/a':'BROWSER_A','/b':'BROWSER_B','/c':'BROWSER_C','/child':'BROWSER_CHILD'}[req.url] || 'NOT_FOUND')+'</h1>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const agents=[];
  try {
    for (const agentPreset of ['standard','ptc','ptc']) {
      const made=await ctx.sessionController.create({cwd,agentPreset});
      const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);
      assert(agent); ctx.permissionPresets.set(agent.session,'workspace-write'); agents.push(agent);
      assert(!agent.ctx.tools.get('start_session',agent),'Daily must not expose linked-session extension');
      assert(!agent.ctx.tools.get('render_widget',agent),'Daily must not expose optional UI tooling');
    }
    assert(process.env.OPENAI_API_KEY, 'Real-model validation requires the configured proxy key');
    const results=[];
    ctx.on('tools/result',(exec,result)=>{if(agents.includes(exec.agent)) results.push({agent:exec.agent.id,name:exec.name,result});});
    const ask=async(agent,text)=>{
      await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]},AbortSignal.timeout(120000));
      await agent.whenIdle();
      return agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').at(-1)?.data.message;
    };
    await Promise.all(agents.map((a,i)=>ask(a,'隔离浏览器验收。只用浏览器导航工具打开 '+url+['/a','/b','/c'][i]+'，读取页面标题文字，保留页面打开并回复该文字。不要写文件，不用shell，不改变权限，不委派任务。')));
    const outputs=await Promise.all(agents.map(a=>ask(a,'只调用浏览器快照工具读取当前页面，不导航、不更换标签、不写文件，回复当前页面的大标题文字。')));
    assert.match(JSON.stringify(outputs[0]),/BROWSER_A/);assert.doesNotMatch(JSON.stringify(outputs[0]),/BROWSER_B/);
    assert.match(JSON.stringify(outputs[1]),/BROWSER_B/);assert.doesNotMatch(JSON.stringify(outputs[1]),/BROWSER_A/);
    assert.match(JSON.stringify(outputs[2]),/BROWSER_C/);assert.doesNotMatch(JSON.stringify(outputs[2]),/BROWSER_[AB]/);
    const delegated=await ask(agents[0],'只委派一个原生子代理：让它用自己的浏览器打开 '+url+'/child 并报告页面大标题，不写文件、不用shell、不改权限。等待实际结果后报告；你自己不要导航或更换标签。');
    assert.match(JSON.stringify(delegated),/BROWSER_CHILD/);
    const afterChild=await ask(agents[0],'只用浏览器快照查看你自己的当前页面，不导航、不换标签，报告大标题。');
    assert.match(JSON.stringify(afterChild),/BROWSER_A/);assert.doesNotMatch(JSON.stringify(afterChild),/BROWSER_CHILD/);
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
    fs.writeFileSync(path.join(cwd,'sessions.json'),JSON.stringify(agents.map(a=>a.session.id)));
    console.log('DAILY_BROWSER_PASS real models: standard/PTC private navigation, export refusal, stop cleanup and independent owner preserved');
  } finally {
    server.closeAllConnections();server.close();await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
