# 自写改动的职责与依赖回查

2026-10-21，针对本仓库此前提交的本地增强与本次批注修复。范围是自写功能和上游发布产物中的本地补丁，不把上游整包宣称为重新审计过的自写源码。

| 功能 | 边界和协作方式 | 本次处理 |
|---|---|---|
| `plugins/desktop-commands` | 只负责桌面 slash 入口，经原生 commandUi、uiWorkspace、conversation 服务调用现有能力 | 移除整个浏览器批注实现和 sidebarRight 依赖 |
| `plugins/browser-review` | 独立批注功能。几何拟合/消息编码为纯函数；截图、只读元素检查、图片编码、消息发送各有单一入口；视图只协调这些步骤 | 新建专用包，不引用桌面命令或嵌套会话的私有代码 |
| `plugins/nested-sessions` | 后端持久关系、权限和状态变化与前端树分开；前端通过原生已认证 connection RPC 操作后端 | 移除未使用的前端 layout/后端 systemPrompt 依赖，将前端恢复为可读格式，没有扩展业务或改历史结构 |
| `modules/team*`、`modules/worktree*` | domain service 与模型工具适配器分开；工具依赖相应服务，原生会话负责执行 | 保留现有职责划分；不让批注引用这些模块 |
| `modules/role-policy.mjs` | 角色的权限/记忆策略，只挂载本角色工具约束与提示 | 无跨 UI 依赖，保留 |
| `modules/range-commands.mjs`、`compaction-basic.mjs` | 命令只解析参数并调用 compaction，摘要执行保留在引擎层 | 保留现有分层 |
| 记忆、BTW、Rewind 的上游产物和本地补丁 | 沿用各插件的服务边界；不为风格统一重写第三方源码 | 本次不改行为，运行现有回归 |
| `scripts/harness.mjs`、迁移脚本 | 安装/捕获/回滚管理部署；迁移脚本通过原生持久化接口独占写入 | 新包复用既有打包及锁模板机制，不增加第二套安装器 |

不以文件数量作为解耦标准；同一短功能中共享局部状态比通用事件总线更直接。真正的边界是数据所有者、外部副作用入口和依赖方向。后续修改遵循根目录 `AGENTS.md`。

批注测试覆盖临时截图 surface 错误、拒绝不重试、比例拟合、只读 DOM 查询、图片附件登记和原会话发送。实际安全载体验收使用 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`，同时检查元素边界吸附、CSS 定位/计算样式、全屏比例、稳定 guest viewport 和编号 PNG。真实 Harness 会话另行检查图片进入原生消息及模型读图回包。
