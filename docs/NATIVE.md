# 官方原生基线

`clean` 使用 `presets/native/`，仅加载官方 `dsh-base`、`dsh-web-app` 和 `dsh-headless` bundle，保留必要的 proxy 地址、模型定义和凭据引用。普通 `install` 部署日常增强配置，不是原生基线。

不安装第三方增强或本地修改包，不挂载角色记忆、旁问、Rewind、本地 Team/worktree 补丁或外部 Hook。全局说明恢复为空白用户模板，权限等行为沿用原生默认值。`presets/native` 始终保留这套配置。

先退出 Harness，在仓库目录执行：

```powershell
rtk proxy node scripts/harness.mjs clean
```

这会备份当前受管理文件，卸载增强依赖、移除旧的受管理 agent 模块，再按原生配置部署。实际会话、记忆、快照和 worktree 不删除；旧包缓存保留但不加载。仓库目录下的源码不变。

要恢复当前仓库定义的日常配置，先退出 Harness，再执行：

```powershell
rtk proxy node scripts/harness.mjs install
```

无需为切换原生配置回退整段 Git 历史。只执行 `git revert` 不会改变正在使用的配置。

`rollback` 撤销最近一次部署，因此执行 clean 后可恢复之前的日常配置；它不保证始终回到原生版本。安装器要求实际桌面与 CLI 同版，不要求它们等于 npm latest 通道；本地锁文件用于回滚，宿主升级仍须重新验收。
