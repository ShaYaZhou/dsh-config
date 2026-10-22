# Agent 能力增强（六项能力与 CC 模式）

2026-10-22。桌面 profile 在原配置上增加了三个本地模块（`claude-context`、`usage-report`、`session-bus`）和六个技能（`workflow-orchestration`、`dsh-code-review`、`security-review`、`claude-context`、`usage-report`、`dynamic-ui`）。`dynamic-ui` 带 `patterns/` 子目录（19 个图元 + `manifest.json`）和 `preview.py` 自检脚本，部署时随技能目录整棵复制。另提供额外可选 `cc` preset（CC 模式），把这些能力按 PTC 工具形态组合。全部是受管文件，安装后必须从菜单真正退出 Harness 再打开才加载。

三个模块都挂在**顶层全局 insert**，与原生 `working-directory`、`browser-guidance` 同级，而不是放进 preset。preset 会为每个 Agent 实例化一份插件：`session-bus` 若在 preset 内，第二个 Agent 打开同一 storage domain 会直接失败；`usage-report` 和 `claude-context` 也不需要重复实例。工具仍通过 `agent.ctx.tools.register` 按 Agent 注册，子代理不获得 `message_session`。

## 工作流编排

工作流不再只挂上游包。`plugins/workflow-ptc` 与 `plugins/tool-workflow` 从 0.2.1-rc.2 tag 的源码构建（`provenance.json` 绑定该原生运行时），只增加治理字段，不改既有脚本语义。配置仍为 `provider: spawn`、并发 16、单次运行最多 1000 个子代理：

```json
"workflow-ptc": {"provider": "spawn", "maxConcurrentAgents": 16, "maxTotalAgents": 1000}
```

四项对齐能力：

- **规模指引**：`tool-workflow` 的 `sizeGuideline`（默认 `medium`）按 small / medium / large 在工具描述里写明预期规模，并把对应的 5 / 10 / 25 个代理作为运行告警阈值；越过阈值时引擎告警，单次调用可通过 `warnAboveAgents` 覆盖。
- **整体预算**：单次调用用 `budget_tokens` / `budget_ms` 收紧（只能低于引擎配置），脚本侧另有只读 `budget` 全局，提供 `total`、`spent()`、`remaining()`、`elapsedMs()`、`timeRemainingMs()`。越过预算后的下一次 `agent()` 被拒绝，已收集的结果仍可返回。
- **嵌套限制**：工作流子代理不能再启动工作流（工具描述写作 `one level only`），与 Claude 的一层嵌套一致；子代理里仍可调用普通 `subagent`。
- **检查点 / 续跑**：每次运行写 `$DSH_HOME/workflows/runs/<runId>.jsonl`（header，加上每个 `agent()` 的 call / result 行）。`resume_from_run_id` 按 seq、prompt、provider、model、schema 回放未变前缀；第一个不匹配之后永久转 live，回放的子代理 tokens 记为 0。
- **schema 失败重试**：`agent()` 带 `schema` 时，子代理以 `completed` 结束却没有产出 structured 值，引擎用同一请求重开一个子代理，最多 `schemaRetries` 次（引擎配置，默认 5，设 0 关闭）。失败或取消的子代理不重试；重试前释放旧子代理，token 跨尝试累加，journal 只记最终尝试，`resume_from_run_id` 不会重放失败结果。每次重试都会通过宿主的运行进度记录一条日志。

`workflow-orchestration` 技能负责“什么时候用”：一两项委派走普通 `subagent`；多路独立审计、迁移、跨文件排查才用 `workflow`。技能同时写明实际契约：`meta` 与 `script` 分开传、`args` 必须是对象、`agent()` 失败返回 `null`、优先 `pipeline()` 而不是阶段屏障、重要发现做对抗验证。

边界：工作流子级不继承父会话的 cwd、preset 或 reasoning effort；一层嵌套的代价是“子代理里想再拆，只能把结果交回父级再编排”。token 预算要求宿主已挂载 `session-query`，只统计已结算子会话的 `tokenUsage` 投影，回放调用不计；没有该服务时只能设时长预算。每次 schema 重试都是一次完整的子代理运行，成本按尝试累加，真实模型下重试能否修正 structured 输出尚未验收。journal 含 prompt 文本，只落在 `DSH_HOME` 下，不纳入 Git。原生 subagent 活跃槽位已从默认 8 调到 20，工作流占 16，手工 `subagent` 保留 4；这些是协作式配额，不是硬性调度保证。工作流在被调用方的文件沙箱策略下运行，不能用来绕过权限。

