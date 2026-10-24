const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {randomUUID, createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

function verifyWeb(rows, file, parentId, url) {
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/SYNTHETIC-4D-731/);assert.match(html,/<(?:canvas|svg)\b/i);
  const writes=rows.filter(row=>row.mutation);
  assert(writes.length>0);assert(writes.every(row=>['write','edit'].includes(row.name)));
  for(const row of rows.filter(row=>['write','edit'].includes(row.name)&&!row.isError&&typeof row.args.file_path==='string')) {
    if(path.resolve(row.policy.workspaceRoot,row.args.file_path)===file)assert(row.mutation,'Repeated or no-op write to the deliverable');
  }
  let previous=null;
  for(const write of writes) {assert.equal(write.mutation.before,previous,'Unobserved or concurrent file mutation');previous=write.mutation.after;}
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),previous);
  const owners=[...new Set(writes.map(row=>row.agentId))];assert(!owners.includes(parentId));
  // A favicon-only correction needs a final load/console check, not another full interaction sweep.
  const iconOnly=row=>{
    if(row.name!=='edit'||typeof row.args.old_string!=='string'||typeof row.args.new_string!=='string')return false;
    const strip=value=>value.replace(/<link\b(?=[^>]*\brel=["']icon["'])[^>]*>\s*/gi,'');
    return /<(?:meta|title)\b/i.test(row.args.old_string)&&
      !/<(?:script|style|body)\b/i.test(row.args.old_string+row.args.new_string)&&
      strip(row.args.old_string)===strip(row.args.new_string);
  };
  const behaviorWrites=writes.filter(row=>!iconOnly(row));
  const independent=row=>!owners.includes(row.agentId)&&row.agentId!==parentId;
  const finalReview=rows.filter(row=>independent(row)&&row.start>writes.at(-1).end);
  const review=rows.filter(row=>independent(row)&&row.start>behaviorWrites.at(-1).end);
  assert(finalReview.some(row=>row.name==='mcp__playwright__browser_navigate'&&row.args.url===url),'Independent reviewer did not open the actual final page');
  assert(finalReview.some(row=>row.name==='mcp__playwright__browser_console_messages'),'Final console check missing');
  assert(review.some(row=>row.name==='mcp__playwright__browser_resize'&&row.args.width<=500),'Mobile viewport not checked');
  assert(review.some(row=>['mcp__playwright__browser_click','mcp__playwright__browser_press_key','mcp__playwright__browser_fill_form'].includes(row.name)||
    row.name==='mcp__playwright__browser_evaluate'&&/dispatchEvent|\.click\(|\.value\s*=/.test(row.args.function)),'No actual independent control interaction');
  assert(rows.filter(row=>row.agentId===parentId).length<30,'Coordinator fell into a long execution loop');
  const final=rows.findLast(row=>row.name==='workflow')?.workflowResult?.result;
  if(final&&typeof final==='object') {
    assert.notEqual(final.ok,false,'Workflow reported failed acceptance');
    assert.notEqual(final.pass,false,'Workflow reported failed acceptance');
    assert.notEqual(final.acceptance?.pass,false,'Independent acceptance failed');
  }
  return {writers:owners,mutations:writes.length};
}

async function main() {
  const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
  assert(process.env.OPENAI_API_KEY && native);
  assert(!process.env.DSH_TEST_PRESET || ['standard','ptc'].includes(process.env.DSH_TEST_PRESET));
  assert(!process.env.DSH_MANDATORY_CASE || ['simple','web','linked','smoke','guards'].includes(process.env.DSH_MANDATORY_CASE));
  const recheck=process.env.DSH_MANDATORY_RECHECK;
  const output=recheck?path.resolve(recheck):path.join(home,'mandatory-acceptance-'+Date.now());
  assert(output.startsWith(path.resolve(home)+path.sep));
  fs.mkdirSync(output,{recursive:true});
  const patch=path.join(output,'runtime.patch.json');
  fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},{id:'mcp-playwright',config:{cwd:output}},{id:'mcp-playwright-session',config:{cwd:output}}]));
  const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
  const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
  const reports=[],calls=[],stages=[];
  let current;
  const save=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({reports,current,calls,stages},null,2));
  const hash=file=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
  const servers=[];
  console.log('MANDATORY_OUTPUT '+output);
  try {
    const linked=await new Promise(resolve=>ctx.inject(['nestedSessions'],scope=>resolve(scope.nestedSessions)));
    if(recheck) {
      const saved=JSON.parse(fs.readFileSync(path.join(output,'result.json'),'utf8'));
      const selected=saved.reports.filter(row=>!process.env.DSH_MANDATORY_CASE||row.name===process.env.DSH_MANDATORY_CASE);
      assert(selected.length>0);
      for(const report of selected) {
        const history=await ctx.sessionController.inspect(report.sessionId);
        const events=history.events;
        const rows=saved.calls.filter(row=>row.case===report.name&&row.preset===report.preset);
        assert(rows.every(row=>!row.policy||(['workspace-write','read-only'].includes(row.policy.mode)&&path.resolve(row.policy.workspaceRoot)===report.cwd)));
        assert(!rows.some(row=>row.agentId===report.sessionId&&['write','edit','bash','subagent','start_session'].includes(row.name)));
        for(const runId of report.runs) {
          assert.equal(events.find(event=>event.type==='tool-workflow/run-end'&&event.data.runId===runId)?.data.stopReason,'completed');
          const children=saved.stages.filter(row=>row.runId===runId);
          assert(children.length>0&&children.every(row=>row.end&&row.outcome==='completed'));
          for(let i=1;i<children.length;i++)assert(children[i-1].end<=children[i].start);
        }
        if(['web','linked'].includes(report.name)) {assert(report.runs.length>0);verifyWeb(rows,report.file,report.sessionId,report.url);}
        else if(report.name==='smoke') {assert(report.runs.length>0);assert.match(report.summary,/SYNTHETIC-4D-731/);}
        else {assert(['simple','guards'].includes(report.name));assert.equal(report.runs.length,0);if(report.name==='simple')assert.match(report.summary,/4/);else assert(!fs.existsSync(report.file));}
        if(['linked','smoke'].includes(report.name)) {
          const family=(await linked.list({sessionId:report.sessionId})).links;
          assert(family.length>0&&family.every(row=>row.status==='completed'&&!row.wakeParent));
        }
      }
      fs.writeFileSync(path.join(output,process.env.DSH_MANDATORY_CASE?'rechecked-'+process.env.DSH_MANDATORY_CASE+'.json':'rechecked.json'),JSON.stringify(selected.map(row=>({...row,passed:true})),null,2));
      console.log('MANDATORY_COLD_PASS '+selected.map(row=>row.preset+'/'+row.name).join(', ')+'; records and final files survive restart without new work');
      return;
    }
    ctx.on('workflow/agent-start',(run,info)=>{stages.push({runId:run.id,...info,start:Date.now()});save();});
    ctx.on('workflow/agent-end',(run,info)=>{
      const stage=stages.find(row=>row.runId===run.id&&row.seq===info.seq);
      if(stage)Object.assign(stage,{end:Date.now(),outcome:info.outcome});save();
    });
    ctx.on('tools/execute',async(exec,next)=>{
      const row={name:exec.name,agentId:exec.agent?.id,args:exec.arguments,start:Date.now(),case:current?.name,preset:current?.preset};
      if(exec.agent){
        row.policy=ctx.sandboxPolicy.resolve({session:exec.agent.session});
        row.case=path.basename(row.policy.workspaceRoot);row.preset=path.basename(path.dirname(row.policy.workspaceRoot));
      }
      calls.push(row);save();
      const file=row.policy&&path.join(row.policy.workspaceRoot,'index.html'),before=file&&hash(file);
      try {const result=await next();row.isError=result?.isError===true;if(exec.name==='workflow')row.workflowResult=result.value;return result;}
      finally {
        row.end=Date.now();
        if(file&&['write','edit','bash'].includes(exec.name)&&hash(file)!==before)
          row.mutation={before,after:hash(file)};
        save();
      }
    });
    for(const preset of process.env.DSH_TEST_PRESET?[process.env.DSH_TEST_PRESET]:['standard','ptc']) {
      for(const name of process.env.DSH_MANDATORY_CASE?[process.env.DSH_MANDATORY_CASE]:['simple','web','linked']) {
        const cwd=path.join(output,preset,name);fs.mkdirSync(cwd,{recursive:true});
        const file=path.join(cwd,'index.html');
        fs.writeFileSync(path.join(cwd,'evidence.txt'),'SYNTHETIC-4D-731\n');
        fs.writeFileSync(path.join(cwd,'math-spec.md'),`指定概念：SO(4) 中两个正交平面的独立旋转。四维点 (x,y,z,w) 变换为 (x cos a-y sin a, x sin a+y cos a, z cos b-w sin b, z sin b+w cos b)。它保持 x²+y²+z²+w²，两个平面旋转可交换。超立方体顶点为四个坐标各取 ±1，共16点；恰好一个坐标不同的点对构成32条边。四维到三维透视取 d=4，p3=d/(d-w')*(x',y',z')，本演示中 |w'|<=sqrt(2)，分母不会为0。最后用固定三维观察角投到二维画布；投影不是切片。验收仅核对这些事实并用一个数值例子检查长度保持，不扩展 SU(2)、Hopf 纤维或等斜旋转分类证明。`);
        const workspace=await ctx.workspaceRegistry.create(cwd,'Mandatory workflow '+preset+' '+name);
        const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
        const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);
        ctx.permissionPresets.set(agent.session,'workspace-write');
        current={name,preset,cwd,file,sessionId:agent.id};save();
        const signal=AbortSignal.timeout(1800000);
        for(const command of ['/ultracode on',name==='linked'||name==='smoke'?'/collaborate on':'/collaborate auto'])
          assert.equal((await ctx.commands.execute(agent,command,[],signal)).result.kind,'success');
        assert.equal(agent.ctx.tools.modeFor(agent),preset==='ptc'?'ptc':'native');
        // Only denied dispatches: no tool body or model turn is run by these probes.
        const denied=await agent.ctx.tools.execute({agent,callId:randomUUID(),signal,
          name:preset==='ptc'?'run_code':'write',arguments:preset==='ptc'
            ?{code:'const fs = await import("node:fs/promises"); await fs.writeFile("index.html","bypass");',description:'Guard probe'}
            :{file_path:file,content:'bypass'}});
        assert(denied.isError&&JSON.stringify(denied).includes('Ultracode'),'Native runtime guard did not deny bypass');
        assert(!fs.existsSync(file));
        if(name==='guards') {
          const run=await ctx.subagents.startActivation({provider:'spawn',label:'Read-only guard probe',delivery:'caller',signal,
            request:{parent:agent,agentPreset:'reviewer',prompt:[{type:'text',text:'Only reply READY. No tools, memory writes or delegation.'}]}});
          try {
            const child=ctx.agents.get(run.childId);assert(child);assert.equal(child.session.header.agentPreset,'reviewer');
            const blocked=await child.ctx.tools.execute({agent:child,callId:randomUUID(),signal,name:'write',arguments:{file_path:file,content:'must not write'}});
            assert(blocked.isError&&JSON.stringify(blocked).includes('shared role memory'));
            const result=await run.result;assert.equal(result.stopReason,'completed');
            assert(!fs.existsSync(file));
            reports.push({...current,runs:[],family:[],summary:'guards passed',childId:child.id,passed:true});save();
          } finally {await run.dispose();}
          console.log('MANDATORY_GUARDS_CASE_PASS '+preset+' direct coordinator execution and read-only helper writes refused');
          continue;
        }
        const server=http.createServer((request,response)=>{
          if(request.url!=='/'&&request.url!=='/index.html'){response.writeHead(404);response.end();return;}
          if(!fs.existsSync(file)){response.writeHead(404);response.end('Not created yet');return;}
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fs.readFileSync(file));
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
        const url='http://127.0.0.1:'+server.address().port+'/index.html';
        const request=name==='simple'?'只回答：2+2 等于几？':name==='smoke'
          ? '请完成一个工作流阶段：读取当前目录 evidence.txt，返回证据 ID。需要保留这一阶段的可追问会话。不要写文件，不使用 schema，不发送额外完成消息。'
          : `制作一个展示四维世界在三维中投影效果的完整网页。概念指定为 math-spec.md 中的 SO(4) 双平面旋转。用约300字寓言间接讲解，故事末尾才揭示概念，之后解释公式与隐喻对应。先由独立执行者用一个数值例子核对给定数学基线，再实现页面，最后由未参与实现者验收。数学基线就是本次验收范围，不扩展额外证明或概念；各阶段报告保持简短。\n交付当前目录 index.html，最多250行，纯HTML/CSS/JS、一个Canvas/SVG演示和一组角度滑块即可，不要外部依赖或网络资料。把 evidence.txt 的标识放在页脚。文件修改只用原生 write/edit，禁止shell写文件；不要额外工作区、后台写入进程或记忆。页面已由测试宿主提供预览地址 ${url}，不需要启动服务器。请实际打开预览并操作滑块、检查390px手机宽度与控制台错误；只修复有证据的问题，验收通过即收尾。${name==='linked'?'数学和验收阶段需要保留可独立追问的对话分支。':''}`;
        await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:request}]},signal);
        let stable=0,lastSeq=-1;
        while(stable<6) {
          signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,500));
          const family=(await linked.list({sessionId:agent.id})).links;
          const busy=agent.status==='running'||agent.inbox.nextTurn.length||agent.inbox.nextStep.length||
            stages.some(row=>!row.end)||family.some(row=>['running','queued'].includes(row.status));
          const seq=agent.session.snapshotEvents().at(-1)?.seq;
          stable=!busy&&seq===lastSeq?stable+1:0;lastSeq=seq;
        }
        const events=agent.session.snapshotEvents();
        const runs=events.filter(event=>event.type==='tool-workflow/run-start');
        const rows=calls.filter(row=>row.case===name&&row.preset===preset);
        const parentCalls=rows.filter(row=>row.agentId===agent.id);
        const family=(await linked.list({sessionId:agent.id})).links;
        const last=events.findLast(event=>event.type==='assistant/message');
        const summary=(last?.data.message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
        const report={...current,url,runs:runs.map(event=>event.data.runId),family,summary,passed:false};reports.push(report);save();
        assert(rows.every(row=>!row.policy||(['workspace-write','read-only'].includes(row.policy.mode)&&path.resolve(row.policy.workspaceRoot)===cwd)),'Sandbox changed');
        if(name==='simple') {assert.equal(runs.length,0);assert.match(summary,/4/);}
        else {
          assert(runs.length>0,'Substantive task did not enter workflow');
          assert(!parentCalls.some(row=>['write','edit','bash','subagent','start_session'].includes(row.name)),'Coordinator bypassed workflow');
          for(const start of runs) {
            assert.equal(events.find(event=>event.type==='tool-workflow/run-end'&&event.data.runId===start.data.runId)?.data.stopReason,'completed');
            const children=stages.filter(row=>row.runId===start.data.runId);
            assert(children.length>0);assert(children.every(row=>row.end&&row.outcome==='completed'));
            for(let i=1;i<children.length;i++) assert(children[i-1].end<=children[i].start,'Workflow writers overlapped');
          }
          if(name==='linked'||name==='smoke') {
            assert(family.length>0,'Persistent workers missing');
            assert(family.every(row=>row.parentId===agent.id&&row.wakeParent===false&&row.status==='completed'),'Duplicate wake or incomplete linked worker');
          } else assert.equal(family.length,0,'Unexpected second persistent dispatch path');
          if(name==='smoke')assert.match(summary,/SYNTHETIC-4D-731/);
          else {
            Object.assign(report,verifyWeb(rows,file,agent.id,url));
          }
        }
        report.passed=true;save();console.log('MANDATORY_CASE_PASS '+preset+' '+name);
        await new Promise(resolve=>server.close(resolve));servers.pop();
      }
    }
    console.log('MANDATORY_WORKFLOW_PASS '+reports.map(row=>row.preset+'/'+row.name).join(', ')+'; all selected cases passed');
  } finally {
    for(const server of servers)server.close();
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
