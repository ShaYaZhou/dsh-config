# 可迁移性验收

## 2026-10-23 干净环境技能同步

- 入仓技能：`skills/` 新增 `ponytail`、`check`、`handoff`、`implement`、`grill-me`、`grill-with-docs`、`grilling`、`domain-modeling`，来源为本机 `~/.claude/skills` 与 `~/.agents/skills`。`grill-me` 依赖 `grilling`，`grill-with-docs` 依赖 `grilling` + `domain-modeling`，四项必须同时部署。
- 部署路径：安装器按 `skills/*/SKILL.md` 自动发现，复制到 `profiles/desktop/agent-capabilities/skills/<名称>/`；只有 DSH 的机器执行 `install` 即得到 24 个受管技能（18 个本地 + 6 个 OpenSpec）。这些技能不进入 `align-skills.mjs` 的附录清单，也不写入 agent 全局目录。
- 验证：`install --dry-run` 从 65 个受管文件增至 94 个；安装后 `~/.dsh/profiles/desktop/agent-capabilities/skills` 列出全部 24 个技能，`status` 无漂移；`test/portable.test.mjs` 13 项与完整 `npm test` 157 项通过，其中「versioned sources contain neither personal host paths nor credential files」覆盖新增文件。
- 未验证：只在安装目录层面确认技能落盘，未在真实 DSH 会话里逐个触发这些技能的模型调用。

## 2026-10-23 主对话内的子代理入口

- 交互：`plugins/nested-sessions` 在 `tool.call.toolview` 上为 `subagent`、`subagent_fork` 注册轻量组件，把原生工具行替换成「子代理 + 描述 + 状态」，并提供「并排查看」「在主视图打开」「检查」与可展开的提示词。子会话 id 从工具结果的 `started subagent <id>` 解析，打开复用原生 `subagentchat` 资源，状态读原生子会话投影。
- 冲突修复：原生 `details-toolview` 已经以 priority 0 注册同名 key，首个版本同优先级注册时宿主直接抛 `keyed slot "tool.call.toolview" already has an entry for key "subagent" at priority 0`，整个客户端不渲染。改为 `priority: -1`（最低者渲染）后生效，`test/nested-client.test.mjs` 锁定该优先级，`provenance.json`、锁模板与 `package.json` 同步到 1.3.5。
- 验收方式：隔离 `DSH_HOME` 装入 1.3.5 包后启动 desktop profile 的 Web UI，真实模型按提示词调用一次 `subagent`，再在页面里检查该工具行。
- 结果（`INLINE_SUBAGENT_UI_PASS`）：第一轮工具行显示「子代理 / UI inline entry check / 已完成」与三个按钮；点击「并排查看」后右侧出现子会话面板并显示 `INLINE`。截图 `inline-subagent.png`、`inline-subagent-side.png` 留在 `.local`。
- 自动化注意：宿主把已完成的步骤放在 `hidden="until-found"` 里（配合浏览器查找的 reveal），Playwright 判定为不可见；验收脚本改为对隐藏祖先派发 `beforematch` 事件，触发组件自带的 reveal 钩子，属于宿主原生机制而非绕开。
- 结果（`INLINE_FORK_UI_PASS`）：另起会话让真实模型调用 `subagent_fork`，同一组件渲染「子代理 / UI fork entry check / 已完成」与三个按钮；三个动作都是原生 `<button type="button">`，可访问名称分别为「并排查看」「在主视图打开」「检查」（后者另有 `aria-label="在轨迹中检查该调用"`），提示词为原生 `<details>`。把焦点移到「并排查看」后按 Enter 打开右侧子会话面板并显示 `FORK`。截图 `fork-inline.png`、`fork-inline-side.png` 留在 `.local`。
- 未验证：只用可访问名称和键盘激活检查了无鼠标路径，没有用真实读屏软件（Narrator/NVDA）跑一遍；「检查」打开的轨迹内容未断言。
- 部署：构建产物 `nested-sessions-1.3.5-67fe8850f6cf.tgz`，`install --dry-run` 后装入隔离 home（备份 `portable-harness-2026-10-23T01-38-24-657Z`）；`rtk proxy node --test test/portable.test.mjs` 13 项通过，完整 `npm test` 157 项通过。

## 2026-10-23 Team 计划审批、Hook 事件与成员面板

- 计划审批：`modules/team.mjs` 增加 `submitPlan` / `listPlans` / `resolvePlan` / `hasPendingPlan`；`modules/team-tools.mjs` 增加 `team_plan_submit`、`team_plan_list`、`team_plan_resolve`，并在成员有待审计划时用工具 guard 只放行 `read`、`read_image`、`glob`、`grep`、`skill`、`send_message`、`team_task_get`、`team_task_list`、`team_plan_list`。拒绝必须带反馈。
- Hook 事件：`TeamService.Config.hooks` 可配 `TaskCreated` / `TaskCompleted` / `TeammateIdle`（字符串或字符串数组），事件 JSON 走 stdin，10 秒超时，退出码 0 放行、2 拦截、其他记为门禁失败；`TeammateIdle` 在 `agent/turn-stopping` 运行，退出码 2 把 stderr steer 回成员继续本轮。旧 `taskGate` 仍是两个任务事件的回退命令。
- 成员面板：新增本地客户端包 `plugins/team-view`（`@local/dsh-team-view`），同步 `provenance.json`、`config/desktop.package.json` 与锁模板；侧栏入口读取选中会话的 `agentTeam` 投影，列出成员状态与待审计划数，可经原生 `subagentchat` 资源并排打开成员。`test/team-view-client.test.cjs` 加入测试清单。
- 验收方式：隔离 `DSH_HOME` 启动 desktop profile，真实模型驱动；凭据只在进程内存中从本机凭据文件转发，不落盘、不打印。脚本位于 `.local/accept-2026-10-22-a`（不入库）。
- 结果（`TEAM_ACCEPTANCE_PASS`）：真实队友提交计划后 `team_plan_submit` 阻塞；Lead 批准后返回 `approved`，拒绝无反馈被 `TEAM_INVALID_ARGUMENT` 拒绝，带反馈拒绝返回 `rejected` 与反馈；`team_plan_list` 状态为 `approved`/`rejected`。`TaskCreated`、`TaskCompleted`、`TeammateIdle` 三个 Hook 均实测：退出码 2 时任务创建被 `TEAM_TASK_BLOCKED` 拦住且任务未落库、任务完成被拦住并保持 `in_progress`、成员空闲被拦后收到 steer 继续工作且之后仍能正常结束。
- 真实缺陷与修复：计划最初以 `team/plan` 直接追加，安装版冷读时报 `SessionFormatUnsupportedError: ... unknown to this harness and not marked ignorable`。改为 `appendPluginRecord(session, "plugin:agent-team-local/plan", ...)` 后，原生持久化可以跳过该记录，安装与冷读通过；验收断言历史中有 4 条 `plugin:agent-team-local/plan` 记录且均为 `ignorable: true`、`version: 2`。
- 界面验收（`TEAM_UI_PASS`）：安装版 Web UI 中选中 Lead 会话，侧栏 `Team` 面板列出真实队友 `worker` 与「就绪」状态；点击 `并排打开` 后右侧栏出现该成员的 `subagentchat` 会话，显示 `Reply with exactly: READY` → `READY`。截图留在 `.local`。
- 整组布局（`TEAM_UI_MULTI_PASS`）：在同一 Team 中再启动真实队友 `helper`（`Reply with exactly: HELPER` → `HELPER`），`全部并排` 提示「已并排打开 2 个成员」，右侧同时出现 `worker` 与 `helper` 两个 `subagentchat` 面板，各自显示 `READY` / `HELPER`；截图 `team-ui-open-all.png`。
- Hook 超时缺陷与修复：首轮验收记录 `HOOK_TIMEOUT_PASS {"elapsedMs":10009,"hookSurvived":true,"grandchildSurvived":true}`——超时只结束了 cmd.exe，Hook 进程及其脱离的孙进程都存活。改为 Windows 上以 `taskkill /pid <shell> /T /F` 结束整棵树（`kill()` 只作为 `taskkill` 失败后的回退），修复后同一脚本得到 `HOOK_TIMEOUT_PASS {"elapsedMs":10017,"hookSurvived":false,"grandchildSurvived":false}`。中间版本把 `child.kill()` 与 `taskkill` 并排调用，`taskkill` 因 shell 已退出返回 128，树杀必须独自完成。
- 部署：`install --dry-run` 预览后安装（保留备份 `portable-harness-2026-10-22T16-21-45-498Z`），安装时 `status` 无漂移；之后启动 Web UI 验收时，宿主自身把该隔离 home 的 `profiles/desktop/cordis.patch.yml` 改写成 YAML 并更新 `welcomeNoticeVersion`（`2026-08-13.1` → `2026-09-28.1`），再查 `status` 会报告这一个文件漂移，与本次源码无关。`rtk proxy node --test test/portable.test.mjs` 13 项通过，完整 `npm test` 156 项通过。
- 未验证：一次回合可能多次触发 `turn-stopping`，因此同一回合的 `TeammateIdle` Hook 次数不固定；POSIX 上 Hook 超时仍只结束 shell，后代进程可能继续运行（只在 Windows 验证）；计划与 Hook 只有本机验收脚本，仓库内没有对应自动回归。

## 2026-10-22 子代理能力验收与嵌套深度对齐

- 配置：`config/desktop.patch.json` 的 `@deepseek-ai/dsh-subagent` 增加 `maxDepth: 3`（原生默认 1）。Claude Code 的 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 默认值同为 3，语义一致：根会话深度 0，子代理每层加一，超过上限的启动被拒绝。`test/portable.test.mjs` 的配置断言同步为新值。
- 验收方式：`.local/` 下的临时脚本在隔离 `DSH_HOME` 启动 desktop profile，用真实模型驱动；凭据只在进程内存中从本机凭据文件转发，不落盘、不打印。未使用 computer-use，也不需要桌面窗口。
- 结果（`SUBAGENT_ACCEPTANCE_PASS`）：父会话工具含 `subagent`、`subagent_fork`、`send_message`、`list_agents`、`interrupt_agent`；`maxDepth` 解析为 3；首轮回复正确；`listChildren` 返回 `mode: continuable`，`listDescendants` 中深度为 1；对空闲子代理 `sendMessage` 直接开新回合；`dispose()` 之后再发消息，子会话冷恢复且累计 3 个回合（没有新建会话）；子代理用 `send_message` 把消息投进父会话 inbox；以祖先身份 `interrupt` 使运行中的回合以 `aborted` 结束；子代理再用自己的 `subagent` 工具派出孙代理，`listDescendants` 出现深度 2。
- 部署：`install --dry-run` 预览 65 个受管文件后安装到默认 `DSH_HOME`（备份 `backups/portable-harness-2026-10-22T15-44-40-493Z`），`status` 无漂移；`node --test test/portable.test.mjs` 13 项通过。
- 未验证：Team 包装层（`spawn_teammate` / Team 自带 `send_message`）未单独跑真实模型验收，本次覆盖的是它依赖的原生子代理服务；成员级原生计划模式与原生 Hook 事件仍未对齐——原生 `exit_plan_mode` 的评审只能由运行时根会话发起，被在线 Agent 拥有的子会话无法打开评审。
- 隔离环境安装提示：pnpm 在无 TTY 时会中止删除 `node_modules`，需设置 `CI=true`；中途失败后要先 `rollback --home` 再重装。

## 2026-10-22 技能与部署环境对齐

- 新增 `scripts/align-skills.mjs` 与 `docs/SKILLS-ALIGNMENT.md`，把 `skills/dynamic-ui`、`skills/think`、`skills/pua` 复制到 agent 全局技能目录；`skills/think`、`skills/pua` 从本机副本入仓，仓库成为唯一来源。`package.json` 测试清单加入 `test/align-skills.test.mjs`。
- 行为：默认目标为用户主目录下的 `.claude/skills`；目标不存在则全量复制；目标为目录联接时删除链接并写入真实副本；文件内容不同则覆盖为仓库版本；目标含仓库没有的文件时跳过该技能并以退出码 1 结束；`--check` 只读。文档附录由脚本从各 `SKILL.md` 生成，`--check` 一并比较。
- 本机验收：`--check` 首次报告 `dynamic-ui` 为目录联接、文档附录不一致（退出码 1）；执行后 `dynamic-ui` 变为真实目录（22 个文件），`think` 4 个、`pua` 1 个，再跑 `--check` 三项技能与附录均为「已一致」。
- 测试：`node --test test/align-skills.test.mjs` 4 项通过（逐字节复制、拒绝覆盖本机独有文件、目录联接替换、附录一致）；`node --test test/portable.test.mjs` 13 项通过；完整 `npm test` 153 项通过。
- 未验证：WorkBuddy 等不能运行脚本的 agent 按文档第四节手工核对未实跑；`think`、`pua` 尚未在真实 DSH 会话中加载验证。

## 2026-10-22 消息内文件路径链接

- 新增本地客户端包 `plugins/file-links`（`@local/dsh-file-links`），同步 `provenance.json`、`config/desktop.package.json`（dependencies 与 `dsh.profile.bundles`）、锁模板和部署漂移清单；`dsh.client.inject` 固定先加载原生 deliverables 客户端。
- 行为：原生 `chatFileMentions` 命中产出/交付文件时原样返回；未命中时由 `parsePathRef` 做纯语法识别（扩展名、`./`、`../`、`/` 前缀、隐藏文件、已知顶层目录），支持 `:42`、`#L42`、`:42-60` 行号后缀，再调用原生 `owner.openFile(path, {line})`；含空白、URL、UNC、引号、`and/or`、`3.5`、`e.g`、`src/` 的 token 保持纯文本。
- 本地验收：`test/file-links-client.test.cjs` 沿用 `follow-ups-client` 的 VM 方式加载客户端 bundle，4 项断言通过（识别、拒绝、包装与 open 参数、等待服务注入）；`node --test test/portable.test.mjs` 13 项通过；完整 `npm test` 149 项通过。
- 部署：`install --dry-run` 预览 60 个受管文件；`install --refresh-lock` 部署到默认 `DSH_HOME`（备份 `backups/portable-harness-2026-10-22T14-54-39-001Z`），`lock` 重新生成两份锁模板，`status` 无漂移；已确认 `profiles/desktop/node_modules/@local/dsh-file-links/lib/client.js` 与 `state.json` 的漂移记录存在。
- 未验证：没有在运行中的桌面窗口里实际悬停并点击新链接（需重启 Harness 并产生一条含路径的助手消息）；`smoke` 未运行（缺少 `OPENAI_API_KEY`）。宿主升级后须重新验收该内部接口。

## 2026-10-22 团队审批、审查门禁与 schema 重试

