# 浏览器批注与桌面控制

桌面配置使用现有 Playwright MCP `0.0.83`，开启可见 Chromium、`vision,devtools` 和快照坐标。新增同版本官方 `dsh-computer-use` 注册服务及 CUA Driver native provider `0.2.1-rc.2`，其 SDK 固定为 `0.28.0`。没有额外安装第三方批注或浏览器插件。

安装后需等当前任务结束，从菜单真正退出 Harness 再打开。Harness 右侧内置浏览器仍使用原生载体，工具栏新增“批注”；Playwright 的独立浏览器与 Dashboard 是另一条自动化链路，不应混为同一页面。

## 右侧内置浏览器批注

说“使用内置浏览器”时，继续使用右侧页面。在其工具栏点击 **批注**，拖动框选，填写意见并点击 **保存选区**；可连续添加多个编号区域。点击 **发送批注** 后，仅将这批意见、原页面 URL、选区坐标和可用的编号截图发到该浏览器原来所属的会话，不夹带或清空聊天框的现有草稿与附件。发送失败保留意见以便重试。

桌面 WebView 使用自身截图接口冻结页面并生成编号截图；没有该接口的 Web iframe 载体会明确提示只能发送坐标与文字。批注输入留在 Harness 中，不注入被浏览网站，网站脚本不能读取这些批注意见。“关闭（保留批注）”只收起编辑面板，再点工具栏按钮可继续；关闭浏览器标签或重启应用不会持久保存未发送的批注。

## 使用

在 Harness 对话中直接提出任务，例如：

- “用浏览器打开这个页面，操作前高亮目标，完成后验证结果。”
- “打开这个本地预览，让我框选批注，收到批注后先总结修改要求。”
- “用 computer-use 查看指定应用，先观察窗口，再操作并验证。”

网页操作使用 `mcp__playwright__browser_*`。Agent 先读取新快照；结果为文件链接时读取对应 YAML，然后用 `browser_highlight` 高亮精确 ref。页面会显示目标遮罩及 `aria-ref=e6` 这类与当前快照一致的标签。操作后重新观察，清除旧高亮，不把一次点击投递当成成功。

`browser_annotate` 打开 Dashboard 的批注模式。在截图上拖出区域，填写意见，点击 **ADD**，完成后点 **Done annotating**，再点 **Submit**。工具返回页面 URL、区域坐标、完整意见、批注图片与 ARIA 快照文件路径。图片可由 Agent 的图像读取工具读取；不需要手动把意见重新粘贴进聊天。取消批注或空结果不算已提交。工具等待上限设为 10 分钟，超时后需重新请求批注。

原生桌面控制使用 `cua_driver_native__*`。先发现准确应用与窗口，再获取 UIA 元素/截图；使用当前元素 token 或截图坐标操作，最后读取新状态验证。优先后台投递；遇到明确拒绝不能擅自切换前台或另一个窗口。

此 profile 为每个 Agent 注册自己的 `computer-use` runtime skill，优先于共享用户技能中的同名 LiWork 入口；本机共享技能文件和其他应用配置不改写。这样换电脑后即使存在共享 LiWork 技能，也会解析到当前 Harness 的原生工具。用户在技能管理器中关闭旧入口的设置同样保留。

## 选择依据与验证

Playwright 已提供高亮、可交互区域批注和快照，无需再装功能重复的插件。试用的 `dsh-annotate` 存在 Windows 静态文件 URL 转换问题，而且只面向本地预览，因此没有加入最终依赖。`@nono-neko/dsh-browser` 的 HTML 转发方案不保留登录态，且不能完整代理表单提交，也没有采用。社区 computer-use 方案有 macOS 限定或缺少 Windows 实机验收；选择能在本机验证的官方 CUA 适配器。

本机已验证：

- Playwright 在可见浏览器中显示精确 ref 高亮；Dashboard 框选、填写中文意见、提交，并返回批注与图片/快照路径。
- CUA 创建独立浏览器，读取 DOM 语义 ref，输入测试文字、点击按钮，重新读取页面验证结果。
- CUA 读取 Windows 窗口 UIA/截图，执行测试窗口最大化，再读取窗口尺寸验证变化。
- 本机代理上的 `deepseek-v4.1-flash` 从批注图中正确读出中文意见。
- 隔离 Harness 启动、工具注册、真实模型请求及原有旁问链路通过。
- 右侧内置页面的工具栏批注按钮、框选编号、原会话收件、模型确认以及输入框原草稿保留通过。
- 使用安装版同一 Electron 运行时的隔离 WebView，实际调用 capturePage，框选生成有编号的 PNG，验证只附带批注自己的图片并发给绑定会话。没有关闭或操作用户现有桌面任务；不把这个隔离载体验收说成所有真实网站都已通过。

独立浏览器默认不继承日常浏览器登录态。原生桌面能力需要可交互图形会话；锁屏或应用权限高于宿主时，操作可能被拒绝。Windows CUA 的独立 OS 光标叠层未验证可见，不能据此宣称已具备该效果；网页反馈由已验证的 Playwright 高亮与批注承担。其他电脑、其他操作系统与所有第三方网站未逐一实测。

依据：[Playwright MCP](https://github.com/microsoft/playwright-mcp)、[官方 CUA native provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/computer-use-cua-driver-native)。不改写浏览器安全配置，不启用 legacy JavaScript mutation 逃生开关，不绕过驱动的拒绝。
