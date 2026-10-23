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

// 等待运行中的工作收尾的上限：200ms 一次、最多 10s，够子代理退出，又不会让请求长期挂住。
const DRAIN_INTERVAL_MS = 200;
const DRAIN_TIMEOUT_MS = 10_000;

export class DeleteSession extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "deleteSession", { namespace: "deleteSession" });
  }

  async delete(request) {
    const { sessionId } = request;
    // 准入放在服务端：客户端流程被绕开时，也不能搬走未归档的会话目录。
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId))
      throw new Error("会话尚未归档，不能删除。");
    // 归档时的 stopActivity 只发出停止请求、不等运行中的工作收尾，子代理会稍后才退出。
    // 之前这里一见到活动就拒绝，用户每点一次删除都撞在同一份清单上。现在等它清空再搬，
    // 既让重试能收敛，也避免搬走仍有写入的目录。
    for (let waited = 0; ; waited += DRAIN_INTERVAL_MS) {
      const activity = await this.ctx.waterfall(
        "workspace/session-activity",
        { sessionId },
        () => Promise.resolve([]),
      );
      if (activity.length === 0) break;
      if (waited >= DRAIN_TIMEOUT_MS) throw new Error("会话仍在停止中，请稍后重试。");
      await new Promise((resolve) => setTimeout(resolve, DRAIN_INTERVAL_MS));
    }
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
