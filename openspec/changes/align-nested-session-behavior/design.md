## Context

DSH 0.2.1-rc.2 provides independent agents, native session storage, inboxes, worktree and compaction services, and desktop extension slots. Existing linked-family controls deliberately restrict communication and delegation to one root. Preserve those protections.

## Goals / Non-Goals

Goals: implement R1–R9 with observable behavior and real host evidence; high cohesion, low coupling; portable reversible deployment. Non-goals: proprietary source reuse, Claude execution/account access, speculative remote endpoints, or claiming identical private internals.

## Decisions

- Behavior specification is the implementation input. Public docs establish user behavior; offline static REA corroborates separate-session lineage, message and completion mechanisms. It cannot prove runtime equivalence or absence of other private code paths.
- Nested sessions are independent persisted conversations organized by lineage. They are not merely subagent output cards and do not require an experimental shared Team task scheduler. Reuse native agents/inboxes; root decides delegation. Children request additional siblings from root.
- Keep official OpenSpec skills unchanged. Add one delivery skill for an explicitly requested continuous workflow, plus the minimum role-policy communication allowance required by read-only reviewers.
- Keep native sidebar rows and menus. A version-pinned semantic DOM adapter may decorate hierarchy only where no native extension slot exists; no React-owned row reparenting.
- Separate maintenance scheduling from nested-session UI. Reuse native compaction admission and durable transactions; fake-clock tests cover eligibility and races, real proxy tests cover summary/resume.
- Use native worktree service and explicit include policy. Do not auto-copy secrets, force-reset branches, or remove unintegrated changes.
- Reuse native notification, task and pane facilities before adding alternatives. Verify available APIs before selecting an adapter.
- Global recent-conversation access must be distinct and explicitly enabled; do not weaken family-only checks to make a broad roster work.
- Local directory bindings and environment secrets remain outside tracked configuration. User deferred remote setup on 2026-10-21; preserve the pending task.

## Risks / Trade-offs

Model orchestration is nondeterministic: unit tests alone cannot establish full delivery. Run a real proxy fixture with protected oracle and actual fresh reviewer. Native UI bindings are version-specific and require native-host interaction checks. Idle summarization has cost and may lose detail; provide a switch, preserve logs and do not claim universal cache savings.

## Migration Plan

Build and test in isolated DSH_HOME, inspect dry-run, back up managed files, deploy only verified milestones. Preserve old relationship schema and independent preference storage. Revert code or installer backup without deleting histories. Remote work remains pending rather than inventing successful connections.
