# DeepSeek Harness 可迁移配置

DSH 运行时以实际桌面版本为准，全局 CLI 必须与桌面同版，不要求等于 npm `latest` 标签。独立上游插件仍按各自的 `latest` 声明更新。保留原生 Standard/PTC、官方 computer-use、上游 dsh-memu-memory，以及按需 Workflow、浏览器批注、dynamic-ui、LiClick 接入和桌面辅助功能。

仓库不保存凭据、个人绝对路径、会话或记忆。安装器在目标电脑生成路径，并备份受管理文件。修改模板后需要重新部署才能生效。

## 安装

准备 Harness 桌面程序、该版本要求的 Node.js、浏览器和 RTK。0.2.2 系列要求 Node.js 至少 24.9。RTK 安装及 Windows 自检见 [技能与环境](docs/SKILLS-ALIGNMENT.md)。先在桌面“关于”中确认版本，再安装同版 CLI；下面的版本号只是示例，不是安装器的固定约束。

```powershell
$dshVersion = "0.2.2-rc.1" # 替换为桌面“关于”显示的版本
rtk npm install --global "@deepseek-ai/dsh@$dshVersion"
```

将 `config/local.example.json` 复制到 `.local/settings.json`，填写 proxy 地址、默认模型和权限预设。API key 使用 `OPENAI_API_KEY` 或 Harness 凭据配置，不写入 Git。默认模型必须存在于配置模型目录。

```powershell
rtk proxy node scripts/check-rtk.mjs
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
```

等待 Harness 任务结束，从“应用 → 退出”完全退出，然后部署：

```powershell
rtk proxy node scripts/harness.mjs install
rtk proxy node scripts/harness.mjs status
```

重新打开 Harness。安装器自身不会关闭应用，不改写会话、记忆或用户 worktree。配置会合并用户更改；遇到冲突或未捕获的部署代码修改时停止，不强行覆盖。

自定义安装位置可设置本机环境变量 `DSH_APP_DIR`，或 `DSH_EXECUTABLE` 与 `DSH_CLI_JS`；自定义 Node 可设置 `NPM_CLI_JS`。安装器的默认应用路径是 Windows 位置，macOS 上必须设置两个文件变量，例如 `DSH_EXECUTABLE=/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`、`DSH_CLI_JS=/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`。Windows 已有实机验证，其他平台仍需当地验收。

## 当前功能

完整安装清单、技能与 Hook 对齐范围、外部服务前置条件及明确排除项见 [安装对齐说明](docs/INSTALLATION-PARITY.md)。`status` 也会列出本机额外安装但未纳入仓库的包和 bundle，避免将“无文件漂移”误认为“所有插件已同步”。

