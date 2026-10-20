# 可迁移性验收

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
