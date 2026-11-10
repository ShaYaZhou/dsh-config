# 本机安装与仓库对齐

2026-11-04 对比 desktop/headless 的包、bundle、生成配置与实际覆盖、AGENTS、技能来源、有效 Hook 和插件偏好。`status` 的文件哈希只证明受管文件一致，不能证明个人安装已纳入仓库；现在同时报告包和 bundle 声明差异。

## 补入的安装项

下表版本是历史验收记录，不是安装约束；当前配置跟随 npm `latest`。

| 包 | 历史验收版本 | 前置条件 |
|---|---|---|
| dsh-meme | 0.1.76 | 包含上游默认图库；个人导入图库不分发 |
| dsh-whale-widget | 0.4.2 | 包含上游素材；个人角色、账本与音效文件不分发 |
| dsh-comfyui | 0.5.5 | 实际生成需要自己的 ComfyUI 服务 |
| dsh-ego-browser | 0.9.8 | 浏览器登录态与任务空间各自保留 |
| @deepseek-ai/dsh-subagent-claude-code | 0.2.1-rc.5 | 自行安装并授权对应 CLI |
| @deepseek-ai/dsh-subagent-codex | 0.2.1-rc.5 | 自行安装并授权对应 CLI |

同时补入本机已启用的官方 bundle：会话搜索、持久终端、智能体团队、Ralph、插件市场、徽章技能、Inspector、自动授权审查、语音输入、Git worktree 和思考翻译。加上上表六项，共补齐 17 个 bundle 声明。这些是本机原有的官方功能，不是恢复已删除的自建 Team/worktree。

## 2026-11-07 新增社区插件

以下四项同时加入 desktop 依赖和 bundle，安装时按 `latest` 与原生供应链规则解析。本机版本只记录同步时的安装状态，不代表新版本已验收，也不复制本机的临时版本固定。