- 团队治理：`modules/team.mjs` 新增 `awaiting_approval` 状态、Lead 的 `approve`/`reject`、可选 `requireTaskApproval`（默认关闭）与 `taskGate`（TaskCreated/TaskCompleted 同步执行）。门禁走 stdin 传 `{type, teamId, task}`，10 s 超时，退出码 0 通过、2 拒绝为 `TEAM_TASK_BLOCKED`、其他为 `TEAM_TASK_GATE_FAILED`。默认关闭不改变现有 Team 行为。
- 审查治理：`skills/security-review/scan.mjs` 输出带 `schemaVersion: 1`，`--fail-on` 缺值或非法值返回 2（此前会静默放行）；扫描跳过 `.local`。仓库接入 `npm run scan:security`（`--fail-on high`）与 `npm run check`（`npm test` + 扫描）。同时修复了重复命中：`redactLine` 复用带 `g` 的扫描正则做 `replace`，会把 `lastIndex` 归零，导致同一命中被记录两次；改为新建正则后，全仓扫描摘要由 `0 high, 6 medium, 29 low` 降为 `0 high, 3 medium, 15 low`，退出码仍为 0，并补了两条计数断言。
- 工作流 schema 重试：`schemaRetries`（默认 5）在子代理 `completed` 但缺少 schema 要求的 structured 值时，以同一请求替换为新子代理；失败或取消不重试；token 跨尝试累加；只有最终尝试写入 journal。改动在宿主编排层（`src/host.ts`、`src/index.ts`），guest 源码未改。
- 本地验收：以 stub 宿主直接驱动构建产物 `lib/index.js`，取得 `SCHEMA_RETRY_ACCEPTANCE_PASS`：默认值为 5；无 structured 时重试；旧尝试被 dispose；三次尝试 token 合计 30；journal 只出现一条 call 与一条 result；失败与无 schema 的调用不重试；重试次数有上限。运行该验收需要给引擎配置 `budgetTokens`，否则宿主不会注入 `readTokens`，token 读数恒为 0。
- 清理与审查后修复：schema 重试的旧子代理释放统一走 `disposeChild` 并清空其 disposal 记忆，避免重复释放或新子代理漏释放；`taskGate` 补 stdin `EPIPE` 监听（门禁不读 stdin 时不再抛未处理 stream 错误）与 64 KiB stderr 上限；任务创建/完成各只计算一次投影；`reject` 与 `delete` 共用同一依赖检查。复审后另修两处：门禁超时改由计时器直接以 `TEAM_TASK_GATE_FAILED` 结算（此前只 kill shell，孙进程持有 stderr 时 `close` 不触发，会无限挂起并占住 Lead 的事务）；schema 重试占用一次 `maxTotalAgents` 名额，不再绕过该上限，`agentsStarted` 仍只统计 `agent()` 调用数。修复后重跑 `npm test` 145 项通过与 `SCHEMA_RETRY_ACCEPTANCE_PASS`。
- 完整 `npm test` 通过，`npm run scan:security` 在高危 0 命中时退出 0。
- 未验证：真实宿主中的 Team 审批与 `taskGate`（本次只做了源码检查与 `npm test`，未在隔离 `DSH_HOME` 启动宿主开启该配置）；真实模型下的 schema 重试能否修正 structured 输出；子代理恢复与消息、MCP 授权、浏览器真实登录均未做真实会话验收。
- 回滚限制：把 `modules/team.mjs` 换回旧版本后，含 `awaiting_approval` 任务的会话会被旧枚举 schema 拒绝读取（`team/task` 事件数据未丢失，重新升级即可恢复）。`stateVersion` 仍为 4；提升它只会丢弃缓存行，无法让旧代码接受新状态。

## 2026-10-22 工作流治理：续跑、预算、嵌套与规模指引

- 新增两个本地包 `plugins/workflow-ptc` 与 `plugins/tool-workflow`，由 `.local/src/deepseek-harness` 的 `dsh-v0.2.1-rc.2` tag 源码构建；`provenance.json` 继续绑定 0.2.1-rc.2 原生运行时，升级宿主必须重新验收。
- 修复一个会中断全部工作流的默认值问题：schemastery 会丢弃 `default(null)`，导致 `budgetTokens` / `budgetMs` 变成 `undefined`，任何运行在 `begin` 阶段就以 “binding value must be lossless JSON” 失败。引擎构造函数现按 `config.budgetTokens ?? null` 归一化。
- 隔离 `DSH_HOME` 重新安装后，用安装版同一 Electron 运行时启动 desktop profile，取得 `WORKFLOW_ACCEPTANCE_PASS`：`workflow` 工具参数含 `resume_from_run_id`、`budget_tokens`、`budget_ms`；描述含 medium 规模指引、续跑与 `one level only`；引擎为并发 16 / 总量 1000 / journal 开启；一次真实运行的 journal 含 header、call（带 childId）与 result；`resume_from_run_id` 的新运行只写 header 且值与旧运行相同；在活跃工作流子会话（childId）上再启动工作流被拒绝；`maxDurationMs: 300` 的两次 `agent()` 在 604 ms 时拒绝第二次，journal 只有一条 call；`tokenUsage` 投影确认含四项数字字段。
- 限制：隔离 home 没有模型凭据，子代理通过宿主注册的 stub provider 启动，因此没有真实模型的 token 预算触发记录；token 与时间预算共用 `assertBudget`，token 读取形状已单独确认。完整 `npm test` 143 项通过，锁模板已按修复后的安装重新生成。
- 未部署到用户日常 home、未重启桌面进程。

## 2026-10-22 六项能力、CC 模式与 Claude 上下文注入

- 完整 `npm test` 143 项通过，无跳过；新增断言覆盖三个模块的全局挂载（且不在 preset 内）、workflow 16/1000 上限与 `subagent` 活跃槽位 20、两个 Playwright 服务、session-bus 授权/前缀/停止/去重、usage 计算与无价格、安全扫描脱敏与目录跳过、claude-context 过滤与 project slug。
- 同日把 `workflow-ptc` 从并发 6 / 单次 64 提到并发 16 / 单次 1000，并把原生 `subagent` 活跃槽位从默认 8 提到 20。隔离 `DSH_HOME` 重新安装后，用安装版运行时启动 desktop profile 并创建会话，读到已装配引擎 `{maxConcurrentAgents:16,maxTotalAgents:1000}` 与 `{maxDepth:1,maxActiveSubagents:20}`，`workflow` 工具存在，输出 `LIMITS_ACCEPTANCE_PASS`。仍未做真实模型调用，16 路并发下的排队与限额行为未验收。
- 新增额外可选 preset `cc`（CC 模式）：完整克隆 `preset-standard` 的插件列表，追加 `@deepseek-ai/dsh-agent-tool-presentation` 的 `mode: ptc`，并把 `cc` 加入 `tool-subagent.allowedAgentPresets`。单测断言 CC 列表严格等于 standard 加呈现行；隔离 `DSH_HOME` 重新安装后启动 desktop profile，分别创建 standard 与 `agentPreset: "cc"` 会话：standard 解析为 `native`、`workflow` 直接可见，CC 解析为 `ptc`、模型可见工具只有 `run_code`，输出 `CC_PRESET_ACCEPTANCE_PASS`。未做真实 `run_code` 模型调用。2026-10-23：按用户反馈移除该预设，`preset-cc` 与 `allowedAgentPresets` 中的 `cc` 一并删除，单测改为断言两者不存在；本节保留为历史验收记录。
- 隔离 DSH_HOME 全新安装 38 个受管文件后，用安装版同一 Electron 运行时启动 desktop profile，取得 `ENHANCED_ACCEPTANCE_PASS`：`usage_report`、`message_session`、`list_authorized_sessions` 注册；`mcp__playwright__*` 与 `mcp__playwright-session__*` 两套工具都存在；5 个技能解析到 `agent-capabilities/skills/<name>/SKILL.md`；`/session-bus list` 返回 success；装配后的系统提示含 `claude-context`（合成 `.claude/CLAUDE.md` 标记可见）与 `session-bus`。（`dynamic-ui` 在该次验收之后加入，本次只验证到部署计划包含其 `patterns/` 资源与 `preview.py`，未重跑隔离安装。）
- 修正两处实现问题：三个模块原先挂在 preset 内，第二个 Agent 会重复打开同一 storage domain；`browser-guidance` 模板字符串内的反引号导致语法错误。两者都有回归覆盖。
- 技能 `code-review` 重命名为 `dsh-code-review`：外部技能 provider（`~/.codex/skills` 等）优先级高于桌面 `customSkillDirs`，同名技能会被覆盖；安装器白名单保留旧名用于清理旧部署。
- 限制：本次环境没有 `OPENAI_API_KEY`，未做真实模型调用，也没有端到端执行 `usage_report` 工具；验收止于原生装配层。工具注册侧的 `execute(args, exec)` 签名已从宿主源码确认。启动期间原生 `spill-local` 输出过一次临时目录 `EPERM` 警告，宿主仍完成启动和验收。
- 该隔离 home 不是用户日常 home；正式部署需重新 dry-run、备份后执行，未确认前不重启用户当前桌面进程。

## 2026-10-21 本地环境与最近文件夹

- 独立源码快照完整 96 项回归通过，无跳过。新增环境执行、catalog 与客户端检查覆盖 owner-only、字面量变量/空值、平台大小写、取消、家族继承、便携定义和目录绑定隔离、全量预检、部分失败保留、解绑与原生导航引用释放。
- Windows 安装版 0.2.1-rc.2、隔离 home、真实 proxy 的 `environment-execution-test` 通过：并发模型分别调用原生 pwsh，变量互不串用；原生 PTY 收到本会话值，无环境会话不受影响，更新变量后下一次调用生效，初始 provider 请求不含测试值。
- 两个真实 Git 仓库创建独立 worktree，源目录未提交内容及未选择的忽略文件保持原样。第二仓库的 linked session 继承环境，但原生沙箱 root 仍是各自的 immutable cwd。
- 关闭 runtime 后，不加载环境插件，仅原生 persistence 冷读会话，确认 `plugin:local-environments/selected` 为 ignorable。隔离 home 重新安装、固定锁校验通过。原先只在测试中出现的未知必需事件未进入实际日常 home，当前写入已改用原生 plugin record。
- 同源原生前端实际点击：保存环境、清空/恢复绑定、缺少变量前置报错、只写变量保存、在新会话中使用、最近文件夹新会话、返回启动来源后未发草稿完整保留。设置页启动成功后面板自动关闭。
- 实际下载的定义 JSON 不含测试路径/值；通过文件选择器导入新标识后，未配置本机绑定会明确拒绝启动。侧栏与设置复用同一管理组件。截图在任务输出中：`本地环境与最近文件夹验收.png`、`本地环境返回原会话草稿验收.png`、`跨电脑环境定义导入与缺失绑定验收.png`。
- 使用完整安装配置的普通 proxy smoke 通过，持久角色、工具、旁问与正常回复可用；不靠临时验收 overlay 代替安装包挂载。
- 安全、架构、四角度审阅完成；发现的原生装配、可忽略记录、凭据路径、大小写、失败 runner、解绑和设置导航问题均已处理。返回来源观察使用固定版本内部 selection store，升级需复核。
- 实际日常 home 已由同一安装器备份部署，备份标识 `portable-harness-2026-10-21T13-10-40-878Z`；status 无漂移，环境插件部署文件逐字节匹配源码，四项 headless 文件哈希保持不变。没有重启用户窗口；新增桌面模块在下一次完整重开后加载。

真实 GUI 验收使用安装版同源前端和隔离原生后端，没有操作或重启用户正在工作的桌面窗口；没有启动或附加 Claude。未在第二台物理电脑、macOS/Linux 或远程环境验证，也未操作 OS 目录选择器；目录选择复用原生能力，手动绑定与导入已实测。后续任务建议 R6 仍待实现，本项不代表整个对齐目标完成。

## 2026-10-21 跨任务全局状态分类

- 完整回归 79 项通过，无跳过。新增真实终态投影、元数据读取的 20 项上限/去重/严格输入/访问撤销/原生取消、未知与迁移状态不冒充完成、目录身份过滤、运行时间戳失效、打开时清缓存、关闭后迟到结果丢弃，以及旧面板恢复路由分支的测试。
- 最终后端 `GLOBAL_ATTENTION_PASS`，14 秒：先禁用新插件生成真实 proxy 完成历史、原生用户停止和原生失败，再重新启用插件读取这些缺少新投影的当前日志格式历史。完成/停止/错误区分正确，查询没有激活目标 Agent、调用模型或改变原事件摘要。真实模型仅用于生成完成样本；停止和失败通过原生 request gate 稳定制造，不宣称为 provider 自身失败。这不是旧日志格式自动迁移测试。
- 实际原生前端的侧栏底部状态入口正常显示跨工作区分组。正在执行的合成回合归为进行中，真实问题卡片归为需要介入，冷完成历史归为已完成，停止历史在其他会话。实际点击“再显示 20 个”展开到 40 项，归档一条合成停止会话后其组计数从 6 减为 5。
- 同一用户消息时间不变的 agent-message 快速失败，无需点击刷新便将一个旧完成状态移到需要介入；真实 proxy 任务完成后进行中从 1 自动变 0，完成数增加。通过分组打开原问题卡片、回答 Green 后实际回复 `GLOBAL_UI_ANSWERED`，重开分组显示新完成状态；跨会话跳转后的 `GLOBAL_DRAFT_KEEP` 草稿保持。Escape 关闭并恢复触发按钮焦点，最终浏览器 error/warn 日志为空。
- 审查先发现并复现了仅按 updatedAt 缓存的两个问题：回合结束时此时间不变，以及关闭期间后台回合完整运行后布尔状态又回到 false。均有观察到失败后通过的回归，修复使用运行状态参与缓存判断，并在所有关闭/打开路径清空缓存。实际前端还捕获了未绑定 getSnapshot 方法的错误，最终改用原生 useWorkspaces hook，不自建订阅。
- 独立架构、安全与假设/组合/操作序列/滥用审查；1000 会话模拟产生 50 批请求，每批最多 20，最大在途 1。该模拟不等于 1000 个大历史的实机性能验证。停止/迁移/损坏和平台覆盖仍按具体已测范围解释。

截图为任务输出 `跨工作区会话状态分组验收.png`、`全局分类自动更新与草稿保留验收.png`。新状态接口只提供元数据，不改变跨工作区正文读取的单会话授权，也不提供发送、停止或权限扩大能力。本次仅操作隔离合成会话。

最终源码快照的 79 项回归、严格 OpenSpec 校验及原生/真实 proxy/角色/连续旁问 smoke 均通过。正式 home 部署备份 `portable-harness-2026-10-21T11-17-05-651Z`，受管文件无漂移，本地包所有部署 JS 与源码逐字节相同，headless 四个受管文件哈希不变；开始菜单仍指向正式安装版。未重启用户当前桌面，正常重开加载更新。

## 2026-10-21 真实审批与计划审查状态

没有改写现有状态逻辑。隔离 profile 使用真实 proxy 和 standard 子会话触发两种原生交互：向合成工作区外的指定验收文件执行 native write，产生实际沙箱审批；另一子会话在 plan mode 调用实际 `exit_plan_mode`。原生侧栏分别显示“待审批”“计划待审”，主会话协作面板显示“需要介入 2、进行中 0、已完成 0”，能打开对应决策卡片。

在 UI 拒绝一次性权限扩大后，子会话返回精确标记 `APPROVAL_DENIED_OK`；未授予 danger-full-access，目标文件不存在。确认仅要求回复标记的合成计划后，子会话返回 `PLAN_REVIEW_FLOW_OK`，计划模式退出；面板变为“需要介入 0、进行中 0、已完成 2”。这里的“已完成”表示回合结束，不宣称被拒绝的文件写入成功。

停止已空闲的合成运行时、确认其进程结束后，仅释放该进程自己的测试 lease，再启动原生 profile 复核：持久记录包含配对的 `approval/asked` 和 `approval/decided: rejected`、成功的 `exit_plan_mode` tool result、最终 `plan/mode: false` 和两条精确回复；权限仍分别为 workspace-write/read-only，拒绝的文件仍不存在。独立审计输出 `ATTENTION_CONTROLS_AUDIT_PASS`。初版 UI 驱动脚本误将 `/plan on` 的参数入队，已通过原生卡片取消该澄清回合后执行原定计划；没有把驱动脚本的观察标志当作通过证据。

截图为任务输出 `真实审批与方案审查待处理状态.png`、`审批拒绝与方案确认后状态.png`。仅操作合成会话；没有改动日常 profile 或重启用户桌面。本轮未测试权限扩大的允许路径，跨任务的全局状态分类和旧面板恢复仍未完成，因此 OpenSpec 4.1 保持未勾选。

## 2026-10-21 独立旁问与快捷键

- 完整测试及独立源码快照各 72 项通过，无跳过。覆盖子 Agent 最终工具列表清空、保留上游 assembly、异常释放 guard、快捷键依赖声明、可见视图/分屏焦点、modal 不抢占和清理。
- 原生 0.2.1-rc.2/真实 proxy `BTW_CONCURRENCY_PASS`，95 秒：旁问继承已完成回合的随机标记；主回合保持 running 且未取消，释放后执行真实 read 并回复文件 token；主模型后续请求均不含旁问标记。首次与重启后的续问均未向模型提供工具，未执行工具；旁问历史重启后仍可连续引用。为稳定制造重叠，主回合在 `agent/request` 钩子暂停；未覆盖主 provider 已流式输出或工具执行中所有时序。
- 验收先捕获了子会话仍暴露一个 `subagent` 工具的失败。原生 allowlist 只过滤继承工具，不过滤子作用域自身注册工具；最终修复在该子 Agent 的公开 `system-prompt/assemble` 扩展点返回空工具列表，同时保留执行 guard。不是仅靠 persona 声明“不用工具”。
- 实际原生前端通过 **Ctrl+Alt+Shift+B** 打开独立旁问，主草稿保持，真实回复 `GUI_SIDE_OK`。分屏子输入框发起的旁问仅出现在右侧子会话，返回 `SIDE_CHILD_DRAFT_OK`，两侧已确认的草稿保持；取消弹窗也保留草稿。原生快捷键目录显示该命令，设置弹窗中快捷键不抢占输入。
- 原 Ctrl+Alt+B 已被宿主侧栏占用；Linux Web 不接受任意组合键且注册会校验所有默认值，因此只声明本次目标 Windows 的 desktop/web 默认。前端图与服务注入显式声明 shortcuts，避免静默未激活。其他系统不宣称已有默认快捷键。
- 安全、架构及假设/组合/操作序列/滥用四角度审查未发现未解决新增问题。安装器与测试不共享部署 lease，验收与安装按同一 home 串行进行。

