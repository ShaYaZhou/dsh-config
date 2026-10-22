# @local/dsh-tool-workflow

Local build of `@deepseek-ai/dsh-tool-workflow` 0.2.1-rc.2
(<https://github.com/deepseek-ai/deepseek-harness>, commit
`687f282e8625c6b8d11ff58211a90524be2e4317`). `src/` is the complete modified
source; `lib/index.js` is the bundle the harness loads.

## Local changes

- `sizeGuideline` config (`small` 5 / `medium` 10 / `large` 25 agents /
  `unlimited`): states the expected scale in the tool description and forwards
  the matching `warnAboveAgents` threshold to the engine.
- `resume_from_run_id`, `budget_tokens`, and `budget_ms` tool parameters,
  forwarded beside the seam request on both foreground and background starts.
  The engine (`@local/dsh-workflow-ptc`) is their only reader.

## Rebuild

```sh
esbuild src/index.ts --bundle --format=esm --platform=node --target=node22 \
  --tsconfig=<upstream>/tsconfig.base.json --external:@deepseek-ai/* \
  --outfile=lib/index.js
```

License: MIT (upstream `LICENSE`, copied verbatim).