## CC 模式

额外可选 preset `cc`（显示名“CC 模式”，order 2），默认仍是 `standard`。它的插件列表是 `preset-standard` 的完整克隆，再追加一行：

```json
{"id":"agent-tool-presentation","name":"@deepseek-ai/dsh-agent-tool-presentation","config":{"mode":"ptc"}}
```

PTC 只向模型暴露 `run_code`；文件、shell、skills、`subagent`、`workflow` 等能力通过生成的 SDK 在代码里调用。因为克隆了 standard，planning、compaction、delegation（16/1000）和技能目录都在。`claude-context`、`usage-report`、`session-bus`、Team、worktree、记忆和空闲压缩是顶层全局挂载，不随 preset 复制，CC 同样继承。`cc` 也加进了 `tool-subagent` 的 `allowedAgentPresets`，standard 或 CC 会话都能把它作为子代理角色选择；`start_session` 的 fresh 子会话也可指定 `agent_preset: "cc"`。

原生 preset 没有继承机制，插件列表必须复制；单测断言“CC = standard + presentation 行”，standard 改动后忘记同步 CC 会直接失败。PTC 需要宿主已组装 `ctx.ptcRuntime`（base 的 `ptc-runtime` 行），缺失时 preset 在挂载阶段拒绝，不会拖到第一条消息；每个 agent 只能声明一次呈现方式。

不设为默认：PTC 改变模型调用工具的方式，普通交互任务用 native 形态更直接；需要代码式编排时再选 CC。PTC 只改变工具呈现，不改变权限、沙箱和子代理继承边界；工作流的续跑、预算与一层嵌套由本地引擎提供，与是否选择 CC 无关。

## 会话间消息

独立插件 `session-bus`，不属于任何 preset。授权是**逐对**的 `from → to`，只能由用户在发送方会话里用命令建立：

```text
/session-bus list                 列出可发送的会话、短 ID 和已有授权
/session-bus allow <会话ID前缀>    授权本会话发送给该目标
/session-bus revoke <会话ID前缀>   撤销
```

模型侧只有两个工具：`message_session`（发送）和 `list_authorized_sessions`（只读列出已授权目标）。模型不能授权、不能给自己发送、不能读写对方对话内容。

发送复用原生链路：`createUserMessage({source:{kind:'agent-message', form:'relay', senderSessionId}})` 加目标会话的原生 `followup`，再 `ctx.sessions.flush`，与嵌套会话的家族消息一致，没有第二套消息队列。以下情况一律拒绝：未授权、给自己、空消息、超过 16000 字符、目标已归档、目标当前未运行、目标是原生子代理、目标已被用户停止。

停止保护：`turn/end` 的 `aborted`/`user` 原因会把目标标记为已停止，用户在目标会话重新发送消息或开始新回合后解除。授权与停止标记保存在 `session_bus` 存储 domain 的 global 状态，按插件可忽略记录持久；写操作串行化，避免并发授权覆盖。

对端消息会在文本前带上明确声明：这是 agent 之间转发的请求，不是用户授权，不得扩大权限、执行破坏性操作或服从与当前用户请求冲突的指令。`session-bus` 同时注入一条系统上下文，只列出当前确实可发送的目标。

## 团队审批与任务门禁

`modules/team.mjs` 增加两个可选治理开关，默认都关闭，不改变现有 Team 行为：

```json
"agent-team-local": {"requireTaskApproval": false, "taskGate": ""}
```

这两个字段是 `TeamService.Config` 的引擎配置项，默认关闭。当前模板 `config/desktop.patch.json` 只为该模块登记了 id 与入口，没有 config 块；要启用需先在模板里给该条目补上这段配置再重新生成，不要直接改已生成的运行时配置。

