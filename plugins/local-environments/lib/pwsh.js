import SandboxPwshExecutor from "@deepseek-ai/dsh-pwsh-sandbox";
import { environmentOverlay } from "./values.js";

export default class EnvironmentPwshExecutor extends SandboxPwshExecutor {
  async execute(spec) {
    const env = await environmentOverlay(
      this.ctx,
      spec.dshEnv?.DSH_SESSION_ID,
      spec.env,
      spec.signal,
    );
    return super.execute(env === undefined ? spec : { ...spec, env });
  }
}
