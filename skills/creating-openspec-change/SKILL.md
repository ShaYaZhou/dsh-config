---
name: creating-openspec-change
description: 为新的需求创建 OpenSpec 变更；用户提出相应任务时使用。
---

# 为新的需求创建 OpenSpec 变更

在用户指定的项目目录操作。先运行 `openspec --version`，本配置固定为 1.14.3；缺少全局 CLI 时可使用 `npx --yes @fission-ai/openspec@1.14.3`，不要自动改用 latest。

先查看 `openspec new change --help`，再使用该版本支持的参数传入目标变更或规格。需要机器可读结果时，仅在帮助支持的情况下使用 `--json`。

使用清晰的变更名称创建目录；保留已有变更和用户文件。

完成后说明实际执行的命令和结果。这里只包装 CLI，不自动开启 Workflow、分配子会话或推送 Git。
