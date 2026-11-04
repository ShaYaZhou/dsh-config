# OpenSpec 与 DSH

固定 `@fission-ai/openspec@1.14.3`，采用上游 DSH 技能，来源为 `.dsh/skills/`。安装器通过原生 filesystem skill provider 分发到桌面 profile；按需读取，不自动启动 Workflow。

新电脑安装 CLI：

```powershell
rtk npm install --global @fission-ai/openspec@1.14.3
rtk proxy openspec --version
```

在业务项目根目录初始化：

```powershell
rtk proxy openspec init --tools dsh --profile core --language Chinese --no-animation
```

| 技能 | 用途 |
|---|---|
| `/openspec-explore` | 理解代码、调研和讨论需求 |
| `/openspec-propose` | 生成提案、规格、设计和任务 |
| `/openspec-apply-change` | 执行已规划的变更 |
| `/openspec-update-change` | 修订规划 |
| `/openspec-sync-specs` | 同步增量规格 |
| `/openspec-archive-change` | 归档已完成变更 |

也可以用自然语言要求 Agent 使用对应技能。上游 propose 是规划阶段；执行需要明确要求。自建 dsh-spec-delivery 技能已移除，不再保证自动分配嵌套会话或强制独立审查。需要编排时另行使用 [Workflow](WORKFLOW.md)。

规格保存在各业务项目的 `openspec/`，跟随项目 Git 管理。Harness 回滚不会降级全局 CLI；clean 不删除业务规格和用户技能。许可见 `licenses/OpenSpec-MIT.txt`。
