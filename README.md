# DeepSeek Harness 可迁移配置

本机调校配置的 Git 源仓库，固定匹配 DeepSeek Harness **0.2.1-rc.3**。包含持久角色和独立记忆、Team 模型与 worktree 路由、旁问连续历史和后台转任务、文件独立回退、定向摘要，以及原有插件筛选和代理配置。

源码与模板没有机器绝对路径。安装器在目标电脑解析用户目录、Node 路径和运行时位置，生成本机实际配置。**生成的配置不提交到这个仓库**。

已接入官方 **OpenSpec 1.14.3** 的 DSH 技能；换电脑先安装固定版本 CLI，再运行本仓库安装器。业务项目的规格保存在该项目自己的 `openspec/`，使用方式与更新、回滚边界见 [OpenSpec 集成](docs/OPENSPEC.md)。

需要避免任务进入长期记忆时，直接说 **“本任务不写记忆”** 或 **“不要写入长期记忆”**。插件会阻止当前会话及其嵌套会话的自动摘要和记忆写工具；只读查询仍可用，普通新会话照常使用记忆。持续范围与验收方法见 [会话记忆写入策略](docs/MEMORY-WRITE-POLICY.md)。

## 两层历史与快速恢复

远程首次历史只有两个提交：`native-clean` 是官方原生安装基线，`tuned` 在其上加入本次增强。基线只有官方 base/web-app/headless bundle 和必要的 proxy 配置，没有第三方插件、本地 agent 补丁或外部 Hooks。凭据和历史数据始终保留在本机。

先完全退出 Harness。无需修改 Git 历史即可恢复干净基线：

```powershell
rtk proxy node scripts/harness.mjs clean
```

此命令使用始终保留的 `presets/native/`，卸载本仓库的增强依赖、清理旧受管理模块，并停用本仓库管理的全局外部 Hook 挂载；不会删除实际会话、记忆、快照或 worktree。原有全局 Hook 配置会备份；Orca 等外部应用以后若重写它，`status` 会报告漂移。

若希望同时通过 Git 记录恢复操作：

```powershell
rtk git revert --no-commit native-clean..HEAD
rtk git commit -m "Restore native Harness configuration"
rtk proxy node scripts/harness.mjs install
```

最后一条命令才会改变本机部署。`git revert` 后安装器仍然存在，默认配置变回原生基线；已经部署的旧增强模块也会清理。区间写法会连同后续命令修复一起撤销；仅撤销最初的 tuned 提交可能与后续改动冲突。重新部署当前 Git 配置用 `install`；仅撤销最近一次部署用 `rollback`，三者含义不同。

桌面 `/agents`、`/clear`、`/resume`、`/fork`、`/help` 以及常显 rewind 按钮的说明见 [桌面命令](docs/DESKTOP-COMMANDS.md)。安装后必须从菜单/托盘真正退出应用再重开，关闭窗口可能只是隐藏到后台。

可见浏览器、目标高亮、交互式批注和 Windows computer-use 的操作与验收边界见 [浏览器与桌面控制](docs/BROWSER-COMPUTER-USE.md)。

内置浏览器有独立的 **截图** 和 **批注** 入口：截图不必填写意见；批注支持元素吸附、CSS 定位和可选的编号图片。可选后续任务支持确认后独立启动或在当前会话执行，详见 [后续建议](docs/FOLLOW-UPS.md)。本机功能的逐项结果和边界见 [嵌套会话验收](docs/NESTED-ACCEPTANCE.md)。职责与依赖回查见 [代码结构](docs/CODE-STRUCTURE.md)；后续改动遵循仓库根目录 `AGENTS.md`。工作流、会话间消息、审查、安全、浏览器、用量成本、消息内文件路径，以及 Claude 指令/记忆注入，见 [六项 Agent 能力增强](docs/AGENT-ENHANCEMENTS.md)；与 Claude Code 的逐项能力对照见 [Agent 能力对照](docs/AGENT-COMPARISON.md)；技能与部署环境的对齐清单见 [技能与部署环境对齐](docs/SKILLS-ALIGNMENT.md)。

