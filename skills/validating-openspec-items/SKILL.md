---
name: validating-openspec-items
description: 验证 OpenSpec 变更与规格格式；用户提出相应任务时使用。
---

# 验证 OpenSpec 变更与规格格式

在用户指定的项目目录操作。先运行 `openspec --version`，本配置固定为 1.14.3；缺少全局 CLI 时可使用 `npx --yes @fission-ai/openspec@1.14.3`，不要自动改用 latest。

先查看 `openspec validate --help`，再使用该版本支持的参数传入目标变更或规格。需要机器可读结果时，仅在帮助支持的情况下使用 `--json`。

使用目标条目的验证结果报告问题，不能把失败、未运行或跳过当作通过。

完成后说明实际执行的命令和结果。这里只包装 CLI，不自动开启 Workflow、分配子会话或推送 Git。
