# Workflow

使用 `/workflow 任务内容` 调用 `omdsh-dev/dsh_workflow`。流程通过原生 subagent 执行；`workflow_list` 查看模板，`run_workflow` 执行，`workflow_manage` 管理记录。首次使用可输入 `/workflow help`。

## 开始使用

在会话中选择 Standard 或 PTC，均可使用：

```text
/workflow help
/workflow list
/workflow 并行检查本项目的代码结构和测试覆盖，只读分析后汇总建议
/workflow runs
/workflow show
/workflow stop
```

也可以直接运行已有模板，例如：

```text
/workflow parallel-investigation {"question":"为什么测试偶尔失败？"} --wait
```

自然语言形式把任务交给当前主 Agent 调研并生成流程，不要求预先切换到 PTC。命名流程默认后台运行；支持等待的命令可加 `--wait`。`/workflow show` 查看最近运行，`/workflow stop` 停止当前活动流程。长任务也可使用 `pause`/`resume`；`resume-run` 是从已有运行记录续跑，与恢复暂停不同。

## Workflow 与会话模式

这里的“开/关”指插件页启用或停用 `@dsh-external/workflow`，没有独立的 `/workflow on`、`/workflow off` 模式命令。启用只提供可用的流程工具，不强迫每个请求进入 Workflow；只是不输入 `/workflow`，也不等于禁用了模型可调用的流程工具。停用前先结束活动流程，卸载会停止它们。

| Workflow 插件 | 会话模式 | 能力 |
|---|---|---|
| 关 | Standard | 原生直接工具调用、检索、编辑、终端与子代理；没有这个插件的命名流程及管理工具 |
| 关 | PTC | 原生能力通过 `run_code` 内的程序调用、批处理和筛选；不增加持久 Workflow 管理 |
| 开 | Standard | 直接工具调用，加上流程模板、编排、运行记录、暂停/停止和缓存续跑 |
| 开 | PTC | 同样的 Workflow 能力，加上程序化工具调用；适合批量数据处理与多步工具操作 |

两维互相独立。Standard/PTC 不改变权限授予，也不保证模型效果或费用高低。原生子代理仍可在 Workflow 插件关闭时使用；当前 Workflow 创建的子代理默认继承父会话预设。

2026-11-04 在 rc5 宿主实测四种组合：开启时两种预设各完成两个原生子代理；关闭时命令及三个 Workflow 工具消失，原生工具和子代理仍存在。子代理回复采用固定模型输出，测试覆盖调度接口，不代表真实业务任务效果。

固定上游 0.1.2、提交 `44b83c182aa02d1be8a0803e8446cb495f93cd8f`。本地包 `0.1.2-local.rc5.1` 调整 DSH peer 版本声明，并以独立适配文件对接 rc5 的子代理激活、消息和只读限制；会话读取使用 snapshotEvents。其余执行策略、存储及审批保持上游实现。它不是 DeepSeek 官方插件。

自建 Workflow、嵌套会话、协作模式切换、后续建议及依赖它们的自动规格交付技能已移除。已有会话、记忆、worktree 和插件历史数据不删除；旧子会话可以作为普通会话打开。原生 Team、worktree、OpenSpec 技能、dynamic-ui、BTW 和浏览器批注独立保留。

恢复只复用成功缓存；失败任务可能在产生部分副作用后重新执行。涉及改文件、提交或外部操作时，先检查已发生的变更再决定续跑。上游默认审批策略保持不变，不把 Workflow 强制用于所有任务。

2026-11-03 隔离评估：原测试配 rc5 SDK 为 177/179；Windows Git 测试提高墙钟时限后通过，另一项依赖旧 SDK 测试接口。真实 rc5 宿主的服务、工具、命令与纯脚本并行流程已验证。实际模型完成质量不由这些测试保证。

历史替换验收记录（2026-11-04，不是每次更新的当前结果）：当轮记录为 146 项仓库测试通过；rc5 宿主中 `/workflow help` 成功，两个真实原生子代理并行完成固定模型回复测试，模型可见工具中没有写文件与 shell 工具。适配层另测了限制持久化、冷加载恢复和非法记录拒绝。记录中的部署前后 157 个会话与记忆文件哈希相同，桌面插件页可见 Workflow、无异常标记，旧协作入口已消失。真实模型端到端执行与桌面输入提交不在这条记录的通过范围内；后续版本应重新验收。