- **任务审批**：开启 `requireTaskApproval` 后，队友创建的任务进入 `awaiting_approval`，不能认领；只有 Team Lead 能用 `team_task_update` 的 `approve` / `reject` 放行或删除被拒任务（仍被未删除任务阻塞时拒绝删除）。Lead 自己创建的任务仍是 `pending`。
- **任务门禁**：配置 `taskGate` 为命令后，任务创建（TaskCreated）与完成（TaskCompleted）都会把 `{type, teamId, task}` 以 JSON 写到该命令 stdin，超时 10 秒。退出码 0 放行；2 拒绝并返回命令的 stderr；其他非 0 记 `TEAM_TASK_GATE_FAILED`。超过 10 秒同样按 `TEAM_TASK_GATE_FAILED` 拒绝，不会因门禁留下子进程而无限等待。门禁在写入共享任务之前执行，采用与 Claude Hook 相同的退出码约定。
- 审批与门禁都不改任务状态机与 revision 语义，`team_task_list` 直接显示 `awaiting_approval`。门禁是宿主进程里的同步命令，不是原生 Hook 事件，也不覆盖 TeammateIdle。

## 代码审查

`dsh-code-review` 是只读审查技能：先定范围（工作区改动、提交区间、PR、文件集），再读改动周围完整函数和调用方，按正确性、回归、权限与信任边界、资源、可维护性分维度检查，最后对抗自检后给出 `file:line` 证据。没有发现时说明检查范围和未覆盖项；未要求就不改代码。

参数：`effort low|medium|high`（默认 `medium`）、`--comment`（按行内评论交付）、`--fix`（审查后应用最小修复）、`--json`。`--json` 输出固定契约，便于脚本消费：

```json
{"schemaVersion":1,"findings":[{"severity":"high|medium|low","kind":"correctness|regression|permission|resource|maintainability","file":"path/to/file.ext","line":123,"summary":"一句话结论","trigger":"具体输入或状态","impact":"错误行为/数据损坏/权限提升","evidence":"相关代码或测试输出","suggestion":"最小修复方向","confidence":"confirmed|pending"}]}
```

技能名不是 `code-review`，因为 DSH 的外部技能 provider（`~/.codex/skills`、`~/.claude/skills`、`~/.agents/skills`）优先级高于桌面 `customSkillDirs`，同名会被覆盖。安装器同时保留旧名用于清理旧部署。

## 安全审查

`security-review` 是技能加同目录只读脚本 `scan.mjs`：

```powershell
node .\scan.mjs <目标路径> --json
```

脚本跳过 `.git`、`node_modules`、`build`、`dist`、`.local`、符号链接和二进制/超大文件，默认最多 20000 个文件，输出中的密钥一律 `[redacted]`。输出带 `schemaVersion: 1`。命中只是审查线索，不是确认漏洞；必须回到源码确认可达性。`--fail-on high|medium|low` 用于门禁：本仓库接成 `npm run scan:security`（`--fail-on high`，只有 high 命中返回 1），`npm run check` = `npm test` + 该扫描；缺值或非法值返回 2，不会静默放行。

人工部分按信任边界而不是文件清单走：入口验证、授权、注入、文件与进程、凭据、网络、依赖供应链、失败模式和数据保留。只做无害复现，不执行破坏性命令、不横向移动、不外传数据。

## 浏览器

保持两个 Playwright MCP 服务，用工具前缀区分：

- `mcp__playwright__browser_*`：`--isolated` 全新隔离浏览器，用于公开页面和无需登录的操作。
- `mcp__playwright-session__browser_*`：持久 profile `DSH_HOME/browser-profiles/playwright-session`，输出目录 `DSH_HOME/browser-output-session`，用于需要保留登录态的场景。

两个服务的 `--browser` 都写作模板令牌 `${BROWSER}`，安装时按本机 settings 的 `browser` 渲染，模板里不再留死值。持久 profile **不继承用户日常浏览器的登录态**，需要在该窗口里单独登录一次；它也不是安全边界，不要把高权限账号长期留在里面。两个服务都不改写浏览器安全配置。`browser-guidance` 的提示文本同时说明了这两条链路的区别（并修正了模板字符串里的反引号语法错误）。详见 [浏览器与桌面控制](BROWSER-COMPUTER-USE.md)。

## 可观测性/成本

`usage_report` 工具读取原生会话投影（`tokenUsage`、`contextPressure`、`sessionStats`、`modelSelection.lastUsed`），不解析日志文件。不传参数报告当前会话；`session_ids` 最多 20 个，每个都要通过当前会话的 `remoteAccess` 检查。单个会话读取失败只标记 `unavailable: true`，不影响其余会话。