UI 证据为任务输出 `旁问快捷键与主草稿保留验收.png`、`分屏旁问归属与双草稿验收.png`。使用安装版原生 desktop 后端与其同源前端；未重启用户桌面，物理桌面全局按键/系统拦截未单独测试。未连接或操作 Claude。

最终源码的原生启动/角色/连续旁问/实际 proxy smoke 通过；正式 home 部署备份 `portable-harness-2026-10-21T10-19-28-624Z`，受管部署无漂移，headless 四个受管文件哈希不变，开始菜单仍指向正式安装版。未重启用户当前桌面进程，正常重开后加载更新。

## 2026-10-21 明确授权的本机会话读取

- 完整测试 70 项通过，无跳过。覆盖默认拒绝、精确调用者授权、子会话不继承、名单排除归档/空白/subagent、排序和最多 20 项、无关字段不透传、目标权限，以及读取/名单请求在途中撤销后拒绝返回；关闭再开启也不能使旧请求通过。
- 复用完整原生生命周期/真实 proxy 验收，最终 `SESSION_LIFECYCLE_PASS`，116 秒。除原有排队、停止、归档、恢复等检查外，新建另一工作区源会话，真实主 Agent 自己调用 `list_recent_sessions` 和 `read_local_session`，正确返回源会话的随机校验 token；调用记录排除 shell、文件、原生搜索和其他代理路径。源会话完整事件摘要不变，跨家族发消息仍被拒绝。
- 第二次重启原生 profile 后授权关闭；重新授权只读名单/冷历史不会激活源 Agent，源历史仍可读。授权不写入关系 domain 或用户配置，没有新增持久格式。
- 实际桌面前端的授权开关从关闭变开启；输入 `/local-history off` 后原生命令显示成功，开关同步关闭，原生回合/模型调用数保持不变。截图为任务输出 `本机会话只读授权与真实读取验收.png`，显示明确范围及先前真实读取结果。
- 安全、架构与四个对抗角度的只读复核未发现新增问题。原生 `session_query` 的同工作区规则保持原样；新工具只补显式授权后的跨工作区只读入口，没有放宽家族消息/停止规则或文件工具的既有权限。

测试只使用隔离 home 的合成会话，没有授权读取用户真实会话。其他机器、海量历史的性能和所有第三方工具的历史访问路径未全面验证。

最终原生/真实代理/角色/连续旁问 smoke 通过；已备份部署 `portable-harness-2026-10-21T09-12-19-092Z`，受管部署无漂移，headless 四个受管文件哈希不变，开始菜单仍指向安装版。没有重启当前用户桌面进程，正常重开加载新工具与命令。

## 2026-10-21 后台完成通知

- 完整测试 68 项通过，无跳过。新增首屏不重放、回合序号去重、当前主会话抑制、失败/停止/归档不冒充完成，以及全局记录按 RemoteAccess 过滤、家族读取不含全局记录的回归。
- 隔离原生桌面/真实代理：主会话发起后切到子会话，后台主会话返回 `NOTIFY_NATIVE_OK`，右下角通知出现；实际点击“查看结果”打开对应会话与真实回包。截图为任务输出 `后台真实完成通知验收.png`。
- 实际关闭通知、刷新后仍关闭；第二个后台任务真实返回 `NOTIFY_MUTED_OK` 而没有通知。重新开启后不重放旧记录，第三个真实任务完成只出现一条通知，点击打开 `NOTIFY_REENABLED_OK`。
- 独立 Windows Electron 载体沿用 sandbox/contextIsolation、关闭 Node integration，使用安全 `dsh-app` 来源和非 media 权限策略，Web Notification 实际发出 `show` 事件并关闭。首轮监听使用旧 console-message 参数而超时，修正测试器后通过，不能把首轮计为通过。该证据证明平台接收通知，不等于实测用户当前桌面的物理横幅或点击。
- 安全与架构专项静态审阅无新增问题；“全局记录”意为按权限过滤，不能将 `all:true` 误称 owner 身份校验。最终增加原生列表订阅及对称退订，保留定时器兜底。

深度审阅发现并通过 RED/GREEN 关闭三处通知问题：列表事件使进行中的 RPC 响应过期时丢弃并立即重读；权限撤销/恢复仍保留最高已见序号，避免重报；新回合同步撤销旧结果并以开始序号拦截排队的旧终态。四个对抗角度复核后未再发现新增问题。

最终通知源码固定锁隔离安装后再次实际发起后台请求，通知出现，点击进入正确会话并读到 `NOTIFY_FINAL_GUARDS_OK`；截图为 `后台完成通知最终版本验收.png`。部署期间若旧后端仍在运行，缺少新完成记录字段时暂不提醒，正常重开后加载完整新能力。

最终源码原生/真实代理/角色/连续旁问 smoke 通过；正式 home 备份部署 `portable-harness-2026-10-21T08-43-49-812Z`，受管文件无漂移，headless 四个受管文件哈希不变。已恢复的用户桌面进程保持运行，未强制重启。

测试隔离事故：开始菜单快捷方式曾指向通知测试 runtime，桌面快捷方式仍指安装目录；直接启动安装版成功，用户确认已能打开。已备份并修复开始菜单目标。测试 EXE 原先与安装版共享硬链接身份，现改为独立复制；旧准备逻辑的文件身份回归实际失败，新逻辑通过，测试副本修改不影响安装源。独立 EXE 载体启动返回 1，尚未证明其系统通知路径，因此不把先前硬链接载体的 show 事件扩大为最终独立载体或用户实际桌面的完整验收。未停止用户已经打开的 Harness。

本机 DSH 0.2.1-rc.2 主进程选定文件的离线 REA Evidence：`ev_9c3b91a605627d140b171d2ed6db1405b836d3825d89a7b6be3b352d61787928`，ASAR SHA-256 `47874618bf5b3011fcaac10cd4c85f69da333e70d4f99b921207c78d0999512a`。仅分析 `lib/main.js`，语义预算有限，其他文件不在分析范围；静态证据不等于运行时保证。没有操作 Claude。系统通知策略、所有最小化/休眠时序和跨系统尚未覆盖。

## 2026-10-21 原生并排会话

- 完整测试 63 项通过，无跳过；新增严格会话地址解析，拒绝外部 URL、路径穿越、额外路径/query 与超长身份。原有入口测试同步核对新增两个局部槽位，全局协作页仍未恢复。
- 隔离原生桌面实际从子会话的“任务协作”打开主会话右侧标签，左侧子会话保持选中。两侧原生输入分别保留 `CHILD_DRAFT_KEEP` 和父会话请求；只点击右侧发送，真实 proxy 在右侧返回 `PARENT_SPLIT_OK`，左侧草稿未提交。
- 完成后写入右侧 `PARENT_DRAFT_KEEP`，实际点击标签关闭，再重新打开，左右草稿与历史均保留；重复打开同一目标仍只有一个右侧会话标签。两侧原生只读权限/模型控件保留，未新增模型路由或后端会话。
- 安全与架构两项静态专项审阅无新增问题。实际截图为任务输出 `原生父子会话并排与独立草稿验收.png`；会话组件、引用和分栏布局均使用固定宿主公开 API。

本轮验证本机原生前端和合成会话；未验证所有窗口宽度、跨系统和任意宿主升级。后台完成通知仍是独立未完成项，OpenSpec 4.3 尚未整体勾选。

最终源码已固定锁隔离安装并实际运行前端，原生启动/角色/连续旁问/真实代理 smoke 通过；正式 home 备份部署 `portable-harness-2026-10-21T07-50-53-461Z`，部署无漂移，headless 四个受管文件哈希不变。没有停止用户当前桌面进程，正常重开加载更新。

## 2026-10-21 任务与阶段回顾

- 完整测试 62 项通过，无跳过；新增原生精确投影读取、最多 40 项/最近 3 回合、无消息投递、读取前后权限复核与迁移提示不冒充当前状态的回归。安全与架构两个专项静态审阅均无新增问题。
- 隔离原生桌面/真实 proxy 子会话调用 `todo_write`，从 1 完成/1 进行中/1 待处理开始，再实际提问。原生问题卡会替换输入区并隐藏 todo dock；新弹层读取同一原生任务投影，修补该可见性缺口。
- 实际选择 Blue 并提交后，模型将 3 项全部完成。重启隔离宿主后，“任务协作 → 任务与回顾”仍能读到完整三项及第一回合结果，未生成第二份任务数据。
- 第二次实际输入阶段请求、模型再写任务并提问；等待回答时弹层显示“需要介入 1”、已完成阶段一、进行中的阶段二和第一回合摘要。实际提交 Continue 后两项完成，弹层出现第二回合回复摘要与“需要介入 0 / 进行中 0 / 已完成 1”。
- 截图：`原生任务清单完成验收.png`、`待答期间任务与回顾验收.png`、`协作阶段完成回顾验收.png`，均为任务输出中的合成会话；滚动弹层可访问全部回顾，原生清单和对话保留。

回顾是原生每回合最多 120 字符的回复预览，不是模型另写的阶段总结或正确性证明。尚未实际触发权限/方案审批、全局注意力分组、通知和分屏，相关 OpenSpec 待办保留。

最终源码固定锁隔离安装成功，原生运行时/实际代理/角色/连续旁问 smoke 通过；正式 home 部署备份 `portable-harness-2026-10-21T07-38-28-249Z`，受管部署无漂移，headless 四个受管文件哈希不变。没有重启用户桌面进程；正常重开后加载。

## 2026-10-21 消息边界与会话生命周期

- 完整 `npm test` 61 项通过，无跳过。先复现显式消息误入当前回合、取消后陈旧输入解锁、异步解析时发送方/接收方停止或归档等竞争，再修复共享后端；独立安全和竞争审阅发现的问题均有回归。
- 最终隔离原生/真实代理 `SESSION_LIFECYCLE_PASS`，41 秒：显式消息排到下一回合且身份保留；真实子会话读取合成文件并完成，原始工具输出留在子会话，有界终态报告只回传一次。停止、归档、重启、原生用户恢复和脱离均保留历史与只读权限。
- 部分竞争通过暂停实际原生 `agent/request` 稳定复现，没有为被暂停的请求调用代理；读文件和子/父会话完成回复使用真实代理。原生 `sessionController.cancel` 验证保留队列且不唤醒任务，`stop_session` 验证清队列；没有将 API 取消测试称为点击物理桌面停止按钮。
- 实际原生前端点击归档合成父会话后，两条子会话仍可见，打开子会话后可读完成历史、返回主会话入口和原生菜单。截图为任务输出中的 `父会话归档后子会话可访问验收.png`；工作树子会话保留原生跨容器位置，未声称所有子会话聚合在父工作区。

没有修改用户真实会话或启动 Claude；这不证明所有调度竞争或所有环境均已覆盖。近期会话授权入口、任务/recap、通知和分屏等仍在 OpenSpec 待办中。

最终版本已备份部署，备份为 `portable-harness-2026-10-21T07-21-04-182Z`；受管文件无漂移，headless 的 package、patch、lock、workspace 四个文件哈希不变。没有停止用户桌面进程，正常重开加载更新。

## 2026-10-21 独立 Worktree 与整合恢复

- 最终完整新运行 `WORKTREE_DELIVERY_PASS`，406 秒，未恢复验证、未跳过模型执行。真实主会话选择两个 DeepSeek 实现者，持久回合时间证明二者重叠；各自在独立、互不包含的原生 worktree 中实际修改并提交一个源码文件。
- 原生工具的 before/after 与 shell 源码哈希记录归因于对应 writer。每份实际提交完整 patch 返回主会话，整合 commit 对应 writer 实际 patch；主会话只在 writer 完成后应用同一改动，没有凭命令字符串认定整合。
- 显式选择的忽略配置保留原文进入两个 checkout，未选中测试私有文件没有复制；源目录未提交笔记、验收和 AGENTS 按原始字节检查。主会话整合后实际运行验收，通过后测试器仅在自己的合成仓库执行 revert；源码回到基线，笔记、worker HEAD 和历史保留。
- 早期验证修正了三类证据假设：已成功重派的失败记录应保留并披露，不能要求历史尝试全部成功；Git Windows 检出可能转换换行；原生编辑结果以 LF 表示文本，不能将其哈希直接当作磁盘 CRLF 字节哈希。最后的新运行验证了完整最终逻辑，没有把先前 320 秒任务之后的 6 秒恢复检查称为完整流程耗时。
- 完整 `npm test` 58 项通过，无跳过；实际命令拒绝生产 home，并发 runner 在 profile boot 前被拒绝。新增子进程回归证明原生启动失败保留恢复指针、开始回滚后拒绝恢复重放。维护者恢复选项仅支持首次 revert 前，不实现 Git sequencer 自动修复。
- 深度审阅的四个角度及架构补查已完成，发现的恢复指针、回滚重放、源码归属与补丁审阅证据缺口均已关闭。没有新增产品 Git 服务或第三方运行依赖。
- 固定锁隔离安装后完成本机备份部署 `portable-harness-2026-10-21T06-18-09-076Z`，无受管漂移。本轮 headless 仅配置文件因同项 GLM 档位修正发生变化，package/lock/workspace 三个文件哈希不变；没有操作用户当前桌面进程。

这证明所述合成项目的自动并行、整合与撤销，不覆盖所有冲突、submodule、LFS、依赖安装和项目专用初始化流程。未启动或附加 Claude，也未使用其账号、私人会话或内部接口。

## 2026-10-21 GLM 代理能力声明

- 真实并行任务暴露 `glm-5.3-flash` 的 `medium` 请求被本机代理以 HTTP 400 拒绝，返回仅支持 `low/high/max`。旧声明错误列出了其他档位，主会话曾改为 low 重派后完成；没有删除失败历史或添加静默模型 fallback。
- desktop/headless 增强模板改为上述三个实际档位，原生恢复基线保留原样。原生模型元数据现在只返回三项；真实调用 `start` 使用 medium 在创建 Agent 和关系之前被拒绝，low 的实际模型请求返回 `GLM_LOW_OK`，请求头确认仍为 GLM low。
- headless 同项模板一致性已验证，本轮没有做新的终端交互验收。其他代理对同名模型的映射可能不同，换代理后应重新核对能力声明。

## 2026-10-21 协作待答状态

- 修正协作弹层将原生状态 Map 当对象读取的问题，优先显示待回答、审批、方案确认，保留用户停止状态；原生侧栏状态点继续由宿主管理。
- 实际 proxy 子会话调用 `ask_user_question` 后，侧栏显示“等待回答”，协作面板显示“需要介入 1 / 进行中 0 / 已完成 1”。实际选择 Blue 并提交后回到进行中，最后模型回复 `ATTENTION_ANSWERED`，面板变为“需要介入 0 / 进行中 0 / 已完成 2”。
- 完整测试 57 项通过，无跳过。真实问答与完成流转有截图；审批/方案确认优先级由原生类型核对和单元测试覆盖，本次没有制造真实权限请求或方案审批。
- 最终版本固定锁隔离安装、原生启动与真实代理 smoke 通过，OpenSpec strict 验证通过。备份部署 `portable-harness-2026-10-21T05-28-32-962Z`，本机无漂移，headless 四个受管文件哈希不变。

本增量只完成状态显示与计数；全局状态分组、任务清单、recap、通知等仍未验收，OpenSpec 对应任务不提前勾选。

