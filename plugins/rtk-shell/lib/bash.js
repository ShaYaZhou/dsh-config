import EnvironmentBashExecutor from "@local/dsh-local-environments/bash";
import { rewriteSpec } from "./rewrite.js";

// Public composition: retain the existing environment overlay, then native
// confinement, jobs and cancellation. Never catch execution to retry a command.
export default class RtkBashExecutor extends EnvironmentBashExecutor {
  static inject = [...EnvironmentBashExecutor.inject, "rtkRules"];
  execute(spec) {
    return super.execute(
      rewriteSpec(spec, this.ctx.rtkRules.current(), "bash"),
    );
  }
}