- [桌面配置](docs/DAILY-PTC.md)：记忆插件、Hooks/RTK、压缩阈值及独立功能开关。
- [Workflow](docs/WORKFLOW.md)：上游原版 `/workflow`，兼容性和恢复边界。
- [OpenSpec](docs/OPENSPEC.md)：按需规格技能，没有强制分工或自动嵌套交付策略。
- [ub-mode](skills/ub-mode/SKILL.md)：按需编码纪律技能，“First Make it Work → Then Make it Right → Follow Practice”；配套的 crapper/dryer/mutator 质量门是上游独立 CLI，不随仓库安装。
- [cangjie-skill](skills/cangjie-skill/SKILL.md)：把书、长视频、播客、课程蒸馏成可执行技能的元技能（RIA-TV++ 流水线）；确定性脚本需 Python 3.10+ 与 PyYAML。
- [Matt Pocock skills](docs/SKILLS-ALIGNMENT.md#matt-pocock-skills)：27 项工程与效率技能，按上游 promoted 集合分发，user-invoked 与 model-invoked 边界保留。
- [Aisland-teach](skills/aisland-teach/SKILL.md)：中文优先的交互式教学技能，七步教学环加复述评分；HTML 课程需用户明确同意。
- [跨 agent 技能同步](docs/SKILLS-ALIGNMENT.md#其他-agent-的同步)：`scripts/sync-agent-skills.mjs` 把上述两个来源同步到 Claude Code 与 Codex 的全局技能目录；DSH 侧仍只走安装器。
- [浏览器与桌面控制](docs/BROWSER-COMPUTER-USE.md)：截图、批注及官方 computer-use。
- [桌面命令](docs/DESKTOP-COMMANDS.md)：会话导航和 Rewind。
- [LiClick](docs/LICLICK-ADAPTER.md)：无限画布模型目录与本机接入。
- [代码结构](docs/CODE-STRUCTURE.md)、[rc5 兼容说明](docs/RC5-COMPATIBILITY.md)。

旧自建 Workflow、嵌套会话、后续建议、Ultracode、空闲摘要、快捷工具布局、会话总线及用量报告已移除。历史数据保留；原生用量显示和其他统计插件不受影响。

## 维护与回滚

已有安装在拉取本次更新后，也必须重新部署：

```powershell
git pull --ff-only
rtk proxy node scripts/check-rtk.mjs
rtk proxy node scripts/harness.mjs install --dry-run
```

等待任务结束并完全退出 Harness，再运行 `rtk proxy node scripts/harness.mjs install`，重开后运行 `rtk proxy node scripts/harness.mjs status` 检查源文件与部署一致性。仅 git pull 不会更新正在使用的插件。

受版本管理的插件、技能、全局 AGENTS 模板和 RTK Hook 定义都由安装器分发。Hook 中的 Node 与脚本路径按目标电脑生成，安装检查会验证 RTK JSON Hook 接口。现有个人开关、其他 Hook 和凭据通过配置合并保留；因此“对齐”指受管代码和定义一致，不意味着覆盖他人的账号、模型、权限或历史。LiClick 仍需各自的 Atlas 登录态，记忆数据各自保留。

原生技能发现允许项目或用户目录中的同名技能覆盖随配置分发的版本。需要完全相同的技能行为时，也应核对技能管理器中的实际来源；安装器不会擅自删除其他目录的个人技能。

插件管理器安装或更新插件时会把版本写成精确号。安装器保留这类本机固定，但任何 `update --latest`（市场和安装器都只处理声明为 `latest` 的依赖）都不会再带上它们，于是包被永久固定在旧版。要恢复跟随 latest，退出 Harness 后把该条目改回 `latest` 再部署；本机已把 `@michengai/dsh-archive-manager`、`dsh-ego-browser` 改回，部署后为 1.2.8 与 0.9.10。市场状态里也可能留下没有对应包的旧禁用名，可清理 `profiles/desktop/.dsh-market/state.json` 的 `disabled` 项，只删名字，不动包数据和会话。

```powershell
rtk npm test
rtk proxy node scripts/harness.mjs install --home <隔离测试目录> --settings <隔离设置文件>
```

每次安装通过原生插件管理器更新声明为 `latest` 的上游包；已有本机固定版本和本地修改版不被强制替换。官方 `@deepseek-ai/*` 插件声明为 `${DSH_RUNTIME_VERSION}`，安装时自动跟随已安装桌面的实际版本：部分官方插件的 npm `latest` 标签仍指向旧 alpha，不能独立用它升级。没有写死 rc.5 数字。锁文件只在目标电脑生成，用于记录实际安装和回滚，不再从仓库分发；`lock` 命令仅检查本地锁文件，不写回固定模板。`latest` 不等于 `next` 或 `alpha`，也不绕过供应链、发布时间与兼容性检查。

本地修改版仍由仓库构建，保留版本元数据、来源及已验证的宿主兼容范围；这不是上游版本锁。插件市场和 dsh-memu-memory 使用未打补丁的上游包。目前保留：

- 无限画布：LiClick 接入补丁。新版不兼容时安装失败并保留备份，不静默丢弃功能。
- Better Sidebar：工具探测异常修复；左侧插件导航独立滚动并复用原生滚动条样式；导航/工作区之间可拖动分隔条，支持方向键调整、双击恢复默认及保存高度；右侧“开始”页使用限定高度的独立滚动容器。
- Agentero PDF：服务注入名修复。客户端注入宿主提供的 `agentero` 服务，上游包仍声明包名 `agentero-dsh-host`；补丁对 0.1.4/0.1.6 验证可应用，上游改名后安装会失败并保留备份。

侧栏适配基于原生 0.2.1-rc.5 与上游 0.30.1，宿主或插件升级需重新验收。上游 0.30.1 已自带工具探测的定时器提前声明修复，补丁只保留仍未修复的 `probeTool` 一处；补丁的滚动样式仍放在上游样式之前，保持既有覆盖顺序。Mac 已验证左右两区分别滚动至末尾、“更多”菜单不被裁剪；分隔条已通过隔离 DOM 交互、边界、取消、保存、重置和卸载测试；2026-11-07 用户在 Mac 桌面手动确认可正常拖动调整上下两区。Windows 界面尚未实测。

原生布局反馈：[DSH Discussion #12500](https://github.com/deepseek-ai/deepseek-harness/discussions/12500)。上游 CSS 缺括号已有 [Sidebar #955](https://github.com/omdsh-dev/DSH-better-sidebar/issues/955)，维护者已回复修复，不重复提交。分隔条集成回归：`node scripts/test-sidebar-navigation.mjs <隔离 profile> <已安装 jsdom 的项目目录>`。

通用宿主测试见 `scripts/test-runtime-compatibility.cjs`，需要隔离 `DSH_HOME` 与匹配的 `DSH_NATIVE_ROOT`；Workflow 和 Hooks 当前按未挂载验收。`scripts/test-external-workflow.cjs` 保留作上游兼容性恢复后的专项测试，当前不能作为通过证明。

退出 Harness 后，恢复最近一次安装备份：

```powershell
rtk proxy node scripts/harness.mjs rollback
```

恢复[原生基线](docs/NATIVE.md)：

```powershell
rtk proxy node scripts/harness.mjs clean
```

`rollback` 恢复本机备份，`clean` 部署 `presets/native/`。Git revert 只修改仓库，仍需运行安装器。会话、记忆、快照和用户工作目录不会随源码删除。
