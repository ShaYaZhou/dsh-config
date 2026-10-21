import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import { environmentOverlay } from "./values.js";

export default class EnvironmentSubprocessRuntime extends LocalSubprocessRuntime {
  async spawnTerminal(spec) {
    const env = await environmentOverlay(
      this.ctx,
      spec.env?.DSH_SESSION_ID,
      spec.env,
      spec.signal,
    );
    return super.spawnTerminal(env === undefined ? spec : { ...spec, env });
  }
}
