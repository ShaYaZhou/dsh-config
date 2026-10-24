const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

// Real-model acceptance: prompts describe user needs, never select delegation tools.
const cases = [
  {name:'isolated', route:'subagent', task:'检查 service.log 中唯一一次失败，给我事件 ID 和原因。日志检索是一个很小、独立的旁支，请隔离它产生的大量上下文，只把简短结论带回当前对话；不需要保留可独立追问的长期对话。不要修改文件。'},
  {name:'persistent', route:'linked', task:'分别调查 api.txt 和 ui.txt 的问题。这两个方向我之后会分别追问，请为我保留两个可独立打开、继续对话的调查分支。现在完成各自调查，并在这里汇总两个证据 ID；不要修改文件。'},
  {name:'staged', route:'workflow', task:'完成一个分阶段的批量处理任务：先分别核对 alpha.json 和 beta.json 的记录，各自把 count 增加 1；随后由独立检查核实两项结果，汇总证据 ID 与最终数值。每项增量只执行一次，不需要长期保留可追问的调查对话。'},
  {name:'shared', route:null, task:'shared.json 中 alpha 和 beta 是两个独立的待处理业务项，请分别调查各自 evidence，然后各把 count 增加 1，最后独立复核两项结果。注意它们实际保存在同一个文件。每项增量只执行一次，保留文件中所有其他字段，报告最终数值和证据 ID。'},
];

