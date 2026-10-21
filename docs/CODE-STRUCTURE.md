# 自写改动的职责与依赖回查

2026-10-21，针对本仓库此前提交的本地增强与本次批注修复。范围是自写功能和上游发布产物中的本地补丁，不把上游整包宣称为重新审计过的自写源码。

| 功能 | 边界和协作方式 | 本次处理 |
|---|---|---|
| `plugins/desktop-commands` | 只负责桌面 slash 入口，经原生 commandUi、uiWorkspace、conversation 服务调用现有能力 | 移除整个浏览器批注实现和 sidebarRight 依赖 |
| `plugins/browser-review` | 截图预览和批注编辑有独立控制器与状态；共享截图能力、图片消息边界，意见编码不进入独立截图流程 | 两个独立入口，不引用桌面命令或嵌套会话的私有代码 |
| `plugins/nested-sessions` | 后端持久关系、权限、工具与前端分开；`model-routing.js` 单独封装会话级路由，前端只调用已认证 RPC | 新增 Agent 自主模型选择、等待汇总及明确的协作命令；systemPrompt 现在用于动态协作策略，不再是空依赖 |
| `modules/team*`、`modules/worktree*` | domain service 与模型工具适配器分开；工具依赖相应服务，原生会话负责执行 | 保留现有职责划分；不让批注引用这些模块 |
| `modules/role-policy.mjs` | 角色的权限/记忆策略，只挂载本角色工具约束与提示 | 无跨 UI 依赖，保留 |
| `modules/range-commands.mjs`、`compaction-basic.mjs` | 命令只解析参数并调用 compaction，摘要执行保留在引擎层 | 保留现有分层 |
| 记忆、BTW、Rewind 的上游产物和本地补丁 | 沿用各插件的服务边界；不为风格统一重写第三方源码 | 本次不改行为，运行现有回归 |
| `scripts/harness.mjs`、迁移脚本 | 安装/捕获/回滚管理部署；迁移脚本通过原生持久化接口独占写入 | 新包复用既有打包及锁模板机制，不增加第二套安装器 |

不以文件数量作为解耦标准；同一短功能中共享局部状态比通用事件总线更直接。真正的边界是数据所有者、外部副作用入口和依赖方向。后续修改遵循根目录 `AGENTS.md`。

批注测试覆盖临时截图 surface 错误、拒绝不重试、比例拟合、只读 DOM 查询、图片附件登记和原会话发送。实际安全载体验收使用 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`，同时检查元素边界吸附、CSS 定位/计算样式、全屏比例、稳定 guest viewport 和编号 PNG。真实 Harness 会话另行检查图片进入原生消息及模型读图回包。

任务协作的模型路由单独维护在 `model-routing.js`：只使用公开的模型目录、会话事件和 Agent 请求钩子，既不写全局默认模型，也不负责创建任务。任务数量、分工和选择传入工具的模型由 Agent 产生，服务负责校验、权限继承及执行；UI 只发用户目标、切换模式、导航和显示进度。结果直接打开原生会话，避免在插件内再造 Markdown 渲染器。部署漂移检查同时覆盖各本地包 `lib/` 根目录 JS/MJS，辅助文件也不会漏管。

`state-store.js` 负责持久化兼容：已发布的 `nested_sessions` v1 关系结构保持原样，模型选择、状态和协作偏好写入独立 domain。原生存储的严格 schema 不会因新增字段破坏旧版本回滚读取；扩展测试数据先迁移偏好再收回旧结构。UI 不直接接触这两个 domain。

OpenSpec 直接采用官方生成的项目技能，经安装器映射到桌面技能目录；没有新的功能插件。源文件、固定版本、MIT 许可与部署映射均可审查，项目规格仍由项目自己持有。侧栏 DOM 适配只存在于嵌套会话的 `installSidebarTree`，调用原关系 RPC 与原生 workspace/session 投影；纯排序、折叠与分页判断可独立测试。截图裁剪和批注意见各自维护状态，共用图片消息边界，不把截图交给批注控制器执行。
