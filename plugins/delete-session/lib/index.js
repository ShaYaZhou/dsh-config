import { z } from "zod";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { relocateSession } from "./trash.js";

export const name = "delete-session";
export const inject = ["typert", "remoteAccess"];

const sessionId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+$/);
const schemas = {
  delete: z.strictObject({ sessionId }),
};

export class DeleteSession extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "deleteSession", { namespace: "deleteSession" });
  }

  async delete(request) {
    return relocateSession(resolveDshHome(), request.sessionId);
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
for (const initialize of initializers) {
  initialize.call(Object.create(DeleteSession.prototype));
}

export async function apply(ctx) {
  new DeleteSession(ctx);
}