## 2026-10-21 原生空闲压缩

- 完整 `npm test` 56 项通过，无跳过；先复现跨 timer 的双会话并发摘要，再以单一执行中的维护检查修复，原循环顺序推进。
- 隔离原生桌面与实际 proxy 验收通过，264 秒。402075 个估算 token 的合成历史经真实模型生成摘要、提交原生 checkpoint，原始事件前缀不变，续聊保留校验信息且未调用工具。standard/explore/planner/reviewer 各有自己的原生引擎。
- 原生设置关闭后重启保持关闭、超过测试等待期不触发；开启后临时 60 秒期限触发。测试期限只由 CLI overlay 提供，没有重写整个 profile 或将 60 秒写入持久设置。桌面实际点击、刷新保存和会话压缩提示均有截图证据。
- 慢摘要期间普通归档被活动检查拒绝；停止并归档取消对应维护，不提交摘要。代理验收脚本共用 canonical-home lease，避免不同 runner 同时打开同一个测试 home。
- 原生静态 `plugin peers check` 仍返回 1：已有 SDK/React peer 声明与宿主提供依赖的布局不一致。没有安装重复依赖或隐藏警告；固定锁安装与真实宿主 UI、服务和模型执行已通过。此项不能报告为静态全绿。
- 最终源码固定锁隔离安装和真实代理 smoke 通过后完成本机部署；备份 `portable-harness-2026-10-21T05-19-28-123Z`。部署无漂移，headless 的四个受管文件哈希不变；未停止用户当前桌面进程，正常重开后加载。

没有对用户真实历史执行测试压缩，也没有实际等待 54 分钟；默认时长由 fake clock/配置验证，真实宿主计时验证为 60 秒。SSH、Cloud、Remote Control 按用户选择暂缓；其余未完成项继续保留在 OpenSpec 清单。

## 2026-10-21 自然语言规格交付与入口清理

- `npm test` 41 项通过，无跳过；另有未启用空闲策略的 5 项独立测试通过。
- 隔离原生桌面 profile + 实际 proxy 接收自然语言请求，主会话先写 OpenSpec，再自主分派 DeepSeek standard 实现者和 fresh `gpt-6.1-sol` reviewer。源码由实现子会话修改，原验收文件摘要未变，主会话运行验收、写 acceptance 并完成任务勾选，最终 `SPEC_DELIVERY_PASS`。
- 初始测试的 600 秒期限在收尾时耗尽；恢复原持久会话后取得通过。恢复验证段为 21 秒，不能称为全流程耗时。测试窗口现为 900 秒；没有声称一次未中断的新全流程在该窗口内通过。
- 真正复现并修正了 reviewer 的工具边界：局部 linked 工具经 guard 放行，不得放入只接受全局名的 native restrict；shell、项目编辑和再分派仍受限制。
- 原生前端实际点击确认：全局侧栏只有插件/自动化等原入口，无重复协作页；会话头部任务协作仍能打开，原生 rewind 按钮保留。旧窗口恢复退役 main route 的兼容跳转尚未单独触发验证。
- 原生启动/工具/角色/连续旁问/实际代理 smoke 通过。Windows 大小写和 junction 隔离保护、验收证据单写者和失败释放锁均有测试；实际 `spec-test` 拒绝生产 home 的大小写别名后退出，未启动生产 profile。

本次验证的是指定本地 fixture，不代表已覆盖报道全部功能。空闲维护仍未挂载；状态分类、通知、分屏、多仓库环境和建议任务等继续按 OpenSpec 的未完成清单推进。没有启动或附加 Claude，也没有访问其账号、凭据或私人会话。

## 2026-10-21 OpenSpec、视口内发送与原侧栏嵌套

- 全局 OpenSpec 从 `1.3.1` 更新为固定的 `1.14.3`，用官方 `dsh`、`core` 生成 6 个未改写的技能。配置仓库初始化，桌面安装器部署同一组技能并注册原生 `customSkillDirs`。仓库外的隔离工作区通过原生 `ctx.skills` 检查全部六项，证明没有只依赖仓库自己的项目技能。
- 真实 Harness 输入框搜到 `/openspec-explore`，选择技能后发起只读版本验证；本机 proxy 的实际 Agent 执行 CLI，21 秒后返回 `OPENSPEC_DSH_OK` 和 `1.14.3`。没有初始化业务项目或改写其源码。原有工具、角色、原生 computer-use、连续旁问及真实 proxy smoke 通过。
- 原生同安全设置 WebView 回归验证区域截图：实际鼠标拖框、PNG 裁剪尺寸匹配选区、无批注文字；整张可见页仍可发送，非法裁剪被拒绝。批注发送按钮在裁切溢出内容的宿主中仍位于视口内，中心点击点未被页面或编辑器覆盖；窄面板、全屏、文字输入和草稿恢复也通过。
- 原生侧栏实际显示父行与缩进的三个子会话，ARIA 层级同步；折叠后子会话从可访问树隐藏，展开恢复，点击子行打开原生会话，原菜单仍能打开并列出重命名、归档及置顶操作。通过原生分页补齐同工作区家族，不写入会话事件、不重命名或搬移 React 节点；跨工作区或被固定的行继续保留自己的原生位置。
- 完整 `npm test` 38 项通过，无跳过；新增可迁移技能、原生 clean 清理范围、技能版本、父子排序、折叠和分页缺失检测断言。

DSH 侧栏静态核对只针对已安装 0.2.1-rc.2 的工作区组件选定文件，REA Evidence：`ev_93a25ebea5fd06e2c60e7c0417fa19b9de5beb93d9fa1d6f7d30714a059e51e6`。没有分析或连接 Claude 进程。升级 DSH 后必须重新验证这一显示适配；其他物理电脑没有实测。

## 2026-10-21 批注手势与单一主会话

- 完整测试 37 项通过。安全 Electron WebView 使用真实鼠标事件验证：不切换模式时单击吸附元素、拖动自定义范围；浮动编辑器在选区旁可见且有焦点，原生输入的文字可直接发送，含发送前最后一次输入，无需保存按钮。
- 验证窄面板、深浅文字配色、编号重开编辑、删除空白批注不影响已写内容、关闭/再开保留草稿、全屏比例、稳定 guest viewport 和编号图片附件。编辑框不再依赖底部意见栏滚动到可见位置。
- 原生 Typert RPC 验证子会话新建孙会话在创建前被拒绝；从实际子 Agent 执行 `/collaborate`，任务只进入主会话，未进入子会话。原生运行时重启后仍可读原关系和历史。
- 前端树测试覆盖当前无子任务的独立主会话仍显示在首位，已有多层关系保留、循环不导致递归失控。进度页移除第二个任务输入框，开启按钮回到主会话。
- 新版实际 proxy 验收 409 秒完成：Agent 自主创建 3 个直接子任务，选择 `gpt-6.1-sol` 和 `deepseek-v4.1-flash`，全部完成后由主会话汇总，权限继承且全局模型未变。真实前端点击“暂停新分工”再“开启协作并回主会话”，确认回原对话且没有提交新任务。

这是指定载体和隔离数据的验收，未强制重启用户当前桌面窗口。

## 2026-10-21 自动协作、界面与批注交互

- 完整 `npm test` 36 项通过，无跳过。原生运行时 RPC、权限、会话级模型路由、停止保护与重启恢复回归通过；实际加载上一提交的插件读取新版本关系数据通过，保留 Git revert 后的读取兼容。
- 在隔离 DSH_HOME 使用实际 `/collaborate`、原生 Agent 和本机 proxy，未指定人数或模型。Agent 自主分配 3 个审查子任务，选择 `gpt-6.1-sol` 与 `deepseek-v4.1-flash`，全部完成后主会话汇总，耗时 258 秒；验证实际请求模型、只读权限继承、全局默认模型未变。普通小任务仍可能直接完成，不保证每条消息都分派。
- 使用真实 Harness 前端查看实际完成的父子任务、选用模型和理由；协作进度铺满主区域并保留宽度上限，不再挤在右上角。点击“查看结果”打开原生子会话，“返回主会话”实际可用。
- 同一 Electron 安全配置下的 WebView 回归验证独立截图入口、批注可选图片、元素 CSS 证据、编号 PNG 与全屏比例。新增真实鼠标拖动 180×80 自定义区域、原生文本输入、选择后编辑器可见/聚焦、关闭隐藏全部遮罩/选框、恢复浏览器视口、重新打开保留草稿，以及发送后移除临时覆盖层。先前只有合成元素选择的测试不足以证明自由拖框和输入，这次补齐。

未操作 Claude 进程或账号。真实用户桌面窗口需要重开加载新代码；隔离测试不等于所有网站和所有电脑均通过。

## 2026-10-21 批注修复与职责分离

