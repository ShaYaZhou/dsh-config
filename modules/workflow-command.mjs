import { randomUUID } from 'node:crypto';

export const name = 'workflow-command';
export const inject = ['commands', 'tools', 'sessionController', 'workflowEngine'];

export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'workflow',
    description: '显式工作流：/workflow 任务内容；resume <运行ID> 续跑；stop <运行ID> 停止。',
    input: { hint: '任务内容 | resume 运行ID | stop 运行ID | new 新任务' },
    async handler(invocation) {
      let task = invocation.rawInput.trim();
      if (!task) return {
        kind: 'success',
        text: '用法：/workflow 任务内容；/workflow resume 运行ID；/workflow stop 运行ID。停止或失败后，核对文件再用 /workflow new 新任务明确另起任务。续跑仅回放确认完成的结果，记录不确定时拒绝重跑。运行 ID 在工作流结果或错误中；后台任务仍可用 job_output / job_kill。',
      };
      if (task.length > 16000) return { kind: 'error', text: '任务内容不能超过 16000 个字符。' };
      if (ctx.tools.get('workflow', invocation.agent) === undefined)
        return { kind: 'error', text: '当前模式没有 workflow 工具，请切换到支持工作流的模式。' };
      const signal = invocation.signal ?? AbortSignal.timeout(30000);
      signal.throwIfAborted();
      if (/^new$/i.test(task)) return {kind:'error',text:'请在 /workflow new 后填写已核对的新任务。'};
      const newTask=/^new\s+/i.test(task);
      if(newTask)task=task.replace(/^new\s+/i,'').trim();
      const action=newTask ? null : /^(resume|stop)\s+([0-9a-f-]{36})$/i.exec(task);
      if (!newTask && /^(resume|stop)(?:\s|$)/i.test(task) && !action)
        return {kind:'error',text:'请提供完整运行 ID，例如 /workflow resume <runId>。'};
      const engine=ctx.workflowEngine;
      if(!action && !newTask && engine?.isBlocked?.(invocation.agent))
        return {kind:'error',text:'该会话有停止或失败的工作流。请 /workflow resume <运行ID>；核对文件后确需新任务时，用 /workflow new <任务内容>，避免把继续误当成重新执行。'};
      if(action?.[1].toLowerCase()==='stop') {
        if(!engine?.stopRun) return {kind:'error',text:'当前引擎不支持确认式停止，请使用原生任务停止入口。'};
        try { await engine.stopRun(invocation.agent,action[2]); return {kind:'success',text:'工作流及其子代理已停止；自动重启已锁定。'}; }
        catch(error) {return {kind:'error',text:error.message};}
      }
      let request;
      if(action) {
        try {request=engine?.resumeRequest(invocation.agent,action[2]);if(!request)throw new Error('当前引擎不支持安全续跑');}
        catch(error) {return {kind:'error',text:error.message};}
      }
      const requestId=randomUUID();
      const revoke=engine?.authorizeStart?.(invocation.agent,action?.[2],requestId);
      try { await ctx.sessionController.prompt({
        sessionId: invocation.agent.session.id,
        requestId,
        mode: 'queue',
        content: [{
          type: 'text',
          text: '用户通过 /workflow 明确选择本次使用 workflow 工具；不修改任何模式开关。Ultracode 开启时 /collaborate on 偏好 Workflow 内的持久关联执行者，临时任务可选子代理，不能绕过 Workflow。先确认范围与验收条件，再按真实依赖安排并行工作、验证并收集实际结果。保持当前权限、沙箱、停止与深度限制；工具拒绝时报告原因，不改用其他委派入口绕过。后台执行后等待实际终态再汇总，列出失败与未覆盖项。\n\n' + (request ? '严格使用此原始调用续跑，不更改脚本、输入或目录：\n' + JSON.stringify(request) : task),
        }],
      }, signal); } catch(error) {revoke?.();throw error;}
      return { kind: 'success', text: '本次工作流请求已提交；执行进度与结果将在原生工作流卡片中显示。' };
    },
  }));
}
