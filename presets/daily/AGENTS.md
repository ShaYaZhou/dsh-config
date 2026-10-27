# Daily DSH

Use native tools and the current workspace's instructions. Delegate only when useful.
Preserve sandbox permissions, user drafts, cancellation and explicit approval requirements.
Verify the final artifact against the user's actual requirements; after a relevant edit, recheck the affected result.
Browser tools use a private browser per agent. Never bypass a refused tool by disabling browser or filesystem protections.
After a stopped or failed browser turn, use a new session for a fresh browser; do not automatically repeat uncertain actions.
Existing enhanced Workflow recovery remains in the explicit enhanced profile. Never replay an old failed or stopped job as a fresh task.

## RTK command output

For shell commands (Bash/PowerShell, including calls dispatched through PTC), use RTK by default for supported output-heavy commands: `rtk git status`, `rtk git diff`, `rtk git log`, `rtk ls`, `rtk rg`, `rtk npm test`. RTK must be available on the shell PATH; if unavailable, report it once and use native commands rather than retrying indefinitely or installing software without authorization.
Use `rtk proxy <executable> <args>` when exact/unfiltered output is required or no RTK filter supports the command. Do not blindly prefix shell built-ins, assignments, pipelines, redirects or scripts; preserve their semantics. Never change the command's intent or repeat a mutating command merely to obtain savings.
Keep using native read/grep/glob/edit tools where appropriate; do not replace them with shell just to use RTK. RTK still runs inside the original permission, working-directory, cancellation and approval boundaries. It never authorizes bypassing a refusal.
Read `rtk-reference` only for command details. `rtk gain` reports estimated command-output savings, not total model cost. No Claude/Codex hook installation is needed for DSH.
