# 当前代码职责

| 位置 | 职责 |
|---|---|
| `scripts/harness.mjs`、`deployment-state.mjs` | 生成配置、打包、安装、合并配置、漂移检查、备份与回滚 |
| `config/`、`presets/native/` | 当前配置模板与原生恢复基线 |
| `plugins/external-workflow/` | 上游 Workflow，rc5 适配集中在 `lib/rc5-subagents.js` |
| `plugins/browser-review/` | 内嵌浏览器截图与批注 |
| `plugins/dynamic-ui-view/` | 原生对话中的交互卡片 |
| `plugins/liclick-adapter/` | LiClick 网关与画布适配 |
| `plugins/desktop-commands/`、`delete-session/`、`file-links/` | 桌面命令、可恢复删除和文件预览 |
| `plugins/btw/`、`rewind/`、`codex-hooks/` | 有来源记录的第三方适配包 |
| `plugins/enhancement-settings/`、`idle-settings/` | 独立功能设置、压缩阈值 |
| `modules/` | 独立浏览器、压缩、RTK、Claude 上下文模块 |
| `skills/`、`.dsh/skills/` | 按需技能与 OpenSpec 上游技能 |
| `provenance.json` | 版本、来源和本地修改说明 |

跨功能使用原生服务或明确的公共接口。UI 不直接改写会话存储；扩展记录采用可忽略的原生插件记录。配置与源码变更遵守根目录 AGENTS.md。

会话总线、用量报告与自建嵌套会话不再注册。Workflow 使用原生 subagent 通信，不依赖已移除模块。