- 复现同桌面安全设置下首次 `capturePage` 的 `UnknownVizError`，下一次短暂等待后成功；加入仅针对临时 surface 错误的有界重试，权限拒绝不重试。
- 在 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false` 的隔离 Electron WebView 验证：元素边界吸附、CSS selector/有限计算样式、编号 PNG、附件预览、全屏比例保持和 guest CSS viewport 保持不变；结束后恢复原样式。
- 使用实际 Harness ConversationController 的 createDrafts/sendSession 发送该 PNG，真实会话显示图片附件；本机 proxy 的 deepseek-v4.1-flash 只依据附图正确回答 `REVIEW_NATIVE_OK`。没有把 mocked send 当作这项验收。
- 截图缺失不再自动退回纯文字；发送入口要求明确的文字模式选择，发送失败保留批注。
- 批注从桌面命令插件分离为单一功能包；嵌套前端仅格式化和去除未使用依赖，后端行为不变。完整测试 29 项通过；原生嵌套运行时与重启持久化回归通过。

这证明了指定载体与测试页，不代表所有动态网站、封闭 Shadow DOM、跨源 iframe 或 Canvas 内部都能按 DOM 元素选择。上轮未验证主窗相同沙箱条件，本次补齐该差异；用户真实窗口重开后的体验仍由实际使用结果校准。

## 浏览器、原生 computer-use 与嵌套会话增量验收

2026-10-20：完整 `npm test` 25 项通过，无跳过；固定锁安装、原生运行时启动及真实 proxy/连续旁问 smoke 通过。headless 受管理文件逐字节未变。

- Playwright 精确 ref 高亮与 Dashboard 交互批注实际通过；本机 proxy 能识别批注图片中的中文。
- 原生 CUA 在 Windows 上读取并操作测试窗口；自然语言任务实际只调用当前 Harness 的 runtime computer-use 技能与原生 `list_apps`，不启动 LiWork。用户也确认原桌面会话调用原生工具成功。
- 右侧内嵌页面批注的框选、编号、原会话发送、模型收件确认和原输入草稿保留实际通过。使用安装版同一 Electron 运行时的隔离 WebView 实测 capturePage、编号 PNG 和只携带自己的附件；未把用户现有桌面窗口重启作为测试前提。
- 嵌套会话通过原生 SRC/Gateway 验证独立 fresh/fork、父子/兄弟消息、终态回传去重、停止清除队列、归档防复活、脱离保留历史及重启后的关系恢复。界面创建真实子会话及家族消息均取得 proxy 预期回包。
- 同源已认证原生 connection RPC 实测成功；严格坏字段被拒绝、无 cookie 返回 401、无会话授权被 RemoteAccess 拒绝。旧 header 与迁移后 preset 不同的继承回归有单测。

限制：父子树位于专用面板及标题栏弹出面板，工作区原生列表仍是原来的平铺行；没有复制 Claude 云服务或跨机器调度；没有读取 Claude 私人会话/凭据、启动它或附加它的进程。其他系统与所有真实站点没有逐一验收。详细边界见 [嵌套会话](NESTED-SESSIONS.md) 和 [浏览器与桌面控制](BROWSER-COMPUTER-USE.md)。

2026-10-20，Windows，实际 Harness 0.2.1-rc.2。以下均已执行，不是仅审阅脚本。

- 9 项标准库单元测试通过：在原 7 项迁移验收之上，加入官方原生基线挂载范围和旧模块清理边界测试。
- 完全新建 DSH_HOME，desktop 和 headless 依赖安装成功；使用固定锁重新安装成功。
- 用 Git 重新克隆仓库到另一个带空格的目录，重新打包并安装到不同 DSH_HOME 成功。这个过程还验证了 Git 行尾规范化后的包校验和会正确重新生成，没有关闭 pnpm 的完整性校验。
- 新目录实际启动原生桌面运行时，proxy 回复标记、三个持久角色、Team/worktree/jobs 工具结构、连续两轮旁问通过。
- 已有配置重新部署后执行回滚：原 profile、锁和部署状态逐字节相同；会话和记忆的测试文件未删除或改写。
- 本机实际配置已经由同一仓库安装器接管，真实 proxy 与旁问再次通过；安装器 status 报告无本地部署漂移。
- `.local`、`build`、凭据、会话和记忆目录均不进入 Git。仓库内没有受版本控制的机器专属绝对路径。

未在第二台物理电脑或 macOS/Linux 上运行；不能把不同目录/重新克隆验证称为跨系统实机验收。初轮迁移验收时尚未推送远程，也没有复制个人数据。既有第三方类型声明保留上游格式，含一处无运行影响的尾随空白。

## 桌面命令补齐

后续已推送远程；原生基线和初始增强版本保留原标签，命令修复作为后续提交。

- 当前 11 项单元测试通过，增加精确命令优先、用户主动菜单导航优先、原生草稿类型与回退参数声明的检查。
- 使用相同安装包和 desktop profile 启动隔离运行时，对其同源前端实际点击验收：/agents 列出并选择 reviewer；/help 回车优先于模糊技能，并能将 /btw 填回输入框；/btw 实际返回独立气泡；/resume 恢复历史；/clear 保留历史并打开空白上下文；/fork 实际创建并打开分支。
- 原消息旁小按钮和新增标题栏按钮都能打开原生回退确认；/rewind @目标序号 code 实际显示“Files restored; conversation retained”，没有进入模型对话。
- 本机完整安装与真实 proxy smoke 通过；headless 的 package、patch、锁与 workspace 文件哈希均保持不变。
- 原生桌面窗口的画面抓取超时，因此没有伪称在用户当前窗口完成点击验证；没有强行中断该进程或其中的任务。当前窗口需要从菜单/托盘真正退出后重新打开来加载新模块。

## 会话内可视化与 ultracode 开关（2026-10-23）

- 完整 `npm test` 178 项通过，无跳过；新增 `test/ultracode-control-client.test.cjs`（4 项：显式记录优先、设置默认值回落、动画与 `prefers-reduced-motion`、只发 `/ultracode on|off` 并对未就绪/未匹配/失败报错）与 `test/dynamic-ui-view.test.mjs`（8 项：标题与字节数、高度夹取、片段校验、文档壳 CSP 与高度上报脚本、内容自报高度的夹取、两端夹取一致、折叠祖先按 `beforematch` 展开、按 wire 名 `render_widget` 注册 toolview）。
- 锁模板由真实安装反向生成：全新隔离 `DSH_HOME` 执行 `install --refresh-lock`，再 `harness.mjs lock --home <隔离 home>` 写出 `config/desktop.lock.yaml`；`test/portable.test.mjs` 13 项通过（含 `ULTRACODE-CONTROL_TGZ` / `DYNAMIC-UI-VIEW_TGZ` 占位符断言）。重新生成同时带入了上游传递依赖的补丁版本变化（codemirror、lezer、jose），是真实解析结果，未手工改回。
- 真实 UI（隔离 home，安装版同一 Electron 运行时，`--remote-debugging-port` + 独立 `--user-data-dir`；无模型凭据，点「稍后配置」进入工作区，全程不发起模型调用）：`conversation.input.right` 渲染出 `.uc-chip`，`role="switch"`，位置在模型选择器左侧（药丸 x=873，宽 86；模型选择器 x=972），初始 `aria-checked="false"`；点击后类名变为 `uc-chip on`、`aria-checked="true"`，计算样式 `animation-name: uc-sheen`（3.2s 渐变流光，`background-image` 为四色线性渐变，带紫色外发光），`.uc-dot` 为 `uc-pulse`（1.4s）。重启应用后冷读 `storages/session_projcache/sessions/session-*.json` 得到 `"ultracode":{"ver":1,"seq":6,"val":{"active":true}}`，说明状态来自原生 projection 而非组件内存。
- 真实会话验收（2026-10-23 重启后）：默认 `DSH_HOME`、真实模型 `deepseek-v4.1-flash`，新建会话要求模型调用 `render_widget`。7 秒完成，会话里出现 1 个 `.dyn-widget` 与 1 个 iframe：`sandbox="allow-scripts allow-forms"`、`referrerPolicy="no-referrer"`、`height:240px`、srcdoc 含 CSP 与片段内容，无错误节点（`.local/reports/widget-card-2026-10-23.png`）；ultracode 药丸同屏渲染在模型选择器左侧。
- 同次验收发现卡片默认不可见：宿主把工具调用折进「已完成，用时 7秒」与「已调用工具」两级 `hidden="until-found"`，手动展开后卡片完整显示（`.local/reports/widget-card-2026-10-23-f.png`）。随后在客户端加入自动展开：沿原生 `beforematch` 事件展开折叠祖先一次，挂载后推迟一拍再做首次尝试，避开父级 disclosure 监听尚未挂上的时序；`test/dynamic-ui-view.test.mjs` 增加对应断言（现 7 项）。重新构建、部署（备份 `backups/portable-harness-2026-10-23T06-07-49-432Z`）并重载渲染进程后复测：卡片的隐藏祖先为 0，卡片 819×264 完整显示（`.local/reports/widget-card-2026-10-23-g.png`）。未复测：历史会话里多张卡片同时加载、多次自动展开对滚动位置的影响。
- 已部署到当前 `DSH_HOME`（备份 `backups/portable-harness-2026-10-23T05-40-10-553Z`），`status` 报告无漂移。新插件与 `skills/dynamic-ui` 的改写都要从菜单真正退出 Harness 再打开才加载。
- 折叠解法改为搬出去渲染（2026-10-23 下午，取代上面的自动展开）：`tool.call.toolview` 在工具调用节点内部，展开折叠组只是让卡片跟着组一起露出来，用户仍要先展开。客户端改为在卡片旁留隐藏锚点、每 250ms 定位最外层 `hidden="until-found"` 分组，把 `.dyn-widget-host` 插到分组之后 `createPortal` 渲染。真机验收（默认 `DSH_HOME`，会话「用工具渲染Hello卡片」）：3 张卡片全部 `inHost: true`、折叠中的卡片数 0、每个 host 的前一个兄弟节点都是 `hidden="until-found"` 分组；父端 iframe 高度 224/370/374 与帧内 `document.body.scrollHeight` 224/369/373 逐张贴合，无内部滚动条（`.local/shot-widget-fold.png`）。
- 搬移过程中发现一个回归：iframe 随宿主容器变化重新挂载，`contentWindow` 换了，消息监听 effect 只依赖 `[html]` 时旧闭包把新帧上报全部按外来消息丢弃，第三张卡停在 360px 而内容 374px。改为依赖 `[html, host]` 后恢复贴合；`test/dynamic-ui-view.test.mjs` 增至 9 项（新增 `outerHidden` 取最外层折叠祖先、`requestMeasure` 发测量消息并忽略缺失的帧）。
- 会话删除 404 修复并真机验收：`Remote(...)` 的 `addInitializer` 原先传的是空函数，端点标记从未写到原型，Gateway 找不到 `deleteSession/delete`。现在收集 initializer 后手工执行（`Object.create(DeleteSession.prototype)` 作 `this`），`test/delete-session.test.mjs` 增加「原型上存在 `@deepseek-ai/dsh-typert-protocol/remote-methods` 且 `methods` 为 `['delete']`」的断言。真机点侧栏「…」→「删除会话」→确认：`/api/deleteSession/delete` 返回 200（此前 404），会话目录移入 `~/.dsh/dsh-delete-session-trash/session-118591b8-…-2026-10-23T07-01-40-427Z`。
- 同轮 `npm test` 182 项通过、`test/portable.test.mjs` 13 项通过；部署备份 `backups/portable-harness-2026-10-23T06-55-33-260Z`。`status` 随后报告 `profiles/desktop/cordis.patch.yml` 漂移，逐字段语义比较只有 `10.config.selectedDefault` 由 `standard` 变为 `ptc`，是应用内切换默认预设的运行时写入（YAML 也由模板的块式改写为流式），因此没有回写模板覆盖用户设置。
- 审查与简化轮（2026-10-23 晚）：`test/delete-session.test.mjs` 改为经 `createRequire` 从固定版本 Harness 解析 `@deepseek-ai/dsh-typert-protocol`，干净克隆里没有原生包时只跳过这一条、其余照跑（`APPDATA=/nonexistent` 实测 2 通过 1 跳过）。`idle-settings` 的三处保存逻辑合并为 `persist`，`enhancement-settings` 的 `busy` 改为布尔，`ultracode-control` 用 `defaultOn` 作选择器只比较布尔，`browser-guidance` 的系统提示提为模块级常量，`dynamic-ui-view` 的 disposer 去掉单元素数组，`delete-session` 的 `TRASH_DIR` 不再导出，并删除无人引用的 `DEFAULT_THRESHOLD_PERCENT`；行为不变，完整 `npm test` 182 项、`test/portable.test.mjs` 13 项通过。`.gitignore` 增补 `.deck/` 与 `package-lock.json`，避免把 AgentDeck 状态和本地链接副产物带进提交。
- 同轮列为「暂不做」的四项已在下一轮补齐：`dynamic-ui-view` 的折叠轮询改为 `MutationObserver`、`Remote` 装饰器垫片提取为 `@local/dsh-shared`、`delete-session` 增加服务端准入、`enhancement-settings` 的功能开关改走原生 pluginManager。见下方「设置页整合与功能开关落盘」。
- 仍未做：复用审查指出的其余重复（`sessionId` schema、volatile 读取、ultracode 判定、高度与阈值常量）都要跨插件导入私有模块或改宿主投影，按仓库规则不改；`enhancement-settings` 与原生 PluginsSettingsSection 的并行入口保留，原生组件未导出、合流属于产品结构调整。

## 设置页整合与功能开关落盘（2026-10-23 晚）

- 设置左侧导航新增原生 `settings.section`「Harness增强」（`order: 25`，owner props 带 `close`），页内为四个页签：「Harness增强」「上下文压缩」「本地环境」「后续建议」。第一个页签是本节自己的功能开关；后三个由兄弟插件注册到子插槽 `settings.enhancement.panel`（`{kind:'list', scope:'root'}`），页面按 `renderSlot(PANEL, {close}, {only: row.id})` 渲染，未访问的页签不挂载、访问后切走用 `hidden` 保留。`idle-settings`、`local-environments`、`follow-ups` 的客户端与对应测试回到面板注册，`local-environments` 仍在导航后调用 `close()` 关闭设置。
- 功能开关改走原生 `pluginManager`。真机读取 `listPlugins()` 的条目 `entryId` 带 `include:` 层前缀（实测 `include:usage-report`、`include:tool-worktree`、`include:agent-team-local`、`include:tool-agent-team-local`），客户端按补丁 id 后缀匹配、写入完整 `entryId`；条目缺失或带 `readOnlyReason` 时开关禁用。
- 写入与回滚真机验收（默认 `DSH_HOME`，测试实例 `--user-data-dir=%TEMP%\dsh-accept-2026-10-23b`，CDP 9333）：关掉「用量报告」后 UI `aria-checked="false"`、无错误节点，`profiles/desktop/cordis.patch.yml` 顶层数组末尾新增 `{ id: usage-report, disabled: true }`；再打开后该行消失、UI 恢复 `"true"`，`status` 无漂移。**核对教训**：首次用带引号的 `"id": "usage-report"` 检索，只匹配到第 234 行的块式节点，漏看末尾的流式条目，一度误判为「未持久化」——该条目实际写在补丁顶层数组，不在原插件节点内。
- 四个页签逐个点击验收：上下文压缩（阈值输入、1 个开关、还原默认）、本地环境（打开文件夹/新建环境/导出导入与已保存环境列表）、后续建议（输入框建议开关）都渲染在各自的 `role="tabpanel"` 内。
- 本轮补齐的三项：`dynamic-ui-view` 的折叠轮询改为 `MutationObserver`（`hidden` 属性 + `childList` + 子树）；`delete-session` 在搬目录前于服务端经 `workspace/session-activity` 和已归档状态复核；`@local/dsh-shared` 提供 `./session-id`、`./config`、`./remote`，由 delete-session、enhancement-settings、follow-ups、local-environments、nested-sessions 共用，`package`、bundle、provenance、锁模板与漂移检查同步。
- `test/enhancement-settings.test.cjs` 重写为 3 项：槽位与子插槽声明（`options.children` 跨 vm realm，按 JSON 归一后比较）、四个页签的选中状态与按 `only` 渲染面板、`include:` 前缀条目下的开关写入与只读禁用。完整 `npm test` 189 项、`test/portable.test.mjs` 13 项通过，无跳过。
- `build` → `plan`（96 files）→ `deploy`（备份 `backups/portable-harness-2026-10-23T10-08-05-793Z`）→ `status` 报告无漂移。真机侧栏「Harness增强」入口、四个页签与七个开关（六个功能 + ultracode 默认值）均已确认渲染。

## 会话总线 `on is not defined` 回归修复（2026-10-23 晚）

- 现象：真实会话「测试会话A」每轮都以「处理失败 / 本轮运行失败: on is not defined」结束，`turn/end` 记录 `{"kind":"error","error":{"message":"on is not defined","code":"UNKNOWN"}}`，失败回合没有任何工具调用，说明请求在系统提示组装阶段就抛错。
- 根因：`d18409c` 把功能开关迁到原生 pluginManager 时删掉了 `session-bus` 里的 `const on = () => ...`，漏删 `systemPrompt.context` 的 `text()` 中残留的 `if (!on()) return '';`。该方法在每轮组装时执行，`ReferenceError` 直接让整回合失败。
- 复现与验证：用 `git show d18409c:modules/session-bus.mjs` 取旧版模块，在 vm 沙箱里跑同一个 `apply` 与 `text()` 调用，得到 `ReferenceError: on is not defined`；删除残留行后同一调用返回 `''`。
- 回归测试：`test/session-bus.test.mjs` 新增「apply registers a prompt context that tolerates a missing agent」，mock `storage/agents/on/effect/commands/systemPrompt` 后调用 `apply` 捕获 `systemPrompt.context`，断言无 agent 与未授权 agent 都返回 `''`；旧模块跑该断言会抛错。`npm test` 190 项、`test/portable.test.mjs` 13 项通过，无跳过。
- `build` → `plan`（96 files）→ `deploy`（备份 `backups/portable-harness-2026-10-23T10-44-24-549Z`）→ `status` 报告无漂移。已开着的窗口需要用新模块：从菜单真正退出 Harness 再打开。

## 删除会话在子代理退出时反复失败修复（2026-10-23 晚）

- 现象：子代理还在运行时从侧栏「删除会话」，弹窗提示「会话仍在运行，请先停止后再删除。」；再点「删除」仍是同一提示，删不掉。
- 根因：客户端 `archiveSession(id, {stopActivity: true})` 只把会话写入归档集并派发 `workspace/session-stop`，`packages/workspace/workspace/src/index.ts` 明确写着该分支「does not wait for running work to settle」；服务端 `deleteSession/delete` 紧接着复查 `workspace/session-activity`，必然仍看到子代理，于是每次都抛同一个错。
- 修复：`plugins/delete-session/lib/index.js` 把归档检查提到最前（未归档一律拒绝，不搬目录），随后以 200ms 间隔、最多 10s 轮询活动清单，清空后才 `relocateSession`；超时抛「会话仍在停止中，请稍后重试。」。这样重试会收敛，也不会搬走仍有写入的目录。
- 回归测试：`test/delete-session.test.mjs` 的 `admissionBox` 支持按轮次变化的活动清单，并注入即时 `setTimeout` 记录等待间隔。新增两条用例——「子代理两拍后清空则搬目录成功」（断言等待 2×200ms 后搬到 `/tmp/dsh-home`）与「活动始终不降则放弃且不搬目录」（断言 50 次等待后抛错）。`npm test` 191 项、`test/portable.test.mjs` 13 项通过，无跳过。
- `build` → `plan`（96 files）→ `deploy`（备份 `backups/portable-harness-2026-10-23T11-12-11-465Z`）→ `status` 报告无漂移。已开着的窗口需从菜单真正退出 Harness 再打开。

## ultracode 策略按工具可见性注入（2026-10-23 晚）

- 现象：ultracode 策略段此前只要会话开关为开就注入。原生 ptc 预设把 `tool-workflow` 设为 disabled，explore/planner/reviewer 三个只读角色预设根本没有 delegation 组，这些会话仍会收到一段要求「实质性任务默认用原生 `workflow` 编排」的指令，而该工具对它不可见。
- 判据：策略点名了工具，所以它只在工具对该 agent 可见时才有意义。判定用 `ctx.tools.get("workflow", agent)`（`packages/core/tools/src/index.ts:1238` 的公开方法，与呈现模式无关），不按预设名维护白名单；ptc 呈现下工具仍可经 `run_code` 的 SDK 调用，所以判据是工具可达性而不是呈现方式。
- 修复：`modules/ultracode.mjs` 的 `inject` 增加 `tools`；`systemPrompt.section` 的 `text()` 在开关判定之后追加可见性判定，不可见时返回空串。开关记录、projection、`/ultracode` 命令与 ultracode-control 药丸均未改动。
- 回归测试：`test/ultracode.test.mjs` 的 fixture 增加 `tools.get` 桩与 `hasWorkflow` 参数；新增用例「the policy is withheld when the session has no workflow tool」，覆盖「默认开启且无工具」与「显式开启且无工具」两种情况。`npm test` 192 项、`test/portable.test.mjs` 13 项通过，无跳过。
- `build` → `plan`（96 files）→ `deploy`（备份 `backups/portable-harness-2026-10-23T12-20-28-496Z`）→ `status` 报告无漂移。
- 未做：没有在真实宿主里打开 ptc 或角色预设会话并抓取装配后的系统提示核对空段，结论来自单元测试与代码路径。工具名与 `tool-workflow` 的 `toolName` 配置耦合，模板目前不改该字段；若日后改名，判定会静默退化为永不注入。药丸与 `/ultracode status` 仍只显示开关状态，不区分策略是否真的注入。


## 2026-10-23 macOS Ultracode 与关联协作优先级

- 修复前增加回归用例，确认「显式关联协作仍收到默认工作流提示」及「无 workflow 工具仍仅显示已开启」两项失败。
- `nestedSessions.delegationMode` 提供只读意图；Ultracode 使用该公共接口，不读另一插件存储。自动关联提示按任务特征选工具，off 文案仅承诺禁止关联会话。`/workflow 任务` 是一次性显式选择，现有模式和权限不变。
- 全量 `npm run check`：198 测试通过、0 失败、0 跳过；使用固定版本原生依赖。安全扫描 0 high；medium 为既有测试样例。可迁移测试包含在全量回归中。
- 在独立 DSH_HOME 安装后，以安装版 Electron、真实 proxy 模型和 `workspace-write` 执行 `test-orchestration-policy.cjs`：简单算术不委派；Ultracode auto 双路审查实际启动 workflow；同时开启 collaborate 时仅创建关联子会话；显式 `/workflow` 覆盖常驻关联偏好且没有重复创建关联会话。每个审查结果都含两个实际文件的证据 ID，验收文件未改动，父会话权限未变。
- 冷启动核验 `tool-workflow/run-start`、`agent-start` 与 `run-end`，所有已启动工作流均有 completed 终态；没有把工具注册或仅发起调用计为成功。
- 保留既有并发/深度限制、单层 workflow 限制和沙箱。未对齐 Claude 的全部调度、恢复及 UI 功能；本轮验收只覆盖上述路由与结果回收场景，故障/取消边界沿用现有回归和新增命令取消用例。


## 2026-10-23 macOS PTC Ultracode 与模式可用性

- 先在隔离配置验证 PTC 能通过 run_code 调用 workflow。最终安装器从 standard 的同一能力配置派生 PTC，仅改变工具呈现；不增加权限、不替换 PTC 运行时、不调整并发或深度。
- 复现 PTC 内嵌 workflow 缺少持久运行记录：原记录器只记录直接工具调用。改为使用公开 tools.modeFor 判定 PTC 呈现，为同一原生工作流写已存在的运行/子代理事件；不检查不透明的父调用 token，也不新增必需事件类型。
- 隔离真实模型验收通过：run_code 工作区内 SDK 写入成功；切为 read-only 后同一写入被拒；workspace-write 下 Node 原生文件 API 对工作区外合成哨兵的写入被拒；取消请求未写入。哨兵验证后清理，其他验收文件保持原文。早期直接工具探针缺少原生会话轮次，其隔离目录已保留诊断，最终证据改用完整模型调度。
- PTC 四种真实模型场景通过：简单问题不委派、自动工作流、显式关联协作优先、一次性 /workflow 覆盖常驻关联偏好。检查实际模式为 ptc、Ultracode 系统提示装配、工具调用、两个文件证据 ID、工作流 completed 终态与子代理启动记录，父会话保持 workspace-write。
- 原生能力状态通过带 session 资源检查的 ultracodeState/read 提供，不写历史；查阅前后均检查权限与取消。unsupported 模式执行 /ultracode on 会拒绝，不新增开启记录。
- 隔离真实 Web UI 验证（默认开启偏好）：standard 和 PTC 为可用且 checked；切到 minimal 显示“Ultracode · 不可用”、disabled=true、checked=false；切回 PTC 恢复可用且 checked。失效的状态请求被取消，晚到响应不更新其他会话。
- 全量 npm run check：204 通过、0 失败、0 跳过，安全扫描 0 high。未以宽松沙箱代替受限模式，也未宣称所有模型和所有工作负载都会选择同一委派路径。

- 最终冷启动取得 ORCHESTRATION_COLD_PASS：PTC 的运行与子代理事件可读，工作流均为 completed；显式关联偏好在一次性 /workflow 后仍保持 linked。日常部署在这些实测通过后进行。


## 2026-10-24 工作流失败、停止、续跑闭环

- 复现旧 journal 的恢复风险：不绑定 owner/cwd/预算、损坏后转 live、后继不保留回放结果，以及有写权限的 schema 失败可能重复子代理。改为既有工作流引擎内的 v2 日志、原子活动占用与单后继声明，没有新增调度服务。
- 恢复绑定原会话、实际工作目录、权限、模型、资源预算、脚本与输入。停止/失败锁跨重启保存，用户通过既有 `/workflow resume <runId>` 恢复，或核对文件后 `/workflow new <任务>` 明确另起任务。普通“继续”不会清锁。控制命令绑定同一 delegation 作用域。
- Standard 和 PTC 均使用真实模型、workspace-write 实测：第一个计数文件写入后注入第二步开始前的受控故障；自动重新启动被拒；显式续跑只修改第二个文件。后续冷启动再回放，两文件始终为 1、1。
- 在真实子代理完成写入后丢弃 structured 结果，写入次数仍为 1，无自动 schema 重试，续跑被拒绝并要求核对文件。
- 后台子代理在写入前被挂起，通过 `/workflow stop` 请求取消并等待收尾；停止目标文件保持 0。原宿主和重启后均不能自行重启该运行，未知副作用的恢复被拒绝。
- 最终安装版本另行通过真实模型冷读回放验收；最终检查发现的 new 参数空值错误已复现并修复，最终全量 `npm run check` 为 215 通过、0 失败、0 跳过，安全扫描 0 high。
- 单元测试覆盖身份/目录/权限/模型/预算变化、并发与重复后继、损坏/旧日志、回放链、未完成子调用、清理失败保留运行占用和深度限制、控制命令授权撤销。未确认清理不报告停止完成。
- 保留旧 journal；旧 v1 缺少恢复身份，拒绝自动续跑。宿主崩溃遗留的未确认活动占用不自动清除；须核对文件及旧进程后明确重新安排任务。本轮保证的是已确认步骤不重复执行、不确定步骤拒绝自动重跑，不对任意脚本宣称跨外部系统的恰好一次副作用。

- 最终正向控制验收：Standard 与 PTC 均取得 WORKFLOW_NEW_TASK_PASS。显式 `/workflow new` 后才允许新的只读工作流，原停止任务未恢复，四个计数文件保持 1、1、1、0。

## 2026-10-24 Ultracode 自动三路选择与同文件写入验收

- 新增 `scripts/test-ultracode-routing.cjs`，通过安装器的 `ultracode-routing-test` 入口运行。隔离安装、真实桌面宿主 0.2.1-rc.2、真实 `deepseek-v4.1-flash` 模型；仅打开 Ultracode 和 collaborate auto，任务不指定委派工具，不修改运行策略或沙箱配置。
- Standard 与 PTC 各四项，共八项真实模型验收通过：小型日志旁支各派一个普通子代理；要求保留可追问调查分支时各创建两个关联会话；分阶段批量处理均选择 Workflow；同文件两项更新均由主会话串行写入，再独立复核。Standard 的同文件场景用普通子代理复核，PTC 用 Workflow 调查/复核，允许这种合理差异。
- 批量场景的两个文件各有一个写入者、一次写入；共享文件均为 `(0,0) → (1,0) → (1,1)`，所有其他字段与旁路文件保持不变。三个路由样本没有混用委派路径，未发现重复派发；检查了写入者生命周期，拒绝同文件并行写者及父子同时写入。每个写入文件均有未参与写入的子代理在最后一次写入后实际读取。
- 逐次记录实际 sandbox mode 与 workspaceRoot，均保持测试工作区内的 workspace-write 或更严边界。原生角色的权限预设名称可能是 custom，不能把该显示名称直接判成权限放宽。等待条件同时包含普通子代理、关联会话和主会话终态，避免把主会话暂时空闲当作任务完成。
- 隔离宿主完整退出后，用 `DSH_ROUTING_RECHECK` 冷读原生会话、关联关系与调用记录，八项再次通过；文件未重置、任务未重新派发。原始证据与复核结果分开保存在隔离 home，不进入 Git。
- 同一候选版本再跑 PTC 真实沙箱边界：工作区允许写、read-only 拒绝写、原始文件系统越界写被拒、已取消请求不执行，取得 PTC_SANDBOX_PASS / PTC_BOUNDARIES_PASS。最终 `npm run check` 215 通过、0 失败、0 跳过，安全扫描 0 high；portable 单独 14 项通过。
- 结论限于上述合成任务和本机模型/宿主组合，不宣称任意任务都不会发生语义重复或外部副作用。此轮只增加可重复的验收入口与记录，没有新增调度系统。

## 2026-10-24 实质性任务必须经 Workflow（历史串行方案）

- 复现依据：真实网页任务在 Ultracode 生效、工具可见时仍由主会话执行全部操作；同时发现工具提示中的 explicit-only 限制与自动编排冲突。改为统一提示与原生 tools.guard：主会话保留有限只读准备、控制和答案呈现，项目写入、shell、浏览器及委派必须交给 Workflow。PTC 使用单次 JSON 工具调用，拒绝原始文件系统代码与额外语句，不改变 sandbox policy。
- `/collaborate on` 改为选择 Workflow 内的 linked 执行者；auto 可按持续追问需求选择，off 在引擎入口拒绝 linked。linked 使用既有 SessionController 创建/等待/取消，保留历史，关闭自动父会话唤醒。没有增加调度器、队列或新持久存储。
- 现有限流器在 Ultracode 下串行执行阶段，原生 write/edit 继续使用宿主 exclusive 调度；额外只读角色不能写项目文件或共享角色记忆。清理失败立即拒绝后续阶段，保留已有恢复锁与深度保护。
- macOS、固定原生运行时 0.2.1-rc.2、真实 deepseek-v4.1-flash：Standard/PTC 的简单问答、普通执行者网页、关联执行者网页六项通过。网页样本包含给定 SO(4) 数学基线、寓言、Canvas/SVG、滑块、独立数值核对、390px 浏览器交互与控制台验收。调用记录证明主会话没有直接改文件，各写入阶段不重叠，文件哈希链连续，没有重复或无变化写入；修复仅针对实际验收发现，并串行交接。
- 关联网页在两种模式下均保留三个阶段会话；最新 PTC 复测只有一个 Workflow 和三个执行者，没有空探测运行。另行通过 auto 模式的持久调查分支选择，说明不必先手动开启 collaborate 才能选择 linked。
- 保留失败证据：自由选题的初轮网页研究在 15 分钟窗口内未完成，不计通过。早期 PTC 关联样本因笼统的格式错误提示产生了 22 次运行（其中多数为空探测，实际三个工作会话未重复写入）；修复为只编译、不执行的语法诊断、明确 JSON/括号/转义提示，并重跑通过，未放宽代码执行或文件权限。
- 两种模式的真实停止测试均在写入前取消，计数保持 0；重启后拒绝自动继续。普通 Workflow 的失败/续跑/缺失结构化结果测试也通过，计数保持 1、1、1、0；插件禁用后原生 persistence 仍能冷读父子历史。
- `mandatory-workflow-test` 支持 `DSH_TEST_PRESET`、`DSH_MANDATORY_CASE` 缩小范围；`DSH_MANDATORY_RECHECK` 只读检查原生历史和文件，不重新派发。`linked-workflow-test` 检查关联执行者停止与冷读；`workflow-recovery-test` 保留普通执行者恢复回归。测试浏览器的进程目录指向隔离证据目录，截图、会话和模型日志均不入 Git。
- 边界：实测证明这些完整网页样本的编排与文件安全，不保证任意自由研究都能在固定时间内完成。阶段串行会牺牲部分并行吞吐；跨独立用户任务、手动操作或任意后台外部程序仍不属于全局文件锁保证。
- 最终检查：`npm run check` 227 通过、0 失败、0 跳过，安全扫描 0 high；portable 单独 14 项通过。最终原生 guard 探针验证 Standard 直接写入、PTC 原始文件系统代码、只读辅助角色写入均被拒绝；原生 PTC 沙箱的工作区内写入、只读拒写、越界拒写和取消检查也通过。

## 2026-10-24 并行编排与真实执行边界修正

本节取代上一节“所有执行者不重叠”的验收标准。宿主仍为 macOS 上的 0.2.1-rc.2，真实模型为 deepseek-v4.1-flash；未放宽文件沙箱，未增加调度系统或运行依赖。

- 恢复既有并发上限 16。Standard/PTC 的独立只读执行者、独立 worktree 写入者均实际重叠运行；两个 checkout 来自同一基线，最终结果整合回交付目录并核对内容及基线。相同或包含关系的可写目录、共享浏览器的第二个占用请求在派工前拒绝，同时无关目录的写入仍完成。

最近一组双执行者探针的实际记录如下。“有效并发”是两个活动执行者时长之和除以从首个开始到最后结束的窗口，不代表服务端 GPU 利用率；整项耗时还包括主会话派发和结果收取。

| 模式 | 场景 | 整项耗时 | 实际重叠 | 有效并发 |
| --- | --- | ---: | ---: | ---: |
| Standard | 独立只读 | 9.23 秒 | 3.43 秒 | 1.78 |
| Standard | 独立 worktree 写入 | 18.97 秒 | 7.92 秒 | 1.62 |
| PTC | 独立只读 | 10.31 秒 | 4.07 秒 | 1.91 |
| PTC | 独立 worktree 写入 | 17.52 秒 | 5.99 秒 | 1.69 |

- 原生子代理的 cwd 只改变执行目录，不改变继承的沙箱根。已复现并据此拒绝伪隔离：先创建 worktree，再通过现有 fresh 关联会话以目标 cwd 创建写入者。普通临时子代理仍用于适合的任务。未走原生子会话创建边界的 provider 不宣称支持隔离。
- `/collaborate on` 下实测同一 Workflow 混用临时子代理和持久关联会话，两者并行，只有需要保留的一项成为关联会话。完成后的澄清通过既有通信接口重新读取已变更的证据，没有新建 Workflow 或额外执行者；已释放的写入授权没有恢复。
- 实际 Mac 沙箱拒绝原始 PTC、shell、Node 构建脚本及符号链接越界写入；工作区内写入正常，只读写入被拒。浏览器的服务端 unsafe 代码和自选导出路径被拒，普通浏览器操作及默认截图输出保留。
- 普通失败/停止/续跑、后台关联执行者停止、冷启动及禁用插件后的原生历史冷读均通过。并行恢复另行证明：已完成的两路写入各保持 1，续跑只新激活整合阶段。回放也有展示事件，因此按实际执行者 ID 和新工具调用判断是否重做，不能仅数 agent-start 事件。
- PTC 只读主会话实测变量计算与八次批量读取，无“六次读取”上限。workspace-write 主会话仍限于安全 JSON 传输，未宣称任意主会话代码具有等价安全能力。原生 structured_output 是结果提交能力，不是文件写入，已修正只读执行者对此工具的误拒。
- PTC Workflow 默认复用原生后台作业（包括传入 budget_ms 时），并收取 job_output；很短的合成检查仍可显式选择前台。budget_ms 检查后续派发，并不打断正在运行的子级，因此不能当作前台调用的完成时限。带预算的默认后台成功收取、取消和冷读分别实测，不靠提高 run_code 超时解决长任务。

完整网页样本仍是测试夹具，没有把四维主题或文件名放入运行规则。两种模式均自动进入 Workflow，完成数值核对、页面制作、独立滑块操作、390px 布局和最终控制台检查，并在重启后只读复核通过。Standard 的 5 次内容变更由两位实现者明确交接；PTC 的 14 次内容变更由同一实现者完成。两者哈希链连续，没有并发写入者或无变化重复写入。

以下是固定数学基线通过样本的会话记录用量，包含子执行者；不是费用报价。未返回 usage 的中断请求及后台标题生成不计入该表。

| 网页模式 | 耗时 | 模型步骤 | 非缓存输入 token | 缓存读取 token | 输出 token |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 426.0 秒 | 89 | 409,688 | 6,352,256 | 51,526 |
| PTC | 818.9 秒 | 69 | 449,778 | 4,440,448 | 136,737 |

失败和超时记录保留在隔离 home：包括早期测试直接在正式回合外调用 PTC 导致的无效测试历史、cwd-only 测试补丁覆盖浏览器配置、只读结果提交误拒，以及前台 PTC 运行触及 10 分钟传输时限。这些均未计入通过。修正测试入口、能力检查和后台选择后分别复测；停止后的重新启动请求被拒，未通过删除保护或放宽沙箱取得通过。

新增可重复入口为 workflow-parallel-test、workflow-boundaries-test、workflow-coordinator-test。并行恢复和混合会话可用 DSH_PARALLEL_RECOVERY_ONLY / DSH_PARALLEL_MIXED_ONLY 单独复测。完整检查为 236 通过、0 失败、0 跳过，安全扫描 0 high（既有测试夹具 3 medium、17 low）；Windows 未做本轮真实宿主验收。

### 补充安全与开放式样本

- 在隔离目录、两种真实模型模式中复现：Workflow 脚本可越过 node:vm，并用 Node 文件接口直接写入项目测试目录。修正为编排进程单独使用原生只读沙箱，执行者原有权限不变；相同探针在 Standard/PTC 均被实际拒绝。原生 write 工具的工作区内成功、工作区外及符号链接越界拒绝也分别实测。
- 对真实写入后丢失结构化结果的情况，故意让同一脚本再派写入者；两种模式均只激活一个写入者、计数保持 1。失败写入者的目录占用保留到该脚本收尾，无关目录不受此占用影响；清理未确认仍保留更严格的锁。
- 不设编排字符数门槛。允许简短计划，领域答案、设计与具体核验交给执行者；可按真实发现使用连续的小型 Workflow。原生角色、目录、沙箱、并发与停止策略没有放宽。完整网页验收也不再以主会话调用次数推断任务是否合理，调用数仅记录用于诊断。
- 新开放式任务不提供固定数学基线。保留的未通过记录包括：约 242 秒生成 9,845 字符的过度编排（主动停止旧候选验证）；Standard 首次编排约 75 秒、3,364 字符，但实现者单次输出达到 65,537 token 并截断，未生成网页；PTC 首次编排约 94 秒、1,841 字符，网页已落盘并增量修改，但实现者扩展自检，前台传输在约 600 秒取消，独立验收未完成。这些都不计入通过。
- 针对上述失败，执行者增加先保存可运行结果、再增量完善与交接浏览器验收的指导；PTC 后台默认不再因传入派发预算而关闭。最终开放式 Standard/PTC 均实际交付并通过独立数值、浏览器控件、390px 布局和控制台验收，冷启动再复核通过，没有重新派工。Standard 的 27 次变更、PTC 的 8 次变更各由同一写入者完成，哈希链连续，没有无变化重复写入。
- Standard 使用一个 Workflow；PTC 使用三个已完成 Workflow，准备阶段选择前台，实现与独立验收使用后台作业并收取结果。PTC 有一次启动前的调用校验修正，计入调用开销，没有增加实际写入者。PTC 最终数值复核与浏览器验收实际并行。

以下为最终开放式样本；两种模式在独立 home、目录和浏览器中同时验证，共用模型代理服务，因此耗时包含资源竞争，不作受控性能对比。“首次编排”从任务提交到首次 Workflow 调用，包括模型思考与必要准备；脚本长度仅用于诊断。

| 模式 | 首次编排 | 已启动脚本字符数 | 端到端耗时 | 模型步骤 | 工具记录 | PTC 分发记录 |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Standard | 107.2 秒 | 7,255 | 1,460.3 秒 | 127 | 156 | 0 |
| PTC | 77.2 秒 | 2,174 / 5,934 / 2,961 | 1,548.6 秒 | 133 | 126 | 357 |

| 模式 | 非缓存输入 token | 缓存读取 token | 输出 token |
| --- | ---: | ---: | ---: |
| Standard | 823,714 | 13,778,432 | 242,942 |
| PTC | 509,501 | 12,271,616 | 288,033 |

用量通过原生 tokenUsage projection 汇总父子执行者，并用冷读再次核对；包含推理输出。PTC 分发与工具记录重叠，不能相加；没有价格配置，不估算货币费用。这两个开放式样本明显耗时且用量高，功能通过不等于整体效率已经优于其他编码工具。

未通过样本的用量也保留：Standard 输出截断那轮为 25 模型步骤、24 工具记录、非缓存输入 192,169 / 缓存读取 1,582,464 / 输出 151,787 token；PTC 前台取消那轮为 110 模型步骤、104 工具记录、96 分发记录、非缓存输入 828,688 / 缓存读取 16,378,496 / 输出 250,095 token。主动中断且未返回 usage 的请求没有补猜用量。

### 编排效率复核（2026-10-24 至 2026-10-25）

定位依据真实运行记录。网页任务超过二十分钟不是单次生成慢，而是三处重复或绕行：

1. 实现者自行完成整轮浏览器验收。Standard 基线实现者 1546 秒、73 步，其中 38 次 bash 与 15 次 `read_image`；挂载浏览器因缺少 workflow 归属被拒后，它改用 shell 启动 headless Chrome 截图。无效工作约 500–800 秒。
2. PTC 主会话重复派工与轮询。基线主会话 30 步：4 次重复启动发现、2 次启动实现、多次 `job_output` 往返。另有约 82 秒消耗在首次 JSON 传输失败（未加引号的 `medium`、脚本转义错误）。
3. 大段准备结果未取全时另起恢复 Workflow，增加 58–117 秒与一次派工。

本轮改动：

- 验收归属：浏览器、截图、响应式与控制台检查只交给未参与实现的验收者；`browser:true` 只给验收者；实现者最多一次快速渲染或控制台检查，被拒绝时交回，不用 shell 启动浏览器。
- 派工纪律：每个作业启动一次并收取一次；已确定且只消费前一执行者结果的阶段，在同一脚本内 await；只在发现、失败或验收不通过改变方向时另起运行。
- 执行边界：PTC 前台调用把运行挂在原生后台作业上；等待期限到达时返回 `jobId`，运行继续，不再被 `run_code` 截止时间取消。
- 原生选项与 schema：按实际不确定性显式选择 `reasoning_effort`；`enum`/`const` 属性必须同时声明 `type`；只读执行者返回空结果时可缩小范围重试一次，可写失败仍不自动重试。
- 观察方式：验收者按区域合并同步 evaluate，动画等待必须有界，不留下永久 pending 的 Promise。
- 测试夹具：worktree 校验改用真实路径比较，消除 macOS `/var` 与 `/private/var` 的假失败。

同一开放式网页任务、真实 `deepseek-v4.1-flash`、独立 home 的实测记录：

| 构建 | Standard | PTC |
| --- | --- | --- |
| 修复前 | 超过 30 分钟超时；实现者 1546 秒 / 73 步 | 超过 30 分钟超时；主会话 30 步 |
| v2（验收归属 + 派工纪律） | 19.6 分钟通过；实现者 463 秒 / 19 步且 0 浏览器调用；验收 395 秒 / 62 步 | 26.9 分钟通过 |
| v3（同脚本串联 + 观察批处理） | 失败：验收 evaluate 返回悬空 Promise | 22.7 分钟通过；主会话 7 步 |
| v4（有界等待） | 失败：数学 worker 只有推理、无文本结果 | 主动停止（构建被 v5 取代） |
| v5（空只读结果重试） | 失败：同一无文本问题 | 取消：前台 `run_in_background:false` 被 `run_code` 截止时间中止 |
| v6（前台转后台作业） | 失败：实现者用 `python3` 改文件；复跑失败：schema 枚举缺 `type` 且 `browser:true` 给了实现者 | 失败：实现者单次写入触发 `max-tokens`；复跑同样 `max-tokens` 并超时 |
| v7（schema/browser/小基线约束） | 未完成：模型流空闲超时后重试，单步 900–2000 秒 | 未完成：同一上游超时 |
| v8（同一构建、干净 home） | 失败：设计 worker 单次约 216KB 触发 `max-tokens`；复跑在验收阶段被 30 分钟上限切断 | 失败：准备阶段 525 秒后构建被 30 分钟上限切断 |
| v9（撤销先小基线，准备只返回所需章节） | 失败：实现者单次写入触发 `max-tokens` | **25.8 分钟通过**；主会话 8 步；实现 951 秒 / 21 步；验收 360 秒 / 41 步 |
| v10（2–3 段写入） | 未完成：实现者在 `high` 下跑了 95 步 / 1116 秒，验收完成后整体被 30 分钟上限切断 | 失败：主会话脚本漏传 `args.designPrompt`，第二个准备执行者启动失败，引擎按 fail-closed 判整轮 error |

同一构建的双模式通过目前只有 v2（Standard 19.6 分钟、PTC 26.9 分钟）。v3 与 v9 各自有过单模式通过（PTC 22.7 分钟、25.8 分钟）。v4–v10 的边界与约束修复尚未取得同一构建的双模式通过。

结论：验收归属与派工开销的修复已由 v2（两种模式同一构建通过）和 v3/v9（PTC 单模式通过）实测；后续边界与约束修复尚未取得同一构建的双通过。剩余失败主要来自模型侧与协调者选择：实现者在 `high` 下迭代 95 步、单次写入触发 `max-tokens`、准备 worker 超长输出、脚本漏传 `args`，以及偶发的模型流空闲超时（`pi-ai stream idle timeout after 300000ms`）。本轮未提交、未推送、未部署；需在同一构建上取得 Standard 与 PTC 双通过后再执行。失败与超时记录全部保留，未计入通过。

### 确定性缺陷、验收边界与同构建双模式验证（2026-10-25）

先修确定性缺陷，再放宽诊断窗口：

- 脚本在首个 agent 之前抛错：引擎的失败文本现在直接说明这是本次调用的编写错误，多数是漏传 `args` 或读取了不存在的键；修正脚本或 `args` 后重跑，不要检查引擎源码。v10 PTC 的这类失败让主会话空了 49 步去看引擎实现。
- `browser_evaluate` 的悬空 Promise：Playwright 会等待页面函数返回的 Promise，原生工具没有超时，v3 因此挂到 30 分钟上限。现在在工具调用边界拒绝未加 `Promise.race` 的调用，并给出可直接照用的写法；同步读取等无等待调用不受影响。单测 `browser_evaluate cannot return an unraced promise that hangs the call` 覆盖拒绝与放行两侧。
- 验收断言改到执行边界：删除「只用原生 write/edit」这条提示词式断言，改为证明每次变更都落在该用例工作区内、冲突写入的时间窗不重叠、工作流结束后不再发生写入；shell 写入只记入 `shellWriters`。Python 或 Bash 在获准工作区内写文件不是越权，越界由 workspace-write 沙箱负责；「只能 write/edit」是另一条需要单独证明的策略，不再由提示词冒充权限。
- 诊断窗口：验收超时改为可用 `DSH_ACCEPTANCE_TIMEOUT_MS` 指定，默认仍是 30 分钟；本轮诊断按 45 分钟运行，功能与效率分开判定。

测试计数：`npm test` 共 237 个用例，179 通过，58 跳过，0 失败。跳过的 58 条全部是 `Requires the pinned Harness runtime`：探针用 `process.env.APPDATA` 定位固定版本 Harness（Windows 路径），macOS 上普通 Node 无法解析 `app.asar`。这些原生路径由真实宿主里的验收脚本覆盖，跳过项不计入通过。

两个独立 home 的插件包内容哈希一致（9 个文件，`90047e6f…`），确认为同一次构建。开放式网页任务、真实 `deepseek-v4.1-flash`：

| 模式 | 耗时 | 模型步骤 | 工具调用 | 输出 token | 非缓存输入 | 缓存读取 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Standard | 33.5 分钟 | 259 | 278 | 312,994 | 740,022 | 29,135,616 | 通过 |
| PTC | 24.1 分钟 | 103 | 95 | 251,936 | 623,537 | 7,824,384 | 通过 |

Standard 阶段：recon 296 秒、math-design 220 秒、ux-design 157 秒三路并行；实现 754 秒；验收一 363 秒；修复 48 秒；复验 329 秒。PTC 阶段：视觉草案 257 秒与数学契约 78 秒并行；实现 372 秒；验收 494 秒；修复 28 秒；复验 91 秒；交付核阅 24 秒。

- 验收归属与派工纪律都生效：Standard 实现者 0 次浏览器调用；PTC 协调者 3 次启动、6 次收取，无重复派发。PTC 的 156 次 PTC 分发属于传输层计数，与工具记录重叠，不能相加。
- Standard 的耗时集中在实现者自身：1 次 write、23 次 edit、21 次 bash（754 秒 / 62 步）。「2–3 段连贯写入」仍是提示词约束，没有变成执行边界；两轮验收是「发现问题→修复→复验」，不是重复验收。
- 与部署版（超过 30 分钟未完成）相比，两种模式都完成了；与 v2（Standard 19.6 分钟、PTC 26.9 分钟）相比，PTC 更快、Standard 更慢。差异来自模型侧的工具调用密度，同一脚本、同一约束下重复出现，不是编排重复。

机制测试在同一构建的 Standard home 上重跑（`PARALLEL_RECOVERY_PASS`、`RECOVERY_CASE_PASS`、`WORKFLOW_BOUNDARIES_PASS`）：独立只读任务的实际执行区间重叠、冲突写入被拒绝、停止后不再续写、失败与冷启动复验均通过；`WORKFLOW_BOUNDARIES_PASS` 另外证明编排进程的原生写入被拒绝，真实 Mac 上的 PTC、shell、构建工具与符号链接写入都被限制在既有沙箱内。

`test-worktree-delivery.cjs` 在同一轮先失败两次，记录保留：

- 第一次：`A worker patch was not returned to the coordinator for review`。复查父会话事件后确认补丁确实回到了协调者，但它位于 workflow 返回值里，换行是 JSON 转义后的 `\n`，而断言比对的是真实换行，属于测试用例的归一化缺陷。改为先对工具结果做 JSON 反转义再比对，断言要证明的事实（协调者拿到了补丁原文）不变。
- 第二次：`Native worktree tool was not used`。工作流日志显示协调者把建 checkout 交给了一个准备执行者，后者用 `git worktree add` 在仓库内建出 `.worktrees/area` 与 `.worktrees/temperature`，原生 `create_worktree` 一次都没调用。这属于绕开原生工作区接管（基准提交、路径登记、`enter:false` 语义），不是提示词偏好问题。

对应修复：主会话自己用 `create_worktree({enter:false})` 准备隔离 checkout 属于编排准备而非实现，已写入策略与技能；工作子级执行 `git worktree add` 现在在工具边界被拒绝，并指向原生工具。单测 `workers cannot create checkouts with git instead of the native worktree tool` 覆盖拒绝与放行两侧（`git worktree list`、普通 commit 不受影响）。该用例的重新验证结果见下方。

### 第二轮：worktree 边界修复后的同构建验证（2026-10-25）

新增的两个执行边界：脚本在首个 agent 前抛错的编写错误提示、未加 `Promise.race` 的 `browser_evaluate` 拒绝、工作子级 `git worktree add` 拒绝，都在这一轮的构建里。同一构建（`efficiency12-standard` 与 `efficiency12-ptc` 两个 home）的实测：

| 模式 | 耗时 | 模型步骤 | 工具调用 | 输出 token | 缓存读取 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Standard | 27.8 分钟 | 178 | 212 | 283,567 | 17,395,712 | 冷复验通过 |
| PTC | 31.2 分钟 | 177 | 170 | 281,288 | 16,458,240 | 现场通过 |

Standard 的现场运行在最后一条断言上被判失败：`No actual independent control interaction`。复查调用记录后确认验收者用 `browser_mouse_click_xy` 做了 4 次坐标点击，而白名单只列了 `browser_click`/`browser_press_key`/`browser_fill_form`。补上坐标点击、输入、选择与拖拽后，对同一份已完成记录做冷复验（`MANDATORY_COLD_PASS standard/web`）通过，没有重新生成页面。这是断言与实际证据不对齐，不是产品失败；记录保留。

worktree 交付用例在本轮共跑四次：两次因补丁比对的 JSON 转义缺陷失败（已修正断言，事实不变），一次因协调者让执行者用 `git worktree add` 建 checkout 失败（已由工具边界拒绝），一次因 `impl-temperature` 执行者没有提交自己的修改失败——`changed` 为空，worktree 的 HEAD 仍是基线。最后一条是执行者没做要求里的 commit，不是测试缺陷；记录保留且未计入通过。

### 最终冻结构建：双模式与机制验收（2026-10-25）

冻结源码后不再修改，两个 home 的插件包哈希一致（9 个文件，`1864ef5c…`），确认为同一次构建。

| 模式 | 耗时 | 模型步骤 | 工具调用 | 输出 token | 非缓存输入 | 缓存读取 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Standard | 18.9 分钟 | 142 | 165 | 175,421 | 459,581 | 13,556,736 | 通过 |
| PTC | 25.8 分钟 | 132 | 124 | 262,624 | 517,653 | 9,967,104 | 通过 |

Standard 阶段：ux-draft 48 秒与 math-contract 67 秒并行；实现 291 秒；首轮验收 301 秒；favicon 修复 14 秒；最终验收 143 秒。整个过程 7 次文件变更、0 次 shell 写入、只读准备两路真并行。PTC 阶段：数学方案 143 秒与交互草案 124 秒并行；实现 516 秒；独立验收 353 秒；修复 26 秒；复验 177 秒；11 次变更。

同一构建上的失败记录保留：Standard 的第一次运行 6.1 分钟后在协调者脚本里断裂——提示词的模板字符串中出现反引号，模板提前闭合，首个 agent 启动前抛 `TypeError`；PTC 首次即通过。修复后 Standard 以 18.9 分钟通过，为目前最快的一次，也快于 v2 的 19.6 分钟。

同一冻结构建上的机制测试四组通过：`WORKFLOW_PARALLEL_PASS`（Standard 与 PTC 的独立只读区间真实重叠、冲突写入被拒绝、并行写入重放不产生新执行）、`WORKFLOW_RECOVERY_PASS`（失败、停止、续跑与冷启动复验，计数器 1,1,0）、`WORKFLOW_BOUNDARIES_PASS`（编排进程原生写入被拒绝，真实 Mac 上的 PTC、shell、构建工具与符号链接写入都被限制在既有沙箱内）、`WORKFLOW_COORDINATOR_PASS`（PTC 只读计算与八次批量调用；workspace-write 的传输限制仍然明示）。

`test-worktree-delivery.cjs` 在冻结构建上先失败于 `A non-writer directly edited implementation sources`，逐条定位后确认是夹具的四处置信方式与强制编排的执行模型不一致，全部按「证明同一事实、不放宽断言」修正后通过（`WORKTREE_DELIVERY_PASS`，两个写入者，最大并发 2，505 秒）：

- 写入者识别本身是好的：两个 worktree 会话都被识别为写入者，各自的写在各自 checkout 内。
- 路径归一化取错了根：worktree 位于项目内，从项目根算相对路径得到 `.agents/worktrees/impl-area/src/area.mjs`，与交付 checkout 的 `src/area.mjs` 永远不等。改为取最深匹配根后，整合写入能对上写入者的原始补丁（`98b9ea97→93304735`、`7f6ab2d0→604ffc5e`）。
- 整合由委派执行者完成：强制 Workflow 下主会话不能直接写，非写入者的改动只有在「同一文件、与写入者完全相同的 before/after、且发生在其后」时才算整合，其余仍判失败。
- 集成验收：原断言要求父会话自己执行 `node acceptance.mjs`；现在要求整合完成后存在一次对原样 `acceptance.mjs` 的执行，由谁执行不再决定结果。
- 补丁回报与交互白名单的两处归一化缺陷已在上一节记录。

之前记录的「`links` 为空」是误判，已删除：关联会话确实存在，失败来自路径比较。

### Ultracode 原子化与小任务 2×2 消融（2026-10-25）

起因是同一任务的两次真实运行：`/ultracode on` + `/collaborate off` 在 20.1 分钟后以确定性死锁结束——脚本把两个可写执行者派进同一目录，第二个在派发前被 `RESOURCE_CONFLICT` 拒绝，`failedCalls>0` 把整轮判成 error，`stopOwner()` 锁住会话，而协调者白名单里写的是 `ask_user`（实际工具名 `ask_user_question`），连提问都被拒，只能人工 `/workflow resume`；该轮交付为 0。另一组 `/ultracode off` + `/collaborate on` 在 45 分钟上限被切断，但已落盘 85,859 B 页面。据此把 Ultracode 拆成三个默认关闭的原子开关，并把执行边界从开关里解耦：

- 「强制工作流编排」（原 `ultracodeDefault`）：策略段与 `requiresWorkflow`，会话内可用 `/ultracode on|off` 覆盖。
- 「协调者只读与工具白名单」（`ultracodeCoordinatorLock`）：白名单、单条 JSON 信封、`create_worktree` 只允许 `enter:false`；关闭后主会话可以自己写文件，策略段也不再声称传输受限。
- 「默认使用关联执行者」（`ultracodeLinkedWorkerDefault`）：`workflow-ptc` 的 worker 默认值，仅在 Ultracode 生效且 `/collaborate` 未显式 `off|worker` 时起作用。
- 执行边界不再依赖开关：已准入执行者的沙箱漂移、浏览器服务端代码与自定义导出路径、未加 `Promise.race` 的 `browser_evaluate`，对任何子代理都拒绝（`browser_evaluate cannot…`、`execution boundaries survive with Ultracode off` 覆盖）。
- composer 药丸 `plugins/ultracode-control` 从桌面 bundle 列表移除，不再加载；`/ultracode` 命令与 `ultracodeState/read` 保留。模板三项默认值全部改为 `false`。
- 协调者白名单补上实际工具名 `ask_user_question`（原先只有旧名 `ask_user`）；锁开启时不会再出现「派发失败 → 会话锁 → 连提问都被拒」的死锁尾巴。

消融条件：同一冻结构建、真实 `deepseek-v4.1-flash`、四个独立 home、同一任务文本与同一客观验收（`node --test` 全过、CLI 对 `1h30m+45s` 输出 `5445` 秒）。任务为三文件的零依赖时长解析器 CLI。

| 组 | 开关 | 耗时 | 模型步骤 | 工具调用 | 输出 token | 非缓存输入 | 缓存读取 | workflow / 关联会话 | 测试 | 结果 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| S | 全关 | 1.0 分钟 | 8 | 7 | 8,211 | 26,079 | 534,656 | 0 / 0 | 16 通过 | 通过 |
| U | 仅强制编排 | 1.8 分钟 | 16 | 17 | 14,418 | 67,300 | 1,048,448 | 1 / 0 | 16 通过 | 通过 |
| C | 仅 collaborate on | 1.6 分钟 | 12 | 11 | 14,722 | 28,262 | 885,248 | 0 / 0 | 13 通过 | 通过 |
| UC | 两者都开 | 4.7 分钟 | 30 | 33 | 33,232 | 203,803 | 2,044,032 | 1 / 2 | 10 通过 | 通过 |

- 四组交付等价：CLI 输出一致、测试全过，S/U 各 16 例、C 13 例、UC 10 例。
- 小任务上强制编排是纯开销：U 相对 S 是 1.8 倍时间、1.75 倍输出、2.6 倍非缓存输入，质量无差异。
- 两者叠加是超加性开销：UC 相对 S 是 4.7 倍时间、4 倍输出、7.8 倍非缓存输入；两个阶段（实现 79 秒、独立验收 154 秒）里验收占 66%。
- C 没有创建关联会话：`/collaborate on` 是偏好而非强制，小任务直接做完是合理选择；UC 则实际创建了两个关联执行者，说明当前构建下「Ultracode + collaborate on」确实能落到 linked，早先「很难触发」的体感主要来自模板默认开着 Ultracode、而药丸与默认值又让人以为已经关了。
- 这是每臂一次样本，不作统计显著性结论；方向与 4D 网页任务那次（Standard 18.9 分钟通过 / PTC 25.8 分钟通过 / ultracode 死锁）一致。

### 宿主升级 0.2.1-rc.2 → 0.2.1-rc.3（2026-10-25）

应用自动更新把桌面运行时换成了 rc.3。rc.3 对插件 peer 版本做了硬校验：任何 `peerDependencies` 仍写死 `@deepseek-ai/dsh-*: 0.2.1-rc.2` 的插件都会被拒绝加载，不是警告。升级后第一次 `smoke` 直接失败：`workflow-ptc` 与 `tool-workflow` 被禁用后 `workflow-command` 报 `waiting for workflowEngine`，整个 profile 起不来。第三方 `@michengai/dsh-btw`、`dsh-code-review`、`dsh-skills-manager` 与 `@dsh-external/dsh-memory` 同样被跳过。

rc.3 相对 rc.2 的实际内容差异（逐包哈希比对，排除 `package.json`）：

- 新增 `@deepseek-ai/dsh-client-ui-entry-customization`，由 `dsh-web-app` 的 `cordis.patch.yml` 默认加载：左侧栏、会话 View 页签、右侧栏指引三处各自的 More 菜单，提供「浏览其他插件」与「用 Creator 预设起草插件」。
- `dsh-client-ui-conversation`：View 页签支持固定/取消固定与 More 菜单，新增槽位 `conversation.session.header.views.actions`；`whenDraftExists: replace|append|keep`；提交事件新增 `newSession` 与 `agentPreset`。
- `dsh-client-ui-sidebar`：新增槽位 `sidebar.panellist.actions` 与侧栏菜单埋点；`dsh-client-ui-workspace` 仅草稿处理相关改动。
- `dsh-client-ui-primitives`：Tooltip 位置 API 与 Menu 类型。
- `dsh-client-ui-agent-preset`、`dsh-client-ui-plugin-manager`：客户端交互调整。
- 其余 `dsh-session`、`dsh-typert-protocol`、`dsh-tools`、`dsh-llm`、`dsh-workflow`、`dsh-workflow-ptc`、`dsh-tool-workflow`、`dsh-compaction-basic`、`dsh-tool-ask-user` 等 27 个本仓库声明过的 peer 包内容逐字节一致，只有版本号变化。

适配改动：

- 本地插件与本地工作流包的 peer 从精确 `0.2.1-rc.2` 放宽为 `0.2.1-rc.2 || 0.2.1-rc.3`（7 个包、37 处）；`plugins/btw` 的 5 条范围追加 rc.3。
- `provenance.runtime` 升到 `0.2.1-rc.3`；全局 CLI `@deepseek-ai/dsh` 从 rc.2 升到 rc.3（安装器会同时校验桌面与全局运行时）。
- 模板依赖 `dsh-computer-use`、`dsh-experimental-computer-use-cua-driver-native`、`dsh-hook-protocol`、`dsh-hooks-claude-code` 升到 rc.3（内容一致）；第三方 `@michengai/dsh-code-review` 1.0.1→1.0.3、`@michengai/dsh-skills-manager` 1.2.8→1.2.19（新版本 peer 为 `>=0.2.0-rc.1 <0.3.0-0`）。
- `install --refresh-lock` 重新解析并写回 `config/desktop.lock.yaml`、`config/headless.lock.yaml`。
- `test/browser.test.mjs` 不再写死运行时版本，改为与 `provenance.runtime` 比对。

验收：`npm test` 242 项、184 通过、58 跳过、0 失败；`status` 无漂移；`smoke` 取得 `PORTABLE_SMOKE_PASS`，启动日志不再出现任何 `skipping profile bundle ... incompatible`。客户端槽位逐个核对仍在 rc.3 中：`conversation.input.right`、`conversation.input.dock`、`conversation.chat.commandview`、`conversation.session.header.actions`、`sidebar.footer.action`、`sidebar.workspaces.session.menu.item`、`sidebar.right.pane.tab`、`shell.overlay`、`tool.call.toolview`、`settings.section`、`settings.enhancement.panel`；`desktop-commands` 使用的 `clearPreviousDraft` 语义未变。

## rc.3 加载恢复与可选增强降级（2026-10-25）

- 复现：升级宿主后，本地包的 rc.2 peer 范围被原生兼容检查拒绝，workflow-command 等待 workflowEngine，导致 Standard/PTC 无法新建会话。
- 修复：采用 rc.3 依赖及明确兼容范围；Workflow 工具适配器和空闲整理适配器通过原生生命周期按需绑定可选服务。命令缺引擎时明确拒绝，不派发任务、不绕过权限和停止锁。
- 原生 rc.3 隔离验收：Standard、PTC、explore、planner、reviewer 全部加载；Workflow 工具及关联会话工具可见，命令可用。关联会话、记忆写策略、本地环境、follow-ups 服务存在。
- 故障注入：只在隔离安装把 Workflow 引擎 peer 改为不兼容并关闭空闲整理服务；原生兼容检查保持生效，五个预设仍加载，Workflow 工具不暴露、命令明确拒绝。之后恢复隔离包。
- 未豁免发布时间保护。候选 code-review 1.0.3 / skills-manager 1.2.19 被 minimumReleaseAge 拒绝，改用明确兼容 rc.3 且满足门槛的 1.0.2 / 1.2.16，重新生成锁文件。
- 可复用无模型请求验收脚本：scripts/test-preset-loading.cjs，要求隔离 DSH_HOME 和 DSH_NATIVE_ROOT；不将加载通过当成真实模型长任务通过。
- 最终回归：npm test 187通过、0失败、58项依赖特定环境而跳过；portable 14/14；安全扫描0 high。日常部署完成并保留安装器备份，重开后插件页无此前兼容异常，Standard新建和PTC切换正常。此次不包含真实模型长任务性能验收。

## 日常精简 PTC 与浏览器隔离（2026-10-26）

- desktop 默认原生 PTC＋Playwright MCP；完整增强单独部署为 enhanced，保留旧日志、停止锁、恢复命令与插件。未新增调度系统。
- 原生 MCP 代理作用域承载独立连接和浏览器上下文，默认输出目录按代理标识隔离；拒绝 unsafe、提权与自定义导出路径。停止/错误先封闭该 owner 的入口，再等待原生连接清理；未知清理结果不自动重启。
- Flash/Medium 真实模型：Standard＋两个 PTC 并发打开不同页面后快照各自不串页；实际原生子代理导航后父会话页面不变；截图自定义路径被拒绝；等待工具执行中取消 PTC 后其浏览器工具移除，其他 owner 保持可用。全部经正常会话回合执行。
- 早期程序化夹具在回合外直接调用 PTC，产生原生格式校验失败；该失败仅在隔离目录保留，未作为通过证据。改成真实模型回合后，历史冷读无代理激活、回合均闭合。
- enhanced 原生装配：Standard/PTC/explore/planner/reviewer 全部加载，关联会话、记忆写策略、本地环境、follow-ups 与 Workflow 命令可用。
- 隔离演练：完整配置→精简配置→rollback，原 profile manifest 恢复，27 个历史/记忆文件哈希不变，status 无漂移，恢复后的历史可冷读。
- npm test：190通过、0失败、58项因特定环境跳过；portable＋daily 定向17通过。安全扫描0 high。未用本次短验证声称网页长任务有确定百分比提速。
- 日常桌面首次重开暴露原生引导标记缺失：补回已配置API接入、语言和主题的原生UI配置；未引入额外能力。定向回归检查step=done，部署后需再核对新会话默认PTC。

## 浏览器复验与嵌套会话入口（2026-10-26）

- 修复普通 agent/disposed 被当作永久停止的问题：按实例代际清理，正常完成/释放后可在同一会话复验；旧实例迟到清理不关闭新连接。明确停止、错误/中断与清理失败保持锁定；使用原生可忽略插件记录持久化，执行入口拒绝 shell/PTC 及新增委派绕行。
- 真实 Flash/Medium：Team 队员正常完成后复用同一 session 再导航成功；嵌套会话 on 实际只创建一个关联会话，并在正常完成后向该会话再次复验成功。off 保留已有历史、auto 为新任务默认；独立浏览器互不串页；停止后原始 PTC 文件写入尝试被实际拒绝。
- 模型说明中提到另一页面导致早期夹具误判，已改为核对成功工具结果，不把模型说明文字当作浏览器状态；测试共同禁用自动记忆注入/总结以免污染。早期夹具失败未作为通过依据，实际会话记录保留在本机。
- 原生冷读20个会话，回合均闭合；卸载增强插件的纯原生 profile 同样冷读通过；冷重开曾发现停止记录重入追加被拒绝，已改为原生终态投影并延后追加清理标记，修复后的冷重开已通过，已停止的会话没有重建浏览器。
- 后台29项嵌套会话测试实际运行通过（无跳过）；全仓npm test为193通过/0失败/58环境相关跳过。UI单测覆盖“嵌套会话”auto/on/off、命令仍为/collaborate、拒绝时不乐观更新、旧轮询不覆盖已确认的新状态。
- 新增分工策略复用现有委派服务：on 阻止新Team/subagent绕过，auto/off保留普通执行路径，已有消息/结果收取保留；没有新调度器。日常 profile 仅增补已有嵌套会话与shared依赖，不恢复完整增强。
- 解锁后完成真实桌面验收：模型选择器左侧显示“嵌套会话”，初始auto，auto→on→off→auto逐项切换成功并恢复auto；没有发送模型任务或改写草稿。

## 嵌套会话动效样式（2026-10-26）

- Composer控件使用双星SVG与状态胶囊：auto轻流光、on紫蓝渐变光晕、off静止；保留原生select的键盘/屏幕阅读器交互及三档命令行为。
- 动效仅CSS，没有增加后台请求、计时器或模型调用；prefers-reduced-motion时关闭动画与过渡。
- 交互回归与portable检查通过；全仓193通过/0失败/58环境相关跳过。

## 日常管理入口恢复（2026-10-26）

- 精简入口保留固定版本 dshmarket 与 enhancement-settings 管理组件，不恢复 Team、自动记忆或 Ultracode 执行模块。缺失功能明确标注并禁用开关；缺失策略时 Ultracode 开关显示关闭。
- 隔离 DSH_HOME 安装通过；原生 PTC agent 的逻辑工具目录及系统提示段名称与恢复前完全一致。本次无新增模型调用，不据此声称长期性能零开销。
- portable及管理页定向18通过；全仓194通过、0失败、58环境相关跳过。日常锁文件仅10项依赖；完整增强保留原有锁定依赖。
- 部署预览104个受管文件，部署保留安装器备份，status无漂移。真实rc.3桌面重开后确认「设置 → Harness增强」及「插件市场」均可打开；市场目录成功加载，并通过其原生「显示」操作恢复侧栏快捷入口。未安装新市场插件或启用完整执行功能，嵌套会话仍为auto。
