---
name: viewing-openspec-item-details
description: 查看指定 OpenSpec 变更或规格内容；用户提出相应任务时使用。
---

# 查看指定 OpenSpec 变更或规格内容

在用户指定的项目目录操作。先运行 `openspec --version`，本配置固定为 1.14.3；缺少全局 CLI 时可使用 `npx --yes @fission-ai/openspec@1.14.3`，不要自动改用 latest。

先查看 `openspec show --help`，再使用该版本支持的参数传入目标变更或规格。需要机器可读结果时，仅在帮助支持的情况下使用 `--json`。

只读查看目标条目，名称不唯一时先列出候选，避免读取错误项目。

完成后说明实际执行的命令和结果。这里只包装 CLI，不自动开启 Workflow、分配子会话或推送 Git。
