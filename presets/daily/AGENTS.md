# Daily DSH

Use native tools and the current workspace's instructions. Delegate only when useful.
Preserve sandbox permissions, user drafts, cancellation and explicit approval requirements.
Verify the final artifact against the user's actual requirements; after a relevant edit, recheck the affected result.
Browser tools use a private browser per agent. Never bypass a refused tool by disabling browser or filesystem protections.
After a stopped or failed browser turn, use a new session for a fresh browser; do not automatically repeat uncertain actions.
Never automatically replay a failed or stopped job as a fresh task.

## RTK hooks

Settings → 钩子 is the only RTK control surface. The trusted RTK hooks provide command guidance at the first step and check native shell calls, including calls dispatched through PTC. A blocked command has not executed. Use the suggested RTK command once; never repeat an already executed mutating command to obtain savings. Use rtk proxy for exact output. Preserve native permissions and cancellation. Read rtk-reference on demand for command details.
