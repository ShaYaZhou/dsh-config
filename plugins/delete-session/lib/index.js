import { z } from "zod";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { sessionId } from "@local/dsh-shared/session-id";
import { runInitializers } from "@local/dsh-shared/remote";
import { relocateSession } from "./trash.js";

export const name = "delete-session";
export const inject = ["typert", "remoteAccess", "workspaceRegistry"];

const schemas = {
  delete: z.strictObject({ sessionId }),
};

export class DeleteSession extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "deleteSession", { namespace: "deleteSession" });
  }

  async delete(request) {
    const { sessionId } = request;
    // 准入放在服务端：客户端流程被绕开时，也不能搬走仍在运行或未归档的会话目录。
    // 活动清单来自原生 workspace/session-activity waterfall（回合、作业、子代理、日程）。
    const activity = await this.ctx.waterfall(
      "workspace/session-activity",
      { sessionId },
      () => Promise.resolve([]),
    );
    if (activity.length > 0) throw new Error("会话仍在运行，请先停止后再删除。");
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId))
      throw new Error("会话尚未归档，不能删除。");
    return relocateSession(resolveDshHome(), sessionId);
  }
}

const initializers = [];
for (const method of Object.keys(schemas)) {
  const resources = { session: (request) => request?.sessionId };
  Remote({ resources })(DeleteSession.prototype[method], {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer: (initialize) => initializers.push(initialize),
  });
}
// 没有装饰器语法时手工跑一遍 initializer：协议在实例初始化时把端点标记写到原型，
// 只要收集不执行，Gateway 就找不到 deleteSession/delete，路由返回 404。
runInitializers(Object.create(DeleteSession.prototype), initializers);

export async function apply(ctx) {
  new DeleteSession(ctx);
}