在原对话输入 **/collaborate 任务内容** 即可发起协作；也可直接说 **“先用 OpenSpec 写 spec，再自动分工实现、独立审查和验收，需求是……”**。主 Agent 自己选择数量和模型，不要求手工切阶段命令。子会话需要更多分工时请求主会话创建同级任务。左侧会话树展示层级，标题栏 **任务协作** 查看模型、结果和停止操作，重复的全局进度入口已移除。详见 [嵌套会话](docs/NESTED-SESSIONS.md) 和 [规格交付](docs/OPENSPEC.md)。

并行写代码使用原生 worktree 隔离，主会话审阅并整合后验收；只带入明确选中的忽略配置，保留源目录未提交修改。目录切换、分支保留与撤销边界见 [并行写入与整合](docs/WORKTREE-DELIVERY.md)。

侧栏底部 **本地环境** 或 **设置 → 本地环境** 可打开最近文件夹、保存多仓库配置，选择当前目录或独立 worktree，并配置本机变量。导出定义不带绝对路径和变量值，其他电脑导入后重新绑定目录即可。启动会打开新会话，**返回原会话** 可继续启动前的草稿。详见 [本地环境](docs/local-environment-execution.md)。

仅在完整 enhanced 配置中，长会话默认在空闲约 54 分钟、估算上下文达到 20 万 token 后使用原生引擎生成摘要，保留原始记录。**设置 → Harness增强** 集中了上下文压缩、本地环境、后续建议三个分页和各本地功能的启用开关；**上下文压缩** 页可即时关闭，也可修改触发百分比（默认 80%，可还原默认）。会话内 `/ultracode on|off` 切换动态编排：开启后实质性任务默认用原生 workflow 展开。**设置 → Harness增强 → Ultracode** 是三个默认关闭的原子开关：强制工作流编排、协调者只读与工具白名单、默认使用关联执行者；输入框的 ultracode 药丸已移除，设置页是唯一入口。模型画的交互 UI 以 `render_widget` 卡片内嵌在会话里，不再生成 `.html` 文件交付。停止与归档保护、代理缓存的费用边界和真实验收见 [空闲压缩](docs/IDLE-COMPACTION.md)。

旧 `liangshen` preset 已移除。升级前先完全退出 Harness，再迁移旧会话；安装器发现仍有会话绑定旧 preset 时会拒绝覆盖配置：

```powershell
rtk proxy node scripts/harness.mjs migrate-liangshen --dry-run
rtk proxy node scripts/harness.mjs migrate-liangshen
rtk proxy node scripts/harness.mjs install
```

迁移器使用原生存储接口取得全部目标会话的独占写入锁，先完整备份到本机 `DSH_HOME/backups/preset-migration-*`，再为每个会话追加一条 `agent-preset/selected` 记录指向 `standard`。会话 ID、创建信息和原有历史事件保持不变，迁移后逐项校验历史一致；重复运行不会重复追加。旧创建信息中的名称作为历史事实保留，不再需要注册同名 preset。备份和迁移清单不会上传 Git。

## 日常默认：精简 PTC

常规安装现在把桌面入口设为**原生 PTC＋每个执行者独立的浏览器工具＋按需嵌套会话与内联动态卡片**，保留插件市场与「设置 → Harness增强」管理入口，以及截图/批注、路径预览、Rewind、桌面快捷命令和可恢复会话删除。管理页默认开启 Git worktree、会话总线、Claude 上下文、用量报告，团队协作和浏览器与桌面指引默认关闭；未安装的 Ultracode 策略仍禁用开关；上文的完整协作、记忆、Ultracode 等能力在 `enhanced` profile 中提供，显式运行 `dsh --profile enhanced` 时才加载。旧工作流恢复、停止保护和日志不会删除，安装器仍先备份并支持回滚。详见 [日常精简 PTC](docs/DAILY-PTC.md)。

## 新电脑使用

