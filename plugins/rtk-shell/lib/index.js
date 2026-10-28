import schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
  principalOf,
} from "@deepseek-ai/dsh-typert-protocol";
import { runInitializers } from "@local/dsh-shared/remote";
import { DEFAULTS, validateSettings, explainCommand } from "./rewrite.js";

export const name = "rtk-rules";
export const inject = ["typert"];
export const Config = schema.object({
  enabled: schema.boolean().default(true).volatile(),
  git: schema.boolean().default(true).volatile(),
  logs: schema.boolean().default(true).volatile(),
  search: schema.boolean().default(true).volatile(),
  tests: schema.boolean().default(true).volatile(),
  excludedCommands: schema.array(schema.string()).default([]).volatile(),
  customRules: schema
    .array(
      schema.object({
        command: schema.string(),
        filter: schema.union([schema.const("summary"), schema.const("err")]),
        enabled: schema.boolean(),
      }),
    )
    .default([])
    .volatile(),
});
const initializers = [];
const previewInput = z.strictObject({
  command: z.string().max(4096),
  dialect: z.enum(["bash", "pwsh"]),
  settings: z.unknown().optional(),
});
export class RtkRules extends TypertRemoteService {
  constructor(ctx, config) {
    super(ctx, "rtkRules");
    this.config = config;
    runInitializers(this, initializers);
  }
  current() {
    return validateSettings(
      Object.fromEntries(
        Object.keys(DEFAULTS).map((key) => [
          key,
          this.config[key]?.get?.() ?? this.config[key] ?? DEFAULTS[key],
        ]),
      ),
    );
  }
  preview(request) {
    if (principalOf(this.ctx.invocation))
      throw new RemoteError(
        "gateway/forbidden",
        "Only the local owner may preview command rules",
        {},
      );
    this.ctx.invocation?.signal?.throwIfAborted();
    const input = previewInput.parse(request);
    return explainCommand(
      input.command,
      input.settings === undefined
        ? this.current()
        : validateSettings(input.settings),
      input.dialect,
    );
  }
}
Remote("preview")(RtkRules.prototype.preview, {
  kind: "method",
  name: "preview",
  private: false,
  static: false,
  addInitializer: (fn) => initializers.push(fn),
});
export function apply(ctx, config) {
  new RtkRules(ctx, config);
}
