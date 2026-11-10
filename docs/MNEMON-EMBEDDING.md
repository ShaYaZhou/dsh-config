# Mnemon 嵌入与记忆积累

本文件记录 2026-11-10 会话里启用并验收的一组操作：切换本地嵌入模型、在维度变化后重算向量、放宽自动记录指引、建立每日整理任务，以及避免 CLI 回落到错误模型的跨平台兜底。配置模板见 [`config/mnemon.json`](../config/mnemon.json)，来源选择语义见 [记忆来源选择](MNEMON-SOURCE-SELECTION.md)。

## 启用的操作

| 操作 | 为什么 | 验收证据 | macOS |
| --- | --- | --- | --- |
| `ollama pull qwen3-embedding:0.6b`（约 639 MB，1024 维，中英双语） | 此前的 `nomic-embed-text` 是英文模型（768 维），中文记忆检索质量差 | `POST /api/embed` 返回 1024 长度向量；写入后向量 blob 为 4096 字节 | 相同命令；Ollama 端点同为 `127.0.0.1:11434` |
| 模板 `embedding.model` 指向新模型 | 插件按模板生成运行配置，改在 Git 外会丢 | `config/mnemon.json` 与本机 `cordis.patch.yml` 一致 | 相同模板，安装器生成宿主路径 |
| 维度变化后重算旧向量（768 → 1024） | 混维向量让相似度失去意义 | 全部条目 blob = 维度 × 4 字节 | 相同：设置页「补齐」或 CLI |
| `ollama stop nomic-embed-text` | 释放显存，避免两种模型同时驻留 | `ollama ps` 只剩新模型 | 相同命令 |
| 放宽自动记录指引（`include:mnemon-strategy-auto-capture` 的 `instruction`） | 原指引过窄，几乎不触发记录 | 模板内保留三类事实与禁止项；测试覆盖 | 相同模板 |
| 主 Agent 会话收尾写 1~2 条 | 后台复盘没有写向量的工具（见下节） | oplog 出现 `remember`，新条目带向量 | 相同 |
| 每日整理定时任务（DSH 内置 schedule，`FREQ=DAILY`） | 补录当天没有及时记录的结论 | 任务列出、首跑时间正确 | DSH 内建，跨平台一致；系统级等价写法为 macOS `launchd`、Windows 任务计划 |
| 只读体检脚本 `scripts/check-mnemon-embedding.mjs` | 换模型/重算后快速确认链路 | 见「体检脚本」一节 | 同一份 Node 脚本，无平台分支逻辑 |

## 后台复盘不会写向量（上游限制）

dsh-mnemon 的空闲复盘工具白名单只有 `mnemon_document_search`、`mnemon_runtime_memory`、`mnemon_document_create`，因此后台只能产出文档与热记忆，拿不到 `mnemon_remember`。来源参与授权的写入档位（`automatic`）不是瓶颈，白名单在代码里，配置无法放行。

不要改包或伪造授权绕过：升级会覆盖本地补丁，而且与来源选择语义冲突。向量积累由主 Agent 的记录指引与每日整理任务承担；这两条都由本仓库模板与 DSH 内建能力承载，不需要改动上游包。

## 换嵌入模型的标准流程

1. 拉取新模型：`ollama pull <model>`，确认 `POST /api/embed` 有响应。
2. 改 `config/mnemon.json` 的 `embedding.model`（或设置页），重新部署模板。
3. 维度变化必须重算：设置页点「补齐」，或对单条执行 `mnemon embed <insight-id>`（命令带上 `--embed-model`）。
4. 校验：`length(embedding)` = 维度 × 4 字节；`embed --status` 的覆盖率到 100%。
5. 暂时不可用时：写入仍成功但不带向量，关键词、链接与时间召回仍然可达，语义召回会漏掉该条，补齐后恢复。

关掉 embedding（`enabled=false`）同样要重新部署；没有本地模型服务时这也是可接受状态，但语义召回不可用。

## CLI 默认模型陷阱（跨平台）

`mnemon` 的 `--embed-model` 默认值硬编码为 `nomic-embed-text`，优先级是：显式参数 > `MNEMON_EMBED_MODEL` > 硬编码默认值。`mnemon store` 只能管理 active store，没有持久化模型配置项，所以只有三条兜底路径。

- Windows：把 `MNEMON_EMBED_MODEL` 设为 User 级环境变量（`HKCU\Environment`，重启后对所有新进程生效）；交互终端另可在 `$PROFILE` 定义 `mnemon` 函数，固定注入 `--data-dir` 与 `--embed-model`。
- macOS：在 `~/.zshrc`（或 `~/.bash_profile`）里 `export MNEMON_EMBED_MODEL=<model>`。由 Finder 或启动台拉起的应用不继承 shell 变量，GUI 场景用 `launchctl setenv MNEMON_EMBED_MODEL <model>`（重启登录后失效），或始终显式传参。
- 结论：脚本与定时任务一律显式传 `--embed-model`，环境变量与 profile 函数只作兜底，不作为唯一依赖。

## 体检脚本

```bash
node scripts/check-mnemon-embedding.mjs
# 可选：--endpoint / --model / --data-dir / --timeout-ms
```

脚本只读：探测 Ollama 的 `/api/tags` 与 `/api/embed`，核对模型维度与约定是否一致，再跑 `mnemon embed --status` 读取覆盖率；任一环节失败时打印 Windows 或 macOS 对应的修复提示并以非零码退出。它不写配置、不改数据、不安装任何东西，因此可以在隔离环境里直接跑。

CLI 定位顺序：`MNEMON_CLI_JS` → `$DSH_HOME/profiles/{desktop,headless}/node_modules/@mnemon-dev/mnemon/bin/mnemon.js` → `PATH` 上的 `mnemon`。设置 `DSH_HOME` 即可指向隔离环境，不会碰到正式记忆目录。

本次只在 Windows 实机跑通；macOS 的路径与命令按同一份逻辑推导，尚未在当地验收。

## 撤销

- 删除每日整理定时任务；移除热记忆里的记录约定。
- 从模板删除自动记录 `instruction` 与 `sourceKeys` 覆盖，回到上游默认指引。
- 若换回旧模型：改回 `nomic-embed-text` 或关闭 embedding，重新部署，并再次「补齐」重算向量。
- 删除 `MNEMON_EMBED_MODEL` 环境变量与 profile 函数；这只会让 CLI 回落到硬编码默认值，不影响已写入的向量。
- 记忆数据不建议删除；确需回滚时先备份 `$DSH_HOME/mnemon`。

路径约定使用 `$DSH_HOME`（默认 `~/.dsh`），数据在 `$DSH_HOME/mnemon/data/default/mnemon.db`；仓库不保存个人绝对路径、凭据、会话或记忆内容。
