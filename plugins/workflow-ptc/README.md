# @local/dsh-workflow-ptc

Local build of `@deepseek-ai/dsh-workflow-ptc` 0.2.1-rc.2
(<https://github.com/deepseek-ai/deepseek-harness>, commit
`687f282e8625c6b8d11ff58211a90524be2e4317`). The engine and its sandboxed
guest are upstream code; `src/` is the complete modified source so every local
change is reviewable here. `lib/index.js` is the bundle the harness loads.

## Local changes

- `budgetTokens` / `budgetMs` engine config, lowerable per call
  (`budget_tokens` / `budget_ms`); the guest exposes a read-only `budget`
  global and refuses further `agent()` calls once a budget is exhausted.
- `warnAboveAgents` size-guideline warning (the model-facing tool derives it
  from its `sizeGuideline` setting).
- One-level nesting guard: a session started by a workflow run cannot start
  another workflow.
- Per-run JSONL journal (`journal`, `journalRoot`) and prefix replay behind
  `resume_from_run_id`: matched calls return their recorded result without
  starting a subagent, and replay stops permanently at the first mismatch.
- `schemaRetries` (engine config, default 5): when a child finishes
  `completed` without the structured value its schema asked for, it is
  replaced by a fresh child with the same request. Failed or cancelled
  children are not retried, tokens accumulate across attempts, and each retry
  spends one more slot of the run's `maxTotalAgents` budget. The call journal
  row keeps the first attempt's session id; only the final result is recorded,
  so resume returns that result without restarting the call.

## Rebuild

`src/guest-source.ts` is generated: after changing `guest.ts`, `runtime.ts`, or
`types.ts`, rebundle it with the same Rolldown settings as the upstream
`scripts/gen-workflow-guest.ts`, then bundle the package:

```sh
esbuild src/index.ts --bundle --format=esm --platform=node --target=node22 \
  --tsconfig=<upstream>/tsconfig.base.json --external:@deepseek-ai/* \
  --outfile=lib/index.js
```

`src/guest-source.ts` must be regenerated before that bundle; running the host
against a stale guest string silently drops the budget hook.

License: MIT (upstream `LICENSE`, copied verbatim).
