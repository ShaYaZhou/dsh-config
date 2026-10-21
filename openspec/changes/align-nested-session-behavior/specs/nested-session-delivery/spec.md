## ADDED Requirements

### Requirement: R1 Natural-language delivery
The main session SHALL accept a natural-language request for specification, implementation and acceptance, write valid OpenSpec artifacts before delegating, choose available models and worker count, delegate actual implementation and independent review, and verify the integrated result without requiring manual command chaining.

#### Scenario: Complete a small repair
- **WHEN** a user requests spec-first delivery of a reproducible local bug
- **THEN** real linked workers implement and independently review it, the main runs an unchanged acceptance check, and records actual results and completed tasks

#### Scenario: Failure remains visible
- **WHEN** a worker, review or acceptance fails
- **THEN** the coordinator repairs or reports the specific blocker and does not label the delivery complete

### Requirement: R2 Independent parallel execution and integration
Each child SHALL have its own durable history and execution lifecycle. Concurrent code writers SHALL use separate Git worktrees or proven disjoint ownership; worktree results SHALL be reviewed and integrated before final acceptance. Explicitly selected ignored configuration files MAY be included without copying credentials implicitly.

#### Scenario: Parallel edits
- **WHEN** independent tasks run concurrently
- **THEN** their checkouts do not overwrite each other, branches and changes remain recoverable, and the integrated checkout passes acceptance

### Requirement: R3 Bounded reports and safe communication
Children SHALL keep intermediate tool output in their own history and send a bounded attributed terminal report. Read, message, rename, archive, resume and stop actions SHALL validate access and respect receiving permissions, user stops and archived state. Cross-session messages SHALL carry text and sender identity without silently importing full context.

#### Scenario: Stopped receiver
- **WHEN** another session sends to a user-stopped or archived receiver
- **THEN** it cannot restart that receiver, and the sender receives an explicit outcome

#### Scenario: Other local conversations
- **WHEN** a user explicitly enables browsing other local conversations
- **THEN** a bounded recent roster excludes archived sessions by default and access is separate from the stricter linked-family tools

### Requirement: R4 Clear hierarchy and attention states
The native session list SHALL show collapsible parent-child relations with stable ordering, retained native menus and accessible controls. Needs input, Working and Completed SHALL reflect pending interaction, actual execution and terminal outcome. Per-session tasks, phase recap and background completion notifications SHALL be visible without flooding the main transcript.

#### Scenario: Waiting for input
- **WHEN** a child awaits a permission or question answer
- **THEN** the UI marks it Needs input rather than merely Working and lets the user open the relevant session

#### Scenario: Parent archive
- **WHEN** a parent is archived or detached
- **THEN** children remain accessible and history is retained without cyclic or orphaned hidden rows

### Requirement: R5 Session navigation and local environments
The desktop SHALL support viewing conversations side by side, selecting recently used folders, and named local environments containing multiple repositories, per-repository branch/worktree choice and explicit environment variables. Context usage, location and changes SHALL remain discoverable.

#### Scenario: Portable environment
- **WHEN** configuration is reused on another computer
- **THEN** repository-tracked settings contain no personal absolute paths or secrets and missing local folder bindings produce an actionable configuration state

### Requirement: R6 Confirmed follow-up suggestions
Out-of-scope follow-up tasks SHALL require user initiation, support starting one or all in isolated sessions, and offer continuing in the current conversation where appropriate. Composer suggestions SHALL be dismissible and disableable and SHALL not silently incur unlimited background model requests.

#### Scenario: Start all
- **WHEN** a user confirms several proposed follow-up tasks
- **THEN** each starts once in its own linked session and the original task continues independently

### Requirement: R7 Non-interrupting side conversation
A btw side conversation SHALL inherit useful context, accept independent questions without interrupting the main task, and avoid automatically adding its transcript to the main model context. A discoverable command or shortcut SHALL open it. Existing DSH side-conversation history SHALL not be destroyed to imitate another product's ephemeral lifecycle.

#### Scenario: Ask during execution
- **WHEN** the main session is running and the user opens btw
- **THEN** the main continues and the side reply appears only in its own conversation

### Requirement: R8 Safe idle compaction
Idle compaction SHALL reuse native compaction transactions, have an explicit off switch, and run only on sufficiently large idle sessions with no active or queued work or pending interaction. It SHALL retain durable history and show the compaction outcome. The baseline behavior is approximately 54 minutes idle and at least 200000 measured tokens; proxy cache expiry SHALL not be assumed to match Claude's one-hour cache.

#### Scenario: Busy or disabled
- **WHEN** maintenance is disabled or work/input is pending
- **THEN** no idle summarization request is sent

#### Scenario: Resume after compaction
- **WHEN** an eligible session is compacted and later receives a prompt
- **THEN** it resumes with the committed summary, retained constraints and recoverable original history

### Requirement: R9 Remote configuration boundary
SSH, Cloud and Remote Control environments SHALL remain explicitly unconfigured until user-owned endpoints and required configuration are provided. Local implementation SHALL proceed independently and remote behavior SHALL not be reported as verified.

#### Scenario: No remote endpoint
- **WHEN** the user states remote environments are not configured
- **THEN** local features continue and remote setup remains an explicit pending item