async function main() {
  const home = process.env.DSH_HOME;
  assert(process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT, 'Real model runtime required');
  const recheck = process.env.DSH_ROUTING_RECHECK;
  const output = recheck ? path.resolve(recheck) : path.join(home, 'ultracode-routing-' + Date.now());
  assert(output.startsWith(path.resolve(home)+path.sep),'Evidence must remain inside the isolated home');
  fs.mkdirSync(output, {recursive:true});
  const patch = path.join(output, 'runtime.patch.json');
  fs.writeFileSync(patch, JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const {runProfile} = await import(pathToFileURL(path.join(process.env.DSH_NATIVE_ROOT, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(process.env.DSH_NATIVE_ROOT, 'dsh-app-boot/lib/index.js')));
  const {ctx, shutdown} = await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
  const saved = recheck ? JSON.parse(fs.readFileSync(path.join(output,'result.json'),'utf8')) : {};
  const reports = [], calls = saved.calls ?? [], activations = saved.activations ?? [];
  let current;
  const scopeOf = agent => {
    const cwd=agent && ctx.workingDirectory.get(agent.session);
    return cwd ? {case:path.basename(cwd),preset:path.basename(path.dirname(cwd))} : {case:current?.name,preset:current?.preset};
  };
  const save = () => fs.writeFileSync(path.join(output,recheck?'recheck-result.json':'result.json'), JSON.stringify({reports,current,calls,activations},null,2));
  console.log('ROUTING_OUTPUT ' + output);
  try {
    const linked = await new Promise(resolve => ctx.inject(['nestedSessions'], scope => resolve(scope.nestedSessions)));
    const original = ctx.subagents.startActivation.bind(ctx.subagents);
    ctx.subagents.startActivation = async options => {
      const row = {...scopeOf(options.request?.parent),parentId:options.request?.parent?.id,prompt:options.request?.prompt,start:Date.now()};
      activations.push(row); save();
      const activation = await original(options);
      row.id = activation.childId;
      activation.result.then(result => {row.end=Date.now();row.stopReason=result.stopReason;save();}, error => {row.end=Date.now();row.error=String(error);save();});
      return activation;
    };
    ctx.on('tools/execute', async (exec,next) => {
      const row = {...scopeOf(exec.agent),agentId:exec.agent?.id,name:exec.name,args:exec.arguments,start:Date.now()};
      calls.push(row);
      if (exec.agent) {
        row.permission=ctx.permissionPresets.current(exec.agent.session);
        row.sandbox=ctx.sandboxPolicy.resolve({session:exec.agent.session});
      }
      if (exec.name === 'write') {
        row.file = path.resolve(ctx.workingDirectory.get(exec.agent.session), exec.arguments.file_path);
        row.before = fs.existsSync(row.file) ? fs.readFileSync(row.file,'utf8') : null;
      }
      save();
      try {
        const result=await next();
        row.isError=result?.isError===true;
        return result;
      }
      finally {
        row.end=Date.now();
        if(row.file) row.after=fs.existsSync(row.file)?fs.readFileSync(row.file,'utf8'):null;
        save();
      }
    });
    for (const preset of (process.env.DSH_TEST_PRESET ? [process.env.DSH_TEST_PRESET] : ['standard','ptc'])) {
      for (const scenario of cases.filter(row => !process.env.DSH_ROUTING_CASE || row.name === process.env.DSH_ROUTING_CASE)) {
        const cwd = path.join(output,preset,scenario.name);
        fs.mkdirSync(cwd,{recursive:true});
        const fixtures = {
          'AGENTS.md':'Synthetic acceptance workspace. Only inspect files in this workspace. No memory, network, credentials, shell, or other projects. For file mutations use only the native write tool (PTC may wrap tools.write in run_code); no edit, raw filesystem code, or other write channels. Read files before writing and preserve unrelated fields. Delegation is allowed; choose the smallest sufficient method. Read-only reviewers must never write.\n',
          'service.log':Array.from({length:800},(_,i)=>i===437?'ERROR event=LOG-437 cause=expired-certificate':`INFO request=${i} status=ok`).join('\n'),
          'api.txt':'Evidence API-741: User input is concatenated into a SQL query.\n',
          'ui.txt':'Evidence UI-852: A clickable div lacks a keyboard handler and button role.\n',
          'alpha.json':JSON.stringify({evidence:'ALPHA-104',count:0}),
          'beta.json':JSON.stringify({evidence:'BETA-205',count:0}),
          'shared.json':JSON.stringify({alpha:{evidence:'ALPHA-104',count:0},beta:{evidence:'BETA-205',count:0},keep:'unchanged'}),
        };
        let made;
        if(recheck) {
          made=saved.reports.find(row=>row.preset===preset&&row.name===scenario.name);
          assert(made?.passed,'No completed live evidence for this case');
        } else {
          for(const [name,body] of Object.entries(fixtures)) fs.writeFileSync(path.join(cwd,name),body);
          const workspace = await ctx.workspaceRegistry.create(cwd, 'Ultracode routing '+preset+' '+scenario.name);
          made = await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
        }
        const {agent} = await ctx.sessionController.resolveAgent(made.sessionId);
        current={name:scenario.name,preset,sessionId:agent.id,cwd}; save();
        if(!recheck) ctx.permissionPresets.set(agent.session,'workspace-write');
        assert.equal(ctx.permissionPresets.current(agent.session),'workspace-write');
        assert.equal(agent.ctx.tools.modeFor(agent),preset==='ptc'?'ptc':'native');
        const signal = AbortSignal.timeout(600000);
        for(const command of recheck?[]:['/ultracode on','/collaborate auto']) {
          const result=await ctx.commands.execute(agent,command,[],signal);
          assert.equal(result.result.kind,'success',JSON.stringify(result));
        }
        assert.equal(linked.delegationMode(agent.id),'auto');
        assert.equal((await ctx.ultracodeState.read({sessionId:agent.id},signal)).supported,true);
        if(!recheck) await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:scenario.task+'\n本次合成验收约束（请传递给执行者）：只读当前目录的测试文件，不访问网络或记忆；修改只能通过原生 write 工具，PTC 可经 run_code 调用 tools.write。禁止 shell、edit 和原始文件系统代码，以便逐次核对写入记录。'}]},signal);
        let stable=0,previous=-1;
        while(!recheck&&stable<6) {
          signal.throwIfAborted();
          await new Promise(resolve=>setTimeout(resolve,500));
          const links=(await linked.list({sessionId:agent.id})).links;
          const busy=agent.status==='running'||agent.inbox.nextTurn.length||agent.inbox.nextStep.length||links.some(row=>['queued','running'].includes(row.status))||activations.some(row=>row.case===scenario.name&&row.preset===preset&&!row.end);
          const seq=agent.session.snapshotEvents().at(-1)?.seq;
          stable=!busy&&seq===previous?stable+1:0;previous=seq;
        }
        const rows=calls.filter(row=>row.case===scenario.name&&row.preset===preset);
        const parentCalls=rows.filter(row=>row.agentId===agent.id);
        const routes=[...new Set(parentCalls.map(row=>row.name==='start_session'?'linked':['subagent','subagent_fork'].includes(row.name)?'subagent':row.name==='workflow'?'workflow':null).filter(Boolean))];
        const events=agent.session.snapshotEvents();
        const last=events.findLast(event=>event.type==='assistant/message');
        const summary=((last?.data?.message??last?.data)?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
        const links=(await linked.list({sessionId:agent.id})).links;
        const report={...current,routes,summary,tools:parentCalls.map(row=>row.name),links,writes:rows.filter(row=>row.name==='write').length,passed:false};
        reports.push(report);save();
        assert(rows.every(row=>!row.sandbox||(['workspace-write','read-only'].includes(row.sandbox.mode)&&path.resolve(row.sandbox.workspaceRoot)===cwd)), 'Sandbox broadened');
        if(scenario.route) assert.deepEqual(routes,[scenario.route], 'Wrong automatic route for '+preset+'/'+scenario.name);
        const forbidden=['bash','edit','apply_patch','write_file'];
        assert(!rows.some(row=>forbidden.includes(row.name)), 'Unobserved mutation channel used');
        for(const name of ['AGENTS.md','service.log','api.txt','ui.txt']) assert.equal(fs.readFileSync(path.join(cwd,name),'utf8'),fixtures[name]);
        const writes=rows.filter(row=>row.name==='write');
        if(scenario.name==='isolated') {
          assert.equal(parentCalls.filter(row=>['subagent','subagent_fork'].includes(row.name)).length,1,'Repeated isolated assignment');
          const children=activations.filter(row=>row.parentId===agent.id);
          assert.equal(children.length,1);
          assert.equal(children[0].stopReason,'completed');
        }
        if(scenario.name==='persistent') {
          assert.equal(parentCalls.filter(row=>row.name==='start_session').length,2,'Repeated persistent assignment');
          assert.equal(links.length,2,'Linked sessions did not actually start');
          assert(links.every(row=>row.parentId===agent.id&&row.status==='completed'),'Linked sessions did not complete');
        }
        if(['isolated','persistent'].includes(scenario.name)) {
          assert.equal(writes.length,0);
          for(const name of ['alpha.json','beta.json','shared.json']) assert.equal(fs.readFileSync(path.join(cwd,name),'utf8'),fixtures[name]);
          for(const evidence of scenario.name==='isolated'?['LOG-437']:['API-741','UI-852']) assert(summary.includes(evidence),'Missing real evidence '+evidence);
        } else {
          const allowed=scenario.name==='staged'?['alpha.json','beta.json']:['shared.json'];
          assert(writes.every(row=>allowed.includes(path.basename(row.file))&&path.dirname(row.file)===cwd),'Unexpected file write');
          for(const file of allowed) {
            const mutations=writes.filter(row=>row.file===path.join(cwd,file));
            assert(mutations.length>0,'No observed write');
            const owners=[...new Set(mutations.map(row=>row.agentId))];
            // Different sequential owners are allowed; overlapping worker lifetimes are not.
            if(owners.length>1) {
              const workers=activations.filter(row=>owners.includes(row.id));
              assert(owners.every(id=>id===agent.id||workers.some(row=>row.id===id)),'Unknown writer lifetime');
              for(let i=0;i<workers.length;i++) for(let j=i+1;j<workers.length;j++)
                assert(workers[i].end<=workers[j].start||workers[j].end<=workers[i].start,'Concurrent workers modified the same file');
              for(const write of mutations.filter(row=>row.agentId===agent.id)) for(const worker of workers)
                assert(write.end<=worker.start||write.start>=worker.end,'Parent and worker modified the same file while worker was active');
            }
            let previous=JSON.parse(fixtures[file]);
            for(const row of mutations) {
              assert.deepEqual(JSON.parse(row.before),previous,'Stale or unobserved write');
              const after=JSON.parse(row.after);
              if(file==='shared.json') {
                assert.equal(after.keep,'unchanged');
                for(const key of ['alpha','beta']) {assert.equal(after[key].evidence,previous[key].evidence);assert(after[key].count>=previous[key].count&&after[key].count<=1,'Repeated/lost increment');}
                assert(after.alpha.count+after.beta.count>previous.alpha.count+previous.beta.count,'Duplicate write');
              } else {assert.equal(previous.count,0);assert.deepEqual(after,{...previous,count:1});}
              previous=after;
            }
            const actual=JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
            assert.deepEqual(actual,previous);
            if(file==='shared.json') {assert.equal(actual.alpha.count,1);assert.equal(actual.beta.count,1);} else assert.equal(actual.count,1);
            assert(rows.some(row=>row.name==='read'&&row.agentId!==agent.id&&!owners.includes(row.agentId)&&
              path.resolve(cwd,row.args.file_path)===path.join(cwd,file)&&row.start>=mutations.at(-1).end),
              'No independent child read after the final write');
          }
          for(const name of ['alpha.json','beta.json','shared.json'].filter(name=>!allowed.includes(name)))
            assert.equal(fs.readFileSync(path.join(cwd,name),'utf8'),fixtures[name]);
          for(const evidence of ['ALPHA-104','BETA-205']) assert(summary.includes(evidence),'Missing final verification '+evidence);
        }
        assert.deepEqual(fs.readdirSync(cwd).sort(),Object.keys(fixtures).sort(),'Unexpected file created');
        for(const start of events.filter(event=>event.type==='tool-workflow/run-start'))
          assert.equal(events.find(event=>event.type==='tool-workflow/run-end'&&event.data.runId===start.data.runId)?.data.stopReason,'completed');
        report.passed=true;save();
        console.log('ROUTING_CASE_PASS '+preset+' '+scenario.name+' routes='+routes.join(',')+' writes='+writes.length);
      }
    }
    console.log('ULTRACODE_ROUTING_PASS real-model automatic choices and mutation audit');
  } finally {await shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
