# OpenSpec 与 DSH

固定版本：`@fission-ai/openspec@1.14.3`，官方 `dsh` 目标、`core` 工作流。技能是上游 CLI 原样生成的文件，位于 `.dsh/skills/`，MIT 许可见 `licenses/OpenSpec-MIT.txt`。不增加 MCP 或自写规格插件。

## 在另一台电脑启用

先按主 README 安装匹配的 Harness 运行时，再安装规格 CLI：

```powershell
rtk proxy npm install --global @fission-ai/openspec@1.14.3
rtk proxy openspec --version
rtk proxy node scripts/harness.mjs install --dry-run
rtk proxy node scripts/harness.mjs install
```

安装器把这 6 个技能部署到当前 DSH_HOME 的桌面能力目录，由原生 `customSkillDirs` 加载。换工作区仍可使用；项目自己的 `.dsh/skills` 优先于桌面默认技能。路径在部署时生成，仓库中不保存机器绝对路径。部署漂移、capture、备份和 rollback 均包含技能文件；clean 只移除曾被管理的增强技能，保留项目规格和用户技能。headless profile 不新增这些技能。

规格 CLI 是独立的全局 npm 工具，Harness 的 rollback 不会降级它；如需恢复旧 CLI，可显式安装旧版本。本轮升级前为 `1.3.1`。

## 在业务项目中使用

配置仓库已初始化 OpenSpec。其他项目需在自己的 Git 根目录初始化一次：

```powershell
rtk proxy openspec init --tools dsh --profile core --language Chinese --no-animation
```

之后在 DSH 对话中使用：

| 入口 | 行为 |
|---|---|
| `/openspec-explore` | 调研、理解代码和讨论方案 |
| `/openspec-propose 需求描述` | 生成提案、增量规格、设计和任务，完成规划后停止 |
| `/openspec-apply-change 变更名` | 执行任务并记录进度 |
| `/openspec-update-change 变更名` | 修订现有规划材料 |
| `/openspec-sync-specs 变更名` | 将增量规格合入主规格 |
| `/openspec-archive-change 变更名` | 同步并归档已完成的变更 |

这是技能入口，不是另写一套 `/spec` 命令。新会话若尚未刷新技能列表，重新打开该项目会话。上游 propose 只规划；执行阶段由 apply 明确启动。未启用 OpenSpec 的项目继续正常工作，小修复不必强行套用规格流程。

规格保存于项目的 `openspec/`，与项目代码一起提交 Git。不要把不同业务项目的规格收集到本配置仓库，也不要推送本机 DSH_HOME、会话或凭据。

## 与协作和验收衔接

规格定义目标、约束和验收场景；主会话用已有 `/collaborate`、`start_session` 分派可独立任务。子会话交付实现和测试证据，主会话核对后汇总；由主会话统一更新任务进度，避免并行写同一个 `tasks.md`。需要并行改代码时使用独立 worktree。

`openspec validate --strict` 检查结构，不证明功能正确。任务勾选、规划文件齐全或 Agent 自称完成，也不能代替测试、界面实际操作及附件收件验证。只有观察到验收证据才报告完成。

## 更新

先在隔离目录验证新 CLI 和 DSH 加载，再更新全局版本，在本仓库运行 `openspec update`，核对 `.dsh/skills/` 与 `provenance.json` 的版本，运行测试并重新部署。不要给旧 CLI 配置新技能，也不要自动使用 `@latest` 作为长期版本约定。

依据：[官方 DSH 集成](https://github.com/Fission-AI/OpenSpec/blob/main/docs-lab/reference/supported-tools.md)、[官方工作流](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)。
