# DeepSeek Harness 原生安装基线

这次提交只安装官方原生 bundle，不含第三方插件或本地 agent 补丁。保留可迁移的 proxy 配置、安装器、备份与回滚。固定运行时 0.2.1-rc.2；Node.js 使用 22.19+（22 系列）或 24+。

安装匹配版本的 Harness 桌面程序和全局 CLI，将 config/local.example.json 复制到被 Git 忽略的 .local/settings.json，填写 proxy 地址。API key 使用本机环境变量或原生凭据配置，不提交到 Git。

```powershell
rtk npm install --global @deepseek-ai/dsh@0.2.1-rc.2
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
rtk proxy node scripts/harness.mjs install
```

目录中的配置都是相对模板，安装时解析本机路径。使用默认 Windows 安装位置，其他位置可设置本机环境变量 DSH_APP_DIR，或 DSH_EXECUTABLE 与 DSH_CLI_JS。其他系统尚未实机验收。

增强版本发布后，可以用 `git revert tuned` 再执行安装器恢复本提交的配置；也可以从增强版直接执行 `node scripts/harness.mjs clean`。安装器保留在基线中，会清理旧受管理增强模块。详见 [原生恢复说明](docs/NATIVE.md)。原有会话、记忆、快照和 worktree 不会删除。
