# DeepSeek Harness 可迁移配置

固定匹配 DSH **0.2.1-rc.5**。保留原生 Standard/PTC、官方 computer-use、上游 Mnemon，以及按需 Workflow、浏览器批注、dynamic-ui、LiClick 接入和桌面辅助功能。

仓库不保存凭据、个人绝对路径、会话或记忆。安装器在目标电脑生成路径，并备份受管理文件。修改模板后需要重新部署才能生效。

## 安装

准备匹配版本的 Harness 桌面程序、Node.js 22.19+（22 系列）或 24+、浏览器和 RTK。RTK 安装及 Windows 自检见 [技能与环境](docs/SKILLS-ALIGNMENT.md)。

```powershell
rtk npm install --global @deepseek-ai/dsh@0.2.1-rc.5
```

将 `config/local.example.json` 复制到 `.local/settings.json`，填写 proxy 地址、默认模型和权限预设。API key 使用 `OPENAI_API_KEY` 或 Harness 凭据配置，不写入 Git。默认模型必须存在于配置模型目录。

```powershell
rtk proxy node scripts/check-rtk.mjs
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
```

等待 Harness 任务结束，从“应用 → 退出”完全退出，然后部署：

```powershell
rtk proxy node scripts/harness.mjs install
rtk proxy node scripts/harness.mjs status
```

重新打开 Harness。安装器自身不会关闭应用，不改写会话、记忆或用户 worktree。配置会合并用户更改；遇到冲突或未捕获的部署代码修改时停止，不强行覆盖。

自定义安装位置可设置本机环境变量 `DSH_APP_DIR`，或 `DSH_EXECUTABLE` 与 `DSH_CLI_JS`；自定义 Node 可设置 `NPM_CLI_JS`。Windows 已有实机验证，其他平台仍需当地验收。

## 当前功能

- [桌面配置](docs/DAILY-PTC.md)：Mnemon、Hooks/RTK、压缩阈值及独立功能开关。
- [Workflow](docs/WORKFLOW.md)：`/workflow 任务内容`，rc5 适配和恢复边界。
- [OpenSpec](docs/OPENSPEC.md)：按需规格技能，没有强制分工或自动嵌套交付策略。
- [浏览器与桌面控制](docs/BROWSER-COMPUTER-USE.md)：截图、批注及官方 computer-use。
- [桌面命令](docs/DESKTOP-COMMANDS.md)：会话导航和 Rewind。
- [LiClick](docs/LICLICK-ADAPTER.md)：无限画布模型目录与本机接入。
- [代码结构](docs/CODE-STRUCTURE.md)、[rc5 兼容说明](docs/RC5-COMPATIBILITY.md)。

旧自建 Workflow、嵌套会话、后续建议、Ultracode、空闲摘要、快捷工具布局、会话总线及用量报告已移除。历史数据保留；原生用量显示和其他统计插件不受影响。

## 维护与回滚

已有安装在拉取本次更新后，也必须重新部署：

```powershell
git pull --ff-only
rtk proxy node scripts/check-rtk.mjs
rtk proxy node scripts/harness.mjs install --dry-run
```

等待任务结束并完全退出 Harness，再运行 `rtk proxy node scripts/harness.mjs install`，重开后运行 `rtk proxy node scripts/harness.mjs status` 检查源文件与部署一致性。仅 git pull 不会更新正在使用的插件。

受版本管理的插件、技能、全局 AGENTS 模板和 RTK Hook 定义都由安装器分发。Hook 中的 Node 与脚本路径按目标电脑生成，安装检查会验证 RTK JSON Hook 接口。现有个人开关、其他 Hook 和凭据通过配置合并保留；因此“对齐”指受管代码和定义一致，不意味着覆盖他人的账号、模型、权限或历史。LiClick 仍需各自的 Atlas 登录态，Mnemon 数据各自保留。

原生技能发现允许项目或用户目录中的同名技能覆盖随配置分发的版本。需要完全相同的技能行为时，也应核对技能管理器中的实际来源；安装器不会擅自删除其他目录的个人技能。

```powershell
rtk npm test
rtk proxy node scripts/harness.mjs install --home <隔离测试目录> --refresh-lock
rtk proxy node scripts/harness.mjs lock --home <隔离测试目录>
```

修改依赖后在隔离目录刷新锁模板。真实宿主测试见 `scripts/test-external-workflow.cjs`，需要隔离 `DSH_HOME` 与匹配的 `DSH_NATIVE_ROOT`；它使用固定模型输出验证子代理生命周期，不发送真实模型请求。

退出 Harness 后，恢复最近一次安装备份：

```powershell
rtk proxy node scripts/harness.mjs rollback
```

恢复[原生基线](docs/NATIVE.md)：

```powershell
rtk proxy node scripts/harness.mjs clean
```

`rollback` 恢复本机备份，`clean` 部署 `presets/native/`。Git revert 只修改仓库，仍需运行安装器。会话、记忆、快照和用户工作目录不会随源码删除。
