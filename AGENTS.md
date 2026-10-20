# 仓库维护规则

- 描述性输出默认中文；修改前读调用方与配置入口。
- 不提交凭据、个人绝对路径、实际会话/记忆、node_modules、build 或 .local 内容。
- 本地模块绑定 provenance.json 中的原生运行时版本；升级必须做真实宿主验收。
- 修改 config 或源码后执行 `rtk proxy node --test test/portable.test.mjs`。部署先看 dry-run，并保留安装器备份。
- 实际运行配置由模板生成；避免直接编辑后丢失在 Git 之外。不要自动导出包含凭据的本机配置。
