# 桌面配置

本文记录截至 2026-11-07 的配置选择，不是永久要求或禁止清单。后续是否采用某个插件、工作流或配置，以当次需求和评估为准。

安装器维护一个 desktop profile，以及原生 headless 基线。Standard 和 PTC 使用官方预设。原先的 enhanced、Ultracode、自建 Workflow 引擎和空闲压缩定时器已退役，不再生成或加载。

## 功能

- Workflow：按需使用 /workflow 描述任务，由上游插件编排原生子代理；不强制用于所有任务。
- dynamic-ui：保留技能、render_widget、沙箱 iframe 和自适应高度。交互卡片在工具折叠组外直接显示；展开工具记录不应重载卡片。
- 上下文压缩：设置 → Harness增强 → 上下文压缩。阈值默认 80%，可动态设置 20–100% 并还原默认；不因会话空闲而启动模型。
- computer-use：安装与宿主版本一致的官方注册组件和原生驱动，使用原生工具与权限机制。不再注入自定义指引或 computer-use 技能。
- 浏览器截图/批注、Rewind、旁问、代码审查、文件预览、插件市场、LiClick 无限画布功能继续保留。

鲸鱼挂件、表情包、ComfyUI、Ego Browser、自媒体工作台、歸藏设计、上下文洞察、Agentero 和官方可选 bundle 已加入安装清单；完整列表与前置条件见 [安装对齐说明](INSTALLATION-PARITY.md)。

## 记忆

记忆插件为 dsh-memu-memory，随安装跟随 latest。它自带 bundle 层注册宿主工具与客户端界面，安装器只在 desktop profile 依赖和 bundle 里声明它，不往 cordis patch 追加配置行。数据与用户设置位于当前 DSH_HOME 下的 dsh-memu-memory 目录，测试配置不会共享正式记忆目录。不自动连接第三方记忆服务。

记忆行为由插件原生能力和用户设置决定（记忆后端、向量来源、注入预算等都在插件设置里改，`state.json` 不纳入仓库）。旧 dsh-memory 文件保留，不自动导入或删除；它们不会因此自动出现在召回中。

旧的 dsh-memory 插件已在 `config/headless.patch.json` 里置为 `disabled`：它指向 `${MEMORY_URL}` 的外部记忆服务，不再随 headless profile 加载，配置原样保留以便需要时恢复。desktop profile 从未声明过它。

dsh-mnemon 及其 CLI @mnemon-dev/mnemon 已按 714 题 A/B 结果卸载（62.04% 对 73.81%），本地 mnemon 配置、专用界面测试与来源选择文档一并移除。

## Hooks 与 RTK

dsh-codex-hooks 已恢复未修改的上游 0.6.0；若当前宿主无法加载，保留配置等待上游修复，RTK 钩子不会在插件未加载时自动执行。RTK 只通过设置 → 钩子和 /hooks 管理，不再提供独立面板或 Shell 执行器适配。

两条受管钩子分别负责首步提示和 Shell 执行前检查，包括 PTC 内部调用。映射由 RTK 自带的 JSON hook 处理器计算，不启动 Claude Code。DSH 的前置接口不支持透明替换参数，因此未包装的受支持命令会先被阻止，再由 Agent 按提示提交 RTK 命令；原命令尚未执行。复杂脚本、机器格式和已包装命令保持原样。启停、信任和试跑均在钩子面板完成；不为此扩展 Hook 插件代码。检查失败会计入钩子失败记录，优化检查不是安全沙箱。

配置模板为 config/rtk-hooks.json，安装器生成当前机器的 hooks.json 并仅批准这两条精确匹配的定义。用户已有开关状态与其他钩子保持不变。动态卡片使用 rc5 原生 Conversation Node 的 turn 级位置，直接投影已有普通/PTC 调用记录，不新增会话记录，也不搬移 iframe DOM。

## 部署与恢复

修改从仓库模板生成。先运行测试和 install --dry-run，再在 Harness 任务结束并退出后部署。安装器备份受管文件及 Hooks 信任状态；移除旧 enhanced 的受管入口和代码文件，保留会话、旧记忆、工作流日志和未管理的数据。

rollback 恢复上次备份。Git revert 恢复仓库代码后仍需重新部署，不会单独改变已安装配置。历史验收文档描述当时版本，不能据此认为已退役功能仍可调用。
