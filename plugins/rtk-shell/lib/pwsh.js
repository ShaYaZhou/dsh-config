import EnvironmentPwshExecutor from "@local/dsh-local-environments/pwsh";
import { rewriteSpec } from "./rewrite.js";

// Public composition: retain the existing environment overlay, then native
// confinement, jobs and cancellation. Never catch execution to retry a command.
export default class RtkPwshExecutor extends EnvironmentPwshExecutor {
  execute(spec) {
    return super.execute(rewriteSpec(spec));
  }
}
