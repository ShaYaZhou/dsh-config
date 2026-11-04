---
name: updating-openspec-instructions
description: 更新项目中的 OpenSpec 生成指令；用户提出相应任务时使用。
---

# 更新项目中的 OpenSpec 生成指令

在用户指定的项目目录操作。先运行 `openspec --version`，本配置固定为 1.14.3；缺少全局 CLI 时可使用 `npx --yes @fission-ai/openspec@1.14.3`，不要自动改用 latest。

先查看 `openspec update --help`，再使用该版本支持的参数传入目标变更或规格。需要机器可读结果时，仅在帮助支持的情况下使用 `--json`。

先检查项目当前配置和本地修改，再更新生成指令，保留业务规格与用户修改。

完成后说明实际执行的命令和结果。这里只包装 CLI，不自动开启 Workflow、分配子会话或推送 Git。