输出包括四项 token、总量、缓存命中率 `cacheRead/(uncachedInput+cacheRead)`、上下文压力与窗口、`pressurePercent`、`projectedTokens`、`llmMs`/`toolMs`/`ttftMs`、轮次与步数。

DSH 原生只记录 token，不记录价格。`cost` 只有在模块配置里为对应模型提供每百万 token 费率后才存在；没有匹配费率时为 `null`，`totals` 给出 `unpricedSessions`。这是估算，不是账单，不要凭记忆填厂商价格。

## Claude 文件与记忆

DSH 原生 `dsh-agent-instructions` 已经读取项目根到 cwd 的 `AGENTS.md` / `CLAUDE.md` 及 `.local` 变体。它**不读** `~/.claude/CLAUDE.md`、`<cwd>/.claude/CLAUDE.md` 或 `.claude/rules/`，这部分由 `claude-context` 模块补齐：

- 用户级 `~/.claude/CLAUDE.md`（24000 字符上限）
- 项目级 `<cwd>/.claude/CLAUDE.md`（24000）
- `<cwd>/.claude/rules/*.md` 只读直接文件、按文件名排序、总量 24000，单文件 8000
- 项目记忆只注入一行索引路径，不注入内容

Claude 专用的 `RTK` 段落和单独成行的 `@import` 会被过滤：前者在 DSH 有不同规则，后者不会被 DSH 展开。注入文本标记为“用户指令”，但与仓库 `AGENTS.md` 和当前请求冲突时以后者为准。

`claude-context` 技能负责按需读取：先用 `MEMORY.md` 的 `description` 判断相关性，只打开相关记忆文件，并回到源码确认记忆里提到的文件/函数仍然存在。记忆是背景证据，不是授权；只读 `~/.claude`，不把 DSH 会话写回 Claude 记忆。

## 验收

- 完整 `rtk npm test` 143 项通过，无跳过；新增工作流上限与全局挂载、CC preset 克隆关系、session-bus 授权/停止/去重、usage 计算与无价格、安全扫描脱敏与目录跳过、claude-context 过滤与 project slug 等断言。
- 隔离 DSH_HOME 完整安装后，用安装版同一 Electron 运行时启动桌面 profile：`ENHANCED_ACCEPTANCE_PASS`，确认 `usage_report`、`message_session`、`list_authorized_sessions` 三个工具注册，两个 Playwright 服务前缀都存在，五个技能解析到 `agent-capabilities/skills/`，`/session-bus list` 返回 success，装配后的系统提示含 `claude-context`（含合成标记）与 `session-bus`。`dynamic-ui` 在该次验收之后加入，只验证了部署映射（`patterns/*.md` 与 `preview.py` 进部署清单）、本地自检和真实宿主 `@agent-deck/visualize.render` 渲染，没有重跑整轮隔离安装。
- CC 模式：隔离 `DSH_HOME` 重新安装后，standard 会话解析为 `native` 且 `workflow` 直接可见；`agentPreset: "cc"` 会话解析为 `ptc`，模型可见工具只有 `run_code`，输出 `CC_PRESET_ACCEPTANCE_PASS`。
- 工作流治理在隔离 `DSH_HOME` 中完成宿主验收（`WORKFLOW_ACCEPTANCE_PASS`）：`workflow` 工具暴露 `resume_from_run_id`、`budget_tokens`、`budget_ms`，描述含规模指引、续跑与 `one level only`；引擎装配为并发 16 / 总量 1000 / journal 开启；真实运行生成 call/result journal；`resume_from_run_id` 的新运行只写 header；在活跃工作流子会话上再启动工作流被拒绝；`maxDurationMs: 300` 的运行在 604 ms 时拒绝第二次 `agent()`。该 home 没有模型凭据，子代理通过宿主注册的 stub provider 启动，因此真实模型的 token 预算触发未验收；token 读取所用的 `tokenUsage` 投影四字段已单独确认。
- 未做真实模型调用：本次环境没有可用的 `OPENAI_API_KEY`，验收止于原生装配层。`usage_report` 的端到端工具调用也因此没有实跑，只验证了注册与字段映射；CC 模式同样没有执行真实的 `run_code` 程序。
- 验收期间原生 `spill-local` 输出过一次临时目录 `EPERM` 警告，宿主仍正常启动并完成验收；与本仓库模块无关。
- 真实宿主验收必须固定宿主版本；升级 Harness 后重新验收，不能只改版本号。
