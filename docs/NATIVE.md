# 官方原生基线

`native-clean` 标签对应第一次提交。默认安装仅使用官方 `dsh-base`、`dsh-web-app` 和 `dsh-headless` bundle，保留必要的 proxy 地址、模型定义和凭据引用。

不安装第三方增强或本地修改包，不挂载角色记忆、旁问、Rewind、本地 Team/worktree 补丁或外部 Hook。全局说明恢复为空白用户模板，权限等行为沿用原生默认值。`presets/native` 始终保留这套配置。

先退出 Harness，在仓库目录执行：

```powershell
rtk proxy node scripts/harness.mjs clean
```

这会备份当前受管理文件，卸载增强依赖、移除旧的受管理 agent 模块，再按原生配置部署。实际会话、记忆、快照和 worktree 不删除；旧包缓存保留但不加载。仓库目录下的源码不变。

如果希望 Git 历史也记录回退，在只有这两层提交的仓库中执行：

```powershell
rtk git revert --no-commit native-clean..HEAD
rtk git commit -m "Restore native Harness configuration"
rtk proxy node scripts/harness.mjs install
```

只执行 `git revert` 不会改变正在使用的配置。以后在增强提交之上继续开发，撤销时可能需要解决 Git 冲突。

`rollback` 的含义是撤销最近一次部署，因此执行 clean 后，rollback 可以恢复增强版；它不保证始终回到原生版本。原生与增强的运行时均固定为 0.2.1-rc.2，平台升级后需要重新验收。
