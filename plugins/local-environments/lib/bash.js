import SandboxBashExecutor from "@deepseek-ai/dsh-bash-sandbox";
import { environmentOverlay } from "./values.js";

// Keep the native confinement, cancellation and job lifecycle unchanged.
export default class EnvironmentBashExecutor extends SandboxBashExecutor {
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