本文命令使用 RTK；新机器先按 [RTK 工具与参考技能安装](docs/SKILLS-ALIGNMENT.md#222-rtk-工具与参考技能安装) 检查或安装官方 [rtk-ai/rtk](https://github.com/rtk-ai/rtk)。安装 RTK CLI 与部署 `rtk-reference` 技能是两件事。Windows 用户拉取后先运行 `node scripts/check-rtk.mjs`，检查真实exe、PowerShell及带空格路径；步骤和实机验证边界见[Windows RTK 自检](docs/SKILLS-ALIGNMENT.md#223-windows-拉取后自检)。

先安装匹配版本的 DeepSeek Harness 桌面程序、Node.js 22.19+（22 系列）或 24+，以及所选浏览器。全局 CLI 的原生依赖闭包必须与桌面版本一致：

```powershell
rtk npm install --global @deepseek-ai/dsh@0.2.1-rc.3
```

克隆本仓库后进入目录。将 `config/local.example.json` 复制为 `.local/settings.json`，填写自己的 proxy 地址、默认模型及权限预设；`.local` 已被 Git 忽略。也可以通过 `OPENAI_BASE_URL` 覆盖 proxy 地址。默认模型必须存在于 `config/desktop.patch.json` 的模型列表。

API key 使用目标电脑的 `OPENAI_API_KEY` 或 Harness 自己的凭据配置，**不复制原电脑的凭据文件，不写入受版本控制的 JSON**。可迁移配置示例默认 `workspace-write`；本机被忽略的设置保留了原来的 `danger-full-access`。全局 AGENTS 和两个 profile 都由安装器管理，安装前自动备份已有文件。

```powershell
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
rtk proxy node scripts/harness.mjs install
rtk proxy node scripts/harness.mjs status
```

这些命令不要求先运行 npm install；管理脚本只用 Node 标准库。构建插件时调用 Node 安装自带的 npm，包安装使用 Harness 自己的插件管理器和已经固定的 pnpm 锁。

完成后完全退出并重新打开 Harness，再创建新会话。安装器不关闭你的应用、不改写已有会话或记忆。

本次验证了 Windows 桌面版和带空格的迁移目录。其他安装位置可设置本机环境变量 `DSH_APP_DIR`，或同时设置 `DSH_EXECUTABLE`、`DSH_CLI_JS`；自定义 Node 安装可设置 `NPM_CLI_JS`。这些都是目标电脑的环境变量，不能把其展开后的值提交到仓库。macOS/Linux 未做实机验收，不承诺即装即用。

## 如何维护

Ponytail 已随仓库部署为 DSH 技能，用于减少过度设计并优先复用原生能力；官方仓库是 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)。安装路径、使用方式和更新边界见 [Ponytail 安装与使用](docs/SKILLS-ALIGNMENT.md#221-ponytail-安装与使用)。

Ponytail、`rtk-reference` 及通用/OpenSpec技能已恢复到日常入口的受管按需目录；技能正文不自动注入每轮；RTK另有简短的常驻命令规则，Standard/PTC默认用于支持的Shell命令。部署前要求PATH可找到RTK，缺失时在写配置前报错，安装方法见上面的RTK章节。编排专用技能仍只在enhanced提供。

| 内容 | 版本控制位置 |
|---|---|
| 原生能力补丁与浏览器操作指引 | `modules/` |
| DSH 专用技能 | `skills/<名称>/SKILL.md` 及同目录的 `.mjs`/`.md` 等资源；安装器自动发现，无需登记 |
| 技能部署 | `skills/` 由 `scripts/harness.mjs install` 整棵复制到 DSH 的 `agent-capabilities/skills/`，不写入 agent 全局目录；清单与附录见 `docs/SKILLS-ALIGNMENT.md` |
| 记忆、BTW、Rewind 本地包及原浏览器资源 | `plugins/` |
| profile 插件、模型、权限、记忆参数 | `config/*.json` |
| 可独立恢复的官方原生基线 | `presets/native/` |
| 含 JS 表达式的原生配置 | JSON 内显式 `$js` 节点，安装时生成 YAML 的 `!!js` 标签 |
| 精确依赖锁 | `config/desktop.lock.yaml`、`config/headless.lock.yaml` |
| 全局工作规则 | `config/AGENTS.md` |
| 安装、状态、回滚、重新打包 | `scripts/harness.mjs` |
| 来源与许可证 | `provenance.json`、`licenses/`、各插件 LICENSE |
| 本机 proxy 与偏好 | `.local/settings.json`，不入 Git |
| 包、测试日志 | `build/`、`.local/`，不入 Git |

优先编辑仓库文件，再测试和部署，最后用 `git diff` 审查并提交。安装后运行 `status` 会对比本机部署的文件哈希，发现 GUI 或手工编辑产生的漂移；它不会扫描会话或凭据。

如果直接修改了已安装模块或本仓库插件 `lib/` 根目录的 JS/MJS 源码，可以运行 `capture` 将受管理的源码改动收回仓库。仓库源码也同时有修改时会拒绝覆盖，需手工合并。配置漂移不会自动回收，避免把机器路径、凭据或 GUI 临时状态带入版本控制；应修改 `config/` 或本机 settings，再部署。

```powershell
rtk proxy node scripts/harness.mjs status
rtk proxy node scripts/harness.mjs capture
rtk git diff
```

本地包从可读的发布 JS 和保留的界面资源重新打包；不是从未包含的 TypeScript 上游仓库编译。编译后的 JS 就是这里管理的部署源码。每次构建生成带内容哈希的包文件名，profile 依赖使用相对于其目录的 `file:../../local-plugins/...`，不依赖此仓库的克隆位置。

依赖版本调整后，先在临时 DSH_HOME 重新解析，再保存锁模板：

```powershell
rtk proxy node scripts/harness.mjs install --home .local/test-home --refresh-lock
rtk proxy node scripts/harness.mjs lock --home .local/test-home
rtk git diff
```

日常安装使用 `--frozen-lockfile`。本地包文件名和完整性校验在锁模板中使用占位符，安装时由当次构建结果替换。不要把运行时生成的锁直接拷贝进仓库。

## 验收与回滚

`test/portable.test.mjs` 验证路径迁移、表达式输出、设置边界、漂移检测、并发改动保护及硬编码路径检查。可选的真实 proxy 验收要求本机 `OPENAI_API_KEY`，会产生少量模型请求：

```powershell
rtk proxy node scripts/harness.mjs smoke
```

每次安装前的文件备份保存在目标 `DSH_HOME` 的 `backups`，部署哈希和对应备份位置保存在 `.portable-harness/state.json`。安装中途失败也记录回滚入口。先退出 Harness，再执行：

```powershell
rtk proxy node scripts/harness.mjs rollback
```

回滚会先备份当前受管理文件，恢复安装前的配置与锁，然后通过原生管理器按旧锁重装依赖。不会删除会话、实际记忆、worktree 或旧插件数据。首次在空目录安装后的回滚会移除本次新建的受管理配置文件，保留缓存和空目录。

## 范围

本仓库不包含 API key、原有聊天、记忆内容、Hindsight bank、个人项目、真实测试输出、node_modules 或机器备份。也不打包 DeepSeek Harness/Electron/Node 本体。旧的机器专属 `claude-hooks.json` 不复制；目标电脑没有该文件时，对应外部 Hook 行禁用。

默认 desktop 的功能补齐与一次性 headless 的既有 proxy/记忆配置一并管理；这不扩大 headless 的功能范围。上轮的 13 组 agent 功能验收不等于 Claude 模型质量或全部云端功能相同。升级 Harness 后须重新校验本地 API 补丁；不要只改版本号绕过检查。

远程仓库为 `https://github.com/ShaYaZhou/dsh-config.git`。首次按原生基线、增强版本顺序分别推送；原来的本地历史保留在未推送的 archive 分支。

精简的逐项影响、原生替代边界和遗漏修复清单见 [日常能力审计](docs/DAILY-CAPABILITY-AUDIT.md)。部署会保留本机相对生成基线的插件与配置变更；冲突会在写入前停止，status同时检查未应用的源码。

插件版本、保留本地改造的合并结果及暂缓升级原因见 [2026-10-27 插件更新核查](docs/PLUGIN-UPDATE-20261027.md)。启动动画 `dsh-boot-animation`（固定Git提交）与用量插件 `@kenz1117/dsh-ui-usage-billing` 已纳入两个桌面安装清单；安装后保留原有配置。首次安装且没有片头选择文件时，默认播放内置第二段「DeepSeek 赛博朋克片头」（`builtin:cyberpunk`），关闭随机播放、每次启动播放一次。视频已包含在锁定插件中，无需另行下载或复制个人视频；已有用户的选择、随机/关闭播放和会话专属设置不覆盖。
