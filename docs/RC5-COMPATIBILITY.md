# rc5 兼容性

部署目标为 `0.2.1-rc.5`。桌面主程序、全局 `@deepseek-ai/dsh` 与官方插件必须匹配该版本；不要用版本豁免代替适配。

本地插件对已验证的 rc5 增加明确 peer 版本，保留原有兼容范围。原生依赖和锁文件由隔离安装重新生成；本地包沿用版本号，通过安装器的内容哈希区分构建。

## 思考文本接口

官方 `conversation.chat.reasoning.body` 的 `text` 现在是显示文本，新增 `rawText` 保存完整模型输出，`running` 不变。`conversation.chat.reasoning.content` 仍接收调用方选定的 Markdown。

本仓库的本地插件和 `modules/` 没有注册上述 reasoning 插槽，也没有自行剥离 `<signature>` 的思考渲染器，因此沿用官方默认显示即可。BTW 后端的 `rawText` 变量只提取回答中的 `text` 块；记忆模块的 `reasoningEffort` 是请求参数，均不属于此次 UI 插槽迁移。不要因此改变模型原始历史或记忆内容。

以后若实现思考翻译或自定义渲染，显示和翻译使用 `text`；确实需要原始输出时使用 `rawText`。不要对 `text` 重复过滤，也不要为读取 `rawText` 导入宿主内部显示函数。

来源：[官方迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props/guide.zh.md)。

## 验证

- `npm test` 检查已有功能回归。
- 先对隔离目录运行 `scripts/harness.mjs install --dry-run --home <隔离目录>`，再安装；需要更新锁时使用 `--refresh-lock`，完成后运行 `lock --home <隔离目录>` 保存可移植锁模板。
- 在对应 Electron Node 运行时中运行 `scripts/test-runtime-compatibility.cjs desktop` 和 `enhanced`，设置隔离的 `DSH_HOME` 与匹配运行时的 `DSH_NATIVE_ROOT`（原生 `@deepseek-ai` 包目录）。测试使用真实宿主、会话和插件清单，不调用模型；检查异常插件、preset、命令及前端模块注册。
- headless 不提供 Web Host，使用其原生插件安装和版本校验，不能把 Web Host 测试参数套用到 headless。
- 实际桌面部署前备份，重启后核对插件页；宿主启动通过不等于所有模型调用、浏览器操作及跨平台功能都已实机验收。