| 插件 | 同步时本机版本 | 首次使用配置 |
|---|---|---|
| [dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk) | 2.6.0 | 文案使用已配置模型；图片生成需在插件设置填写自己的图片服务配置与密钥 |
| [dsh-guizang-design](https://github.com/op7418/dsh-guizang-design) | 0.1.4 | 由插件提供设计入口及技能；不复制本机技能目录的个人修改 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 0.81.2 | 使用本机会话与上下文，相关历史不分发 |
| [agentero-dsh](https://github.com/poco-ai/agentero-dsh-plugin) | 0.1.4 | 自行安装 Agentero CLI、建立 Vault，并在设置中选择 CLI 和 Vault 路径；论文和笔记不分发 |

Agentero 注意：本机对 `agentero-dsh-pdf` 另有服务注入名修复——PDF 客户端注入的是宿主提供的 `agentero` 服务，而上游包仍声明包名 `agentero-dsh-host`。补丁已纳入 `config/patches/agentero-dsh-pdf.patch`，对 0.1.4 和 0.1.6 均验证可应用；补丁不绑定具体版本，上游改名后安装会因上下文不匹配而失败并保留备份，不会静默丢失修复。

> 升级提示：本机已由插件管理器新增的依赖（本次四款社区插件，以及 git-graph、today-todo、notion-mcp）在模板里是 `latest` / `@artifact`，本机 profile 里则是 `^x.y.z` 或绝对 `file:`；直接部署会在这几个键上触发三方合并冲突。退出 Harness 后把对应条目改成模板声明或移除，再重试。旧部署若已有 `agentero-dsh-pdf@0.1.4` 的 `patchedDependencies` 条目和 `patches/agentero-dsh-pdf@0.1.4.patch`，也要一并删除；新补丁使用不带版本号的键，依赖升级到 0.1.6 后旧键会触发 pnpm `ERR_PNPM_UNUSED_PATCH`。

### 本机追加的本地包与官方 bundle

- `@local/dsh-today-todo`、`@local/dsh-notion-mcp` 已从个人工作目录收入 `plugins/today-todo/`、`plugins/notion-mcp/`，安装时由仓库打包并以 `@artifact` 引用，不再写入个人绝对路径。待办数据、Notion 凭据和页面内容不随仓库分发。
  - today-todo：本地 `~/.dsh/today-todo/tasks.json` 为真源；Notion 同步需自备 token 与数据库，且只写插件自己创建的页面。
  - notion-mcp：仅在环境变量 `NOTION_TOKEN` 存在时启用官方 `@notionhq/notion-mcp-server`。
- `@linxin666/dsh-client-ui-git-graph` 加入 desktop 依赖和 bundle。
- 本机已启用的官方 `@deepseek-ai/dsh-experimental-session-titles-bundle`、`@deepseek-ai/dsh-experimental-forge-bundle` 补入 bundle 声明。

## 配置与 Hook

- Mnemon：`config/mnemon.json` 保存三层策略及本地 embedding 配置。对应环境需要 Ollama 在本机 11434 端口服务并准备 `qwen3-embedding:0.6b`（1024 维，中英多语言；此前的 `nomic-embed-text` 是英文模型，中文记忆检索质量差）；没有该服务时，应在 Mnemon 设置关闭 embedding 或改为自己的服务。换模型后旧向量与新向量不同维度，必须在记忆空间点「补齐」重算，否则混维向量会让相似度失去意义。不会同步 API key 或记忆数据。
- 表情包和 Whale：`config/plugin-preferences.json` 保存通用显示默认值；首次接管已有设置时保留本机字段，后续三方合并保留个人更改。角色、图库路径、订阅、账本和浏览器位置不上传。
- RTK：同步两条 dsh-codex-hooks 定义和 `rtk-hooks.mjs`。路径按目标电脑生成，精确信任在安装时生成，不复制本机信任记录。
- Orca：按用户要求不加入共享 DSH Hook 配置，不复制或分发外部应用生成的文件。本机原有、非受管的外部应用配置不代表仓库依赖。
- 旧 `claude-hooks.json`、`hooks/rtk-gate.js` 当前未挂载，不重新启用；已卸载插件的兼容豁免不同步。
- 全局 AGENTS 已与模板一致，无额外个人段落需要导出。

## 2026-11-08 新增插件

| 插件 | 同步时本机版本 | 说明 |
|---|---|---|
| [billion-context](https://github.com/ranxianglei/billion-context) | 0.1.213 | 本机由插件管理器装入后收入 desktop 依赖与 bundle（MIT）。它在 bundle 层关闭宿主 `compaction-basic` 的 auto，自己接管压缩与预设注入，并给 DeepSeek 行补 `MALFORMED_RESPONSE` 重试；压缩行为以插件配置为准，卸载要从 bundle 移除而不是禁用 gate 条目。 |

## 技能

`config/skill-sources.json` 记录新增 74 项技能的来源和必要修改：27 项 lark 技能、LiClick、find-skills、5 项 Ponytail 附属技能、ub-mode、cangjie-skill、inline-figure、9 项兼容旧入口名的自写 OpenSpec CLI 包装、27 项 Matt Pocock promoted 技能、aisland-teach。自写包装固定调用 1.14.3，未复制缺少独立许可文本的旧包装原文；原有 6 项官方 OpenSpec 技能保留。HTML、JSX、XML、PNG、`.sh` 脚本、`.template` 模板和 LiClick 脚本锁文件一起分发，PNG 按二进制复制。

- 27 项 Matt Pocock 技能来自 mattpocock/skills 提交 `4ae2317`（包版本 1.3.2，MIT，`licenses/Matt-Pocock-Skills-MIT.txt`）；只装上游 promoted 集合，`in-progress`、`misc`、`deprecated` 不分发。原有 6 项同名技能是同一上游旧提交的原文，已升级到当前版本。
- aisland-teach 来自 Aisland-SJL/Aisland-teach 提交 `e11b8fc`（MIT，`licenses/Aisland-Teach-MIT.txt`），是中文优先的交互式教学技能；只分发技能资源，不含上游 README 与 LICENSE 副本。
- 这两项来源另用 `scripts/sync-agent-skills.mjs --apply` 同步到 Claude Code 与 Codex 的全局技能目录，覆盖前整目录备份；DSH 侧仍只由安装器写入。

- lark 技能需安装 `@larksuite/cli` 并使用自己的飞书授权；本机核对版本为 1.0.84。来源为 larksuite/cli，许可文本保留在 `licenses/Lark-CLI-MIT.txt`。
- LiClick 需 Atlas CLI 与自己的登录态；3D 缩略图辅助脚本首次使用时按其 package-lock 安装依赖。生成能力本身由 Atlas/LiClick 服务提供。
- inline-figure 可降级为 HTML；不因此宣称 DSH 已注册 visualize MCP。其 Windows 浏览器路径改为按环境变量发现。
- ub-mode 原样分发上游 `SKILL.md`（unclebob/ub-mode，MIT，许可文本 `licenses/UncleBob-ub-mode-LICENSE.txt`）；它的 crapper、dryer、mutator 质量门是上游独立 CLI，本仓库不安装，也不把这些工具计入验收。
- cangjie-skill 原样分发上游 v2.5.0 通用技能包（kangarooking/cangjie-skill，MIT，许可文本 `licenses/Cangjie-Skill-MIT.txt`）；包内 `BUILD_INFO.json` 记录来源提交 `3adf9e6`，ZIP 的 SHA256 记录在 `config/skill-sources.json`。确定性脚本需要 Python 3.10+ 与 PyYAML（tiktoken、jsonschema 可选），本仓库不代装 Python 依赖；`.template` 模板随技能一起分发。
- 新增共享技能及 RTK 修正版受管部署到 DSH 用户技能根，避免共享目录里的旧规则胜出；不修改其他应用的共享技能。若已有不同的 DSH 同名文件，安装会停止要求解决冲突。
- skills-manager 的来源开关和禁用名单可复用；分类、排序等用户数据保留。

未原样复制的 6 项均有明确理由：computer-use、orca-cli、orchestration 已在本机 DSH 禁用；video-download、sensortower-chart 依赖固定 Linux 路径或其他应用的 token/发送逻辑；reverse-engineer-anything 需要尚未接入本 DSH 的 REA 工具。它们不是未发现的遗漏。

## 安装边界

拉取后仍需运行 `install --dry-run`，任务结束并完全退出 Harness 后再 `install`。安装器不自动登录第三方服务，也不安装系统级 Ollama、Atlas、Lark、Claude 或 Codex CLI。

隔离测试必须给 dsh-meme 设置 `DSH_MEME_HOME`：上游在该目录下拼接 `.dsh`，不采用普通 `DSH_HOME`。建议隔离 home 使用 `测试目录/.dsh`。任意自定义 DSH_HOME 使用者也须配置匹配的 meme 数据根；默认用户目录安装不受影响。
