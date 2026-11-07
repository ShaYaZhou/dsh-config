# 今日待办（dsh-today-todo）

侧栏常驻入口 + 独立面板，一眼看到**今天还没做完的事**。勾选即落盘，配置了 Notion 之后与 Notion 数据库双向同步。

## 它做什么

- **侧栏图标**：挂在左侧栏面板区（无限画布旁边），有待办时图标右上角有个小圆点。
- **独立面板**：点图标进入。显示「未完成 / 已完成 / 接下来」，逾期项单独标红。
- **时间轴，不是单日**：每条待办有开始和截止，跨多天的条目**每天都会出现在列表里**，行上标着区间和「第 3/8 天」；过了截止还没勾就变成「逾期 N 天」。对应 Notion 里就是 `日期` 属性的 start + end。
- **两种视图**：
  - **列表**：按天看，未完成/已完成分组，逾期单独标红。
  - **时间轴（甘特）**：21 天窗口的横向时间轴，每条待办是一条按起止铺开的色条，今天的列高亮，逾期条变橙。左右可翻周，点条或左侧标题就地展开编辑。视图选择会记住。
- **在 Notion 侧也有时间轴**：面板右上角的「Notion 时间轴」直接跳到该数据库的时间轴视图。装好后首次打开会自动在 Notion 里建一个（Notion 的 views 接口 2025-09 起可用），没有就建、有就直接跳。
- **备注自动保存**：编辑区停手 1.2 秒自动落盘（本地 + 尽力同步 Notion），旁边显示「已保存 ✓ / 有改动未保存」。忘了点保存、或者点错点到「取消」都不会再丢备注。
- **备注 + 媒体**：点行体展开编辑区，可以改起止、写备注、直接 `Ctrl/⌘+V` 粘贴截图、或把图片/视频/任意文件拖进去。附件落本地 `media/`，通过插件路由读回来。
- **本地真源**：所有数据落在 `~/.dsh/today-todo/tasks.json`（附件在 `media/`）。断网、token 失效、Notion 属性名写错，面板都照常可用。
- **Notion 双向联动**（可选）：
  - 拉取：抓最近改动的一批页，取和当前视角有交集的条目导入本地。
  - 回写：勾选直接改页面的完成态；改起止直接写 date 的 start/end。
  - 备注：写进页面正文（段落 + 图片/视频块，走 `file_uploads`）。
  - 新增：本地建任务时同时在 Notion 建页（可用 `notionCreateOnAdd: false` 关掉）。
- **给 AI 也留了口**：注册了 `today_todo` 工具（list / get / add / done / undone / remove / move / sync / testNotion），和面板共用同一套逻辑，模型改的就是你在界面上看到的。

### 两个安全边界

1. **只改自己建的页面**：只有本插件创建的 Notion 页面才会被写 body；你自己在 Notion 里写过的页面一个字都不动（仅同步完成态和时间）。
2. **正文被改过就不覆盖**：每次写入记一个内容指纹，下次同步发现页面正文和指纹对不上，就跳过并提示「页面正文在 Notion 里被改过，已跳过覆盖」，绝不吞掉你手写的内容。


## 配置

> 首次使用时，在 Notion 建一个「今日待办」数据库（属性 `名称`/`日期`/`完成`），按下面的方式填好凭据。插件面板顶部会显示「Notion · 上次同步」，看到时间就说明通了。

Notion 凭据有两个入口，**本地凭据文件优先**：

**1. `~/.dsh/today-todo/config.json`（推荐，权限 0600）**

```json
{
  "notionToken": "ntn_…",
  "notionDatabaseId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

改完**立刻生效**，不用重启（插件每次读写前重读这个文件）。

**2. Harness 插件配置**：设置 → 插件 → 今日待办，或直接写 profile 的 `cordis.patch.yml`。优先级低于上面那份文件，适合放非敏感项。

| 字段 | 说明 |
| --- | --- |
| `notionToken` | Notion 个人访问令牌（`ntn_…`）或 internal integration token（`secret_…`）。留空则读环境变量 `NOTION_TOKEN`。**别写进对话里。** |
| `notionDatabaseId` | 要联动的数据库 ID（页面 URL 里那串 32 位十六进制）。 |
| `notionTitleProperty` | 标题属性名，默认 `名称`。 |
| `notionDateProperty` | 日期属性名，默认 `日期`。 |
| `notionDoneProperty` | 完成态属性名，默认 `完成`。 |
| `notionDoneKind` | 完成态载体：`checkbox`（默认）/ `status` / `select`。 |
| `notionDoneTrue` / `notionDoneFalse` | `status`/`select` 下的选项名，默认 `已完成` / `未开始`。 |
| `notionCreateOnAdd` | 新增任务时是否在 Notion 建页，默认 `true`。 |
| `notionSyncMedia` | 备注里的图片/视频是否上传到 Notion 页面正文，默认 `true`（关掉就只同步文字）。 |
| `timezone` | 判断「今天」的时区，默认 `Asia/Shanghai`。 |
| `dataDir` | 数据目录，默认 `~/.dsh/today-todo`（`tasks.json` + `config.json` + `media/`）。 |
| `allowLanAccess` | 允许非本机回环访问插件接口，默认 `false`。 |

用**个人访问令牌（PAT）**的话你本人就有全库权限，不用再逐个分享页面；用传统的 **internal integration token（`secret_…`）** 才需要去 Notion 里把数据库 Share 给那个 integration，否则 API 返回 404。

## 关于 Notion MCP

插件本身直连 Notion REST API（稳定、不依赖模型在环）。如果你还想让 AI 能做搜索、建页面、读数据库结构等更宽的操作，已经另外装好了 `@local/dsh-notion-mcp` 这个桥接包，它把官方 `@notionhq/notion-mcp-server` 挂进 Harness，出现 `mcp__notion__*` 工具。

它**只在环境变量 `NOTION_TOKEN` 存在时才启用**——没 token 的 MCP 服务器只会启动失败并刷一堆重连日志，所以默认关着。

开启方式：

1. 让 Harness 进程能读到 `NOTION_TOKEN`（写进 `~/.dsh/.credentials.yaml` 的 `refs` 段最省事，和 `OPENAI_API_KEY` 一个位置；也可以放到启动环境的 shell profile 里）。
2. 重启 DSH。
3. 设置 → 插件 → Notion MCP，确认那一行从「未启用」变成启用；然后调一个 `mcp__notion__*` 工具验证。

想把 token 直接写死在这条配置里也行，改 profile 的 `cordis.patch.yml`，但注意那个文件会进版本管理/分享，别把 token 提交上去。

## 数据与隐私

- `tasks.json` 是本机明文 JSON，不上传任何地方。
- 插件接口只监听本机回环地址（除非把 `allowLanAccess` 改成 true）。
- Token 只存在于配置/环境变量，接口返回的快照里只有 `configured: true|false`，不含 token 本身。
