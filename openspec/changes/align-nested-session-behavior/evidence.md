# Evidence and acceptance ledger

Checked 2026-10-21. This is an independent behavior reconstruction, not a claim of identical private internals or formally separated clean-room teams. No Claude runtime, account, private conversations or internal endpoints were used.

## Public sources

- [Official desktop documentation](https://code.claude.com/docs/en/desktop): independent histories, desktop-local session operations, recent roster, suggestions, environments and panes.
- [Official cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging): text messages with sender attribution, delivery boundaries and receiving permissions. CLI delivery semantics must not be confused with desktop's queued-after-current-work behavior.
- [Official subagents](https://code.claude.com/docs/en/sub-agents) and [agent teams](https://code.claude.com/docs/en/agent-teams): different execution/coordination concepts; nested UI lineage alone does not establish Team usage. Some subagent configurations also support sibling messages.
- [Official v2.1.299 notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.299): idle compaction is described for terminal, at 200K+ tokens and approximately 54 minutes, with minimum-token and off controls. Proxy cache savings are not established by these notes.
- [User X post](https://x.com/0xLogicrw/status/2110568549207212160): public text read through a relay; quotes [ClaudeDevs announcement](https://x.com/ClaudeDevs/status/2110445844675838148). Relay transport is not official documentation.
- [36Kr article](https://36kr.com/p/4026611597628033) and [QQ article](https://news.qq.com/rain/a/20261015A052VG00): full public articles read in a temporary browser. Include tasks/recap, notifications, split sessions, recent folders, multi-repository environments, confirmed follow-ups and optional composer suggestions beyond the user's screenshot summary.

## Offline corroboration

Installed Claude package metadata: 2.42304.2.0. Exact shipped ASAR SHA-256: `752ef3950e484470c25ff1f181b707e06b63d4fa8b5981792810e12e5cfe0e6d`. No launch, runtime attach or profile access. Static evidence supports separate fresh/fork sessions, lineage, linked messaging and completion wake-up; it cannot prove every runtime branch.

- Prior backend retained evidence: `ev_97f38f33a2f2b33f6018128f97ac49d8a4435a72c0ea05dd829961281846d302`.
- Prior renderer retained evidence: `ev_3d589d893429a1287b2623ecdc37de23a0c8c413a2738a26a6d3d38c8d818b7c`.
- Current backend attempt: `ev_916ad8d8502f7a0c5723e2bc3fe0c9d22145f161810d7624fbc37be44e99db74`; explicit analysis timeout, retained partial graph. Six companion native-artifact integrity contradictions prevent a full integrity claim.
- Current renderer: `ev_8a8567f7f28b85b5c769b504b3914b7e773e516fbfcf3982c75b53bc5dbc7c4b`; completed selected-file analysis with semantic budget limits and unselected files. Static only.

Proprietary extracts remain outside the configuration repository. Implementation uses DSH APIs and the behavioral requirements above.

## Current implementation evidence

| Requirement | Current evidence | Remaining acceptance |
| --- | --- | --- |
| R1 | Delivery skill and reviewer communication fix; real implementation occurred in proxy fixture | Full independent-review/acceptance run not yet passed |
| R2 | Native worktree module installed | Concurrent isolation, include and integrated acceptance |
| R3 | Linked-family unit regressions pass, bounded terminal reports and stopped/archive guards | Native lifecycle and explicit recent-local roster |
| R4 | Existing native hierarchy verified at prior release; redundant global entry removed in source | Current native UI, attention/tasks/recap/notifications |
| R5 | Native browser/diff/terminal already present | Session split, local multi-repository environments and recent-folder flow |
| R6 | Public contract established | Confirmed suggestion lifecycle, Start all, optional composer suggestions |
| R7 | Existing btw implementation and prior proxy proof | Current concurrent and shortcut regression |
| R8 | Native durable manual/pressure compaction available; isolated idle scheduler source and four eligibility/cancellation regressions pass | Native idle integration, user switch and real resume evidence |
| R9 | User answered remote endpoints unconfigured; proceed locally | User-owned endpoint configuration and real remote checks |

Current source regression: 43 tests passed, none skipped. These are not substitutes for the remaining real-host/proxy checks. Acceptance rows must be updated with actual evidence as work proceeds.
