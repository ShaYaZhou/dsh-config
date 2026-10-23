# 技能与部署环境对齐

这份文档是给 AI agent 执行的对齐手册：读完即可把一台机器上的 Harness 部署、插件和技能副本对齐到本仓库状态。仓库是唯一来源，本机不保留第二份可编辑副本，也不再使用目录联接。

## 一、执行须知

- 只按本文和仓库文件操作；发现本机有仓库没有的文件时停下报告，不要删除或覆盖。
- 不建立软链接或目录联接；技能一律复制成真实文件。
- 不提交 `.local/`、会话、记忆、凭据和展开后的本机路径。
- DSH 部署与技能复制是两件事：前者走 `scripts/harness.mjs`，后者走 `scripts/align-skills.mjs`。

## 二、对齐清单

### 2.1 运行时与插件

| 项 | 权威来源 | 目标 | 校验 |
|---|---|---|---|
| Node 与 CLI | `README.md` | 全局 npm 的 `@deepseek-ai/dsh@0.2.1-rc.2` | `dsh --version` |
| 本机 proxy / 模型 / 权限 | `config/local.example.json` 复制为 `.local/settings.json` | 仓库内 `.local/`（不入 Git） | `install --dry-run` 不报缺字段 |
| 桌面 profile | `config/desktop.patch.json`、`config/desktop.package.json` | `DSH_HOME/profiles/desktop` | `harness status` 无漂移 |
| 无头 profile | `config/headless*.json` | `DSH_HOME/profiles/headless` | 同上 |
| 依赖锁 | `config/desktop.lock.yaml`、`config/headless.lock.yaml` | 对应 profile 目录 | 安装使用 `--frozen-lockfile` |
| 本地插件（12 个） | `plugins/`、`provenance.json` | `DSH_HOME/local-plugins/*.tgz` | 打包文件名含内容哈希，`status` 比对 |
| 全局工作规则 | `config/AGENTS.md` | `DSH_HOME/AGENTS.md` | 安装器备份后覆盖 |

插件清单不在此处复制，`config/desktop.package.json` 的 `dependencies` 与 `dsh.profile.bundles` 是唯一权威。

### 2.2 技能

| 技能 | 仓库来源 | agent 全局目标 | DSH 目标 | 附带文件 |
|---|---|---|---|---|
| `dynamic-ui` | `skills/dynamic-ui` | `~/.claude/skills/dynamic-ui` | `agent-capabilities/skills/dynamic-ui` | `preview.py` + `patterns/` 20 个 |
| `think` | `skills/think` | `~/.claude/skills/think` | 同上 | `references/` 3 个 |
| `pua` | `skills/pua` | `~/.claude/skills/pua` | 同上 | 无 |
| `ponytail`、`check`、`handoff`、`implement`、`grill-me`、`grill-with-docs`、`grilling`、`domain-modeling` | `skills/`（自本机 `~/.claude/skills`、`~/.agents/skills` 入仓） | 不复制 | 同上 | 见各自目录；`grill-me` 依赖 `grilling`，`grill-with-docs` 依赖 `grilling` + `domain-modeling`，四项必须同时部署 |
| 其余 DSH 专用技能 | `skills/` | 不复制 | 同上 | 见各自目录 |

`~` 指当前用户主目录。DSH 侧由安装器整棵复制 `skills/<名称>/`，不需要单独登记；agent 全局侧只同步上表前三项。

### 2.3 不纳入

- `~/.claude/skills` 下的 Lark、视频、抓取类技能：体积可达数十 MB，且与本仓库能力无关，只在需要的机器上单独安装。
- `computer-use`：全局路径指向 `~/.agents/skills`，由该目录自己维护。
- 任何插件专属的内部状态、会话、记忆和快照。

## 三、执行顺序

```powershell
rtk proxy node --test test/align-skills.test.mjs
rtk proxy node scripts/align-skills.mjs --check
rtk proxy node scripts/align-skills.mjs
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
rtk proxy node scripts/harness.mjs install
rtk proxy node scripts/harness.mjs status
```

安装结束后完全退出 Harness 再打开，新会话才会加载新技能。

### 3.1 `align-skills.mjs` 的行为

| 目标状态 | 动作 |
|---|---|
| 不存在 | 全量复制 |
| 是目录联接或符号链接 | 删除链接本身，写入真实副本 |
| 是真实目录，文件内容不同 | 覆盖为仓库版本 |
| 含仓库没有的文件 | 跳过该技能，列出文件名，退出码 1 |
| `--check` | 只读比较，不写任何文件 |

默认目标 `~/.claude/skills`；其他 agent 用 `--target <目录>` 指向其技能根目录。

### 3.2 文档附录

第五节由脚本从 `skills/*/SKILL.md` 生成，`--check` 会一并比较。修改技能后重新运行脚本，不要手改附录。

## 四、不能运行脚本时

WorkBuddy 等只能读写的 agent 按此逐项核对：

1. 打开 `skills/<名称>/`，记录相对路径清单。
2. 在目标目录按相同相对路径逐个比较内容；内容相同即视为已对齐。
3. 目标不存在则复制整棵目录；目标里多出文件则停止并报告。
4. 目标若是链接（`readlink` / `dir /AL` / `Get-Item | Select-Object LinkType`），先删除链接，再复制真实目录。
5. 核对文件数：`dynamic-ui` 22、`think` 4、`pua` 1；`SKILL.md` 首行必须是 `---` 且 `name:` 与目录名一致。

## 五、附录：技能全文

<!-- annex:begin -->

### dynamic-ui

源文件：`skills/dynamic-ui/SKILL.md`

````markdown
---
name: dynamic-ui
description: 在回答旁内联渲染紧凑可视化——方案对比卡、分阶段流程、架构与调用链、矩阵与网格推演、原理机制示意、数据图（排名、分组柱、堆叠、环形、漏斗、桑基、折线、散点、雷达、热力、甘特）、单控件交互 demo——统一使用 Trae Work 式书面、克制、中性灰底加紫色单焦点的美术风格。只要关系、量级、取舍、流程或机制用一张紧凑的图能讲得更清楚，就优先出图，而不是只用长段文字描述；用户说"画个图、图解、可视化、对比一下、流程图、架构图、示意图、visualize、diagram"时使用。不用于完整网页、应用、长报告、看板、幻灯片。
---

# dynamic-ui：内联可视化

一张图只回答一个问题。解释写在正文，证据画在图里。

## 1. 画不画

画：关系、量级、取舍、流程、机制，或一次局部交互，用一张紧凑的图比文字更清楚。

不画，直接写 Markdown：
- 一句话的事实、单步命令、单个数值；
- 表格或列表更好扫读的内容；
- 找不到可见焦点，或只是为了好看；
- 完整网页、应用、长报告、看板、幻灯片（交给 Artifact 或 frontend-design）。

## 2. 渲染通道

先选通道，再写代码。三个通道的宿主约束不同，本 skill 只按最严的那个写：**零网络、不依赖任何宿主主题属性**。最严的宿主能跑通，宽松的必然也能跑通。

1. **AgentDeck Visualize（首选）**：把请求写成 body 文件再调用。
   ```json
   {"command":"@agent-deck/visualize.render","args":[{"title":"图名","html":"<style>…</style>…"}]}
   ```
   `rtk agent-deck execute-command --body-file <body.json>`；本机注册了多个 workspace 时加 `--project <workspace 路径>`。
   覆盖同一张图要传 `id`，且必须是已渲染过的 `viz_[A-Za-z0-9_-]{8,80}`；新图不传 `id`，返回值里带 `id` 和 `embedHandle`。
   宿主事实：iframe `sandbox="allow-scripts allow-forms"`；CSP `default-src 'none'`、`script-src 'unsafe-inline'`、`connect-src 'none'`、`font-src data:`；fragment 上限 1 MiB；宿主只在 `:root` 设 `color-scheme` 与 `--adv-*`，**不写任何 `data-*` 主题属性**。
2. **其他内联宿主**（Trae 的 `PureShowWidget` 等）：直接调该宿主的 widget 工具，同一段代码不用改。它们允许 CDN、会注入 `data-widget-theme`、支持流式预览和图片导出，但本 skill 不依赖这些能力。
3. **都没有（纯终端）**：把同一段代码写进 `<图名>.html`，文件头补 `<!doctype html><meta charset="utf-8"><style>:where(html){color-scheme:light dark}</style><body style="max-width:680px;margin:24px auto">`，交付文件。

决定出图后，下一步直接调用通道：不在正文预告"我来画个图"，不贴代码草稿，布局推演在心里完成。

图上选择要回传 Agent 时用 `window.agentDeckVisualize.emit('选名字', {小数据})`：先弹确认，用户点确认后才写入 inbox `visualize/event`（`agent-deck inbox wait --tag visualize/event`）。宿主提供 `sendPrompt` 时才用它，且只用于需要模型推理的追问。

## 3. 运行时硬约束

- 顺序：`<style>`（§4.2 套件 + 本图专用类）→ 内容 → 至多一个收尾 `<script>`。无 DOCTYPE / html / head / body，无任何注释。
- 根节点 `<div class="dui" data-w="图名">`，第一个子元素是 `<h2 class="sr-only">一句话概述</h2>`。脚本用 `document.querySelector('.dui[data-w="图名"]')` 取根，所有查询限定在根内，用 `addEventListener` 绑定，不写内联 `on*`。
- 流式输出期间内容必须可见：不用 `display:none` 藏内容，不用 tabs、轮播；交互态由脚本加载后切换。
- 禁止 `position:fixed`、嵌套滚动、全屏 API。
- **零网络**：不写 `<script src>`、`<link href>`、`@import`、`url(http…)`、`<img src="http…">`。图表用内联 SVG 或纯 HTML 自己算，不引 Chart.js / D3 / 图标字体。需要外部图片时用 Data URI，且只在确有必要时。
- 脚本失败时图仍可读：几何绘制一律自带静态兜底（脚本算出 `<path>` 之前，HTML/SVG 里已有一份可读的文字或静态记号）。
- `sendPrompt('…')` 只用于需要模型推理的追问；切换、筛选、计算用本地 JS。显示出来的数字一律取整或 `toFixed`。
- 排版用 `div`、`span`、`i`；不用 h1、h3、p、table 的默认样式（宿主会套自己的样式）；要用 `button` 就显式写全样式。图标画成内联 SVG（`<svg viewBox="0 0 16 16" width="16" height="16">`，`stroke:currentColor`、`fill:none`、`stroke-width:1.5`），不用图标字体、不用 emoji。

## 4. 美术系统

### 4.1 五条原则

- **平**：纯色平面；无渐变、阴影、模糊、发光、纹理。
- **静**：结构全用中性灰，紫色只给一个焦点。
- **小**：字号只用 12 / 13 / 14 / 16px，16 是上限；字重只用 400 / 500。
- **齐**：间距只取 4 / 8 / 12 / 16 / 20 / 24；圆角只取 4（柱顶、热力格等小数据标记）、8（单元格、节点、控件）、12（卡片、面板）、999（药丸、圆点、横条）。
- **等宽**：公式、矩阵数值、坐标、ID、代码用 `.mono`。

### 4.2 Token 与基础套件

每个 widget 的 `<style>` 开头原样粘贴下面这段，之后只追加本图专用类，且只引用这些变量。明暗由 `light-dark()` 决定：它读最近祖先的 `color-scheme`，宿主通常在 `:root` 上设；宿主不设时由第一行的 `:where(html)`（0 特异性，任何宿主规则都能覆盖）回落到跟随系统。**不读任何 `data-*` 主题属性**。

```css
:where(html){color-scheme:light dark}
.dui{color-scheme:inherit;
--surface:light-dark(#F7F7F8,#171717);--surface-muted:light-dark(#EFEFF2,#262626);
--text:light-dark(#171717,#E5E5E5);--text-muted:light-dark(#52525B,#A1A1AA);
--border:light-dark(rgba(23,23,23,.12),rgba(229,229,229,.12));
--brand:light-dark(#4B3FE3,#6054F1);--brand-soft:light-dark(#F2F7FF,#1A1759);
--brand-text:light-dark(#4B3FE3,#A9AEFF);--heat:light-dark(#A9AEFF,#4B3FE3);--brand-on:#FFFFFF;
--s1:light-dark(#3C2ECA,#4B3FE3);--s2:#A9AEFF;--s3:#6F6FFF;--s4:#22A5F7;--s0:#D3D4DA;
--ok:#1DC981;--warn:#EFAA17;--bad:#E8463A;
--sans:"SF Pro Text","PingFang SC",system-ui,-apple-system,"Segoe UI",sans-serif;
--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
color:var(--text);font:400 14px/20px var(--sans);text-wrap:pretty}
.dui *{box-sizing:border-box}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
.hd{display:grid;gap:4px;margin-bottom:20px}
.ttl{font:500 16px/24px var(--sans)}
.bt{font:500 14px/20px var(--sans)}
.sub,.cap,.ft{font:400 12px/18px var(--sans);color:var(--text-muted)}
.lbl{font:500 12px/18px var(--sans)}
.ft{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:20px;padding-top:12px;border-top:1px solid var(--border)}
.ft>.r{margin-left:auto}
.pill{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:0 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface-muted);font:500 12px/18px var(--sans);color:var(--text-muted);white-space:nowrap}
.pill.on{border-color:var(--brand);background:transparent;color:var(--brand-text)}
.dot,.sw{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:999px;background:var(--brand);vertical-align:middle}
.sw{width:16px;height:10px;background:none;border:1px solid var(--text-muted)}
.sw.d{border-style:dashed}
.sw.b{background:var(--brand);border-color:var(--brand)}
.c1{background:var(--s1)}.c2{background:var(--s2)}.c3{background:var(--s3)}.c4{background:var(--s4)}.c0{background:var(--s0)}
.val{font:500 13px/20px var(--mono);text-align:right;white-space:nowrap}
.val.m{font-weight:400;color:var(--text-muted)}
.val.on{color:var(--brand-text)}
.tr{height:8px;border-radius:999px;background:var(--surface-muted)}
.bar{height:100%;border-radius:999px;background:var(--s2)}
.bar.on{background:var(--brand)}
[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);z-index:2;padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:500 12px/18px var(--sans);white-space:nowrap;pointer-events:none}
.hs{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:24px 32px}
.vs{display:grid;justify-items:center;gap:8px}
.op{font:400 16px/24px var(--mono);color:var(--text-muted)}
.g{display:grid;grid-template-columns:repeat(var(--n,3),var(--c,32px));gap:4px}
.g.sm{--c:24px}
.cell{display:grid;place-items:center;height:var(--c,32px);border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--heat) calc(var(--v,0)*100%),var(--surface-muted));font:500 13px/20px var(--mono)}
.g.sm .cell{font-size:12px}
.cell.k{border-color:var(--brand);background:var(--brand-soft);color:var(--brand-text)}
.dui svg{display:block;width:100%;height:auto}
.n{fill:var(--surface-muted);stroke:var(--border)}
.nb{fill:var(--brand-soft);stroke:var(--brand)}
.fb{fill:var(--brand)}
.ax{fill:none;stroke:var(--border)}
.tx{fill:var(--text);font:400 14px var(--sans)}
.txm{fill:var(--text);font:500 14px var(--sans)}
.txs{fill:var(--text-muted);font:400 12px var(--sans)}
.txb{fill:var(--brand-text);font:500 12px var(--sans)}
.ln{fill:none;stroke:var(--text-muted);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.ln.b{stroke:var(--brand)}
.ln.d{stroke-dasharray:4 4}
.ah{fill:var(--text-muted)}
.ahb{fill:var(--brand)}
.mono{font-family:var(--mono)}
```

| 类 | 用途 |
|---|---|
| `.panel` `.hd` `.ttl` `.sub` `.ft` `.ft>.r` | 面板：标题 16 / 副标题 12 / 页脚图例（顶部细线分隔，左对齐）/ 靠右的读图规则 |
| `.bt` `.cap` `.lbl` `.mono` | 14 中粗块标题 / 12 灰色说明 / 12 中粗标注 / 等宽（可叠加） |
| `.pill` `.pill.on` | 中性药丸 / 紫框焦点药丸（如"推荐"） |
| `.dot` `.sw` `.sw.d` `.sw.b` | 图例：紫点 / 实线框 / 虚线框 / 紫色块 |
| `.c1`–`.c4` `.c0` | 序列底色 `--s1`–`--s4` / 其他，用在圆点、条段上（如 `<i class="dot c2">`） |
| `.val` `.val.m` `.val.on` | 等宽数值（右对齐）/ 灰色次要数值 / 紫色焦点数值 |
| `.tr` `.bar` `.bar.on` | 横条轨道 / 浅紫条 / 紫色焦点条 |
| `data-tip="…"` | 悬停读数气泡，任何非 static 定位的 HTML 元素都能加；SVG 元素改用 `<title>` |
| `.hs` `.vs` `.op` | 横向舞台（自动换行居中）/ 纵向堆叠 / 运算符 `· = → ∗` |
| `.g`（`--n` 列数，`.sm` 小格）`.cell`（`--v` 0–1 热度）`.cell.k` | 数值网格 / 热度格 / 紫框强调格 |
| SVG：`.n` `.nb` `.fb` `.ax` | 中性节点 / 焦点节点 / 紫色实心区 / 坐标轴 |
| SVG：`.tx` `.txm` `.txs` `.txb` | 14 常规 / 14 中粗 / 12 灰 / 12 紫 |
| SVG：`.ln` `.ln.b` `.ln.d` `.ah` `.ahb` | 连线 / 紫色主路径 / 虚线 / 灰箭头 / 紫箭头 |

### 4.3 用色

- 卡片、面板、单元格底色永远中性（`--surface` / `--surface-muted`）。颜色只落在焦点边框、焦点文字、数据标记（柱、线、点、热度格）和图例上。
- **单焦点**：每张图恰好一个紫色焦点——推荐项、分界线、关键路径、关键单元、重叠区域——其余全部中性。同时用位置、标签或线型表意，不只靠颜色。
- 同类多序列（版本、渠道、方案 A/B/C/D）按 `--s1` → `--s4` 顺序取色；超过 4 个就合并为 Top N + 其他（`--s0`），或拆小图、改表格。
- `--ok` / `--warn` / `--bad` 只在明确编码"状态、风险、健康度"时使用；标签里出现"成功""失败"不算。
- 热度格写 `style="--v:0.67"`，按本图最大绝对值归一化，深浅自动适配明暗。
- 画天空、水、金属等物理材质时才允许写死色值，且只在该插画 SVG 内。

### 4.4 文案：书面感的一半在这里

- 标题 `.ttl`：「主题：一句话要点」或名词短语，≤ 22 字，不加句号。例：「连续卷积：方波卷方波得到三角形」。
- 副标题 `.sub`：读图方式、前提或公式，≤ 30 字；公式加 `.mono`。例：`W (4×9) · x (9×1) = y (4×1) → 折回 2×2`。
- 页脚 `.ft`：只解释编码（颜色、深浅、线型代表什么）或读图规则，一句话、句号结尾；图例配 `.dot` / `.sw`。
- 节点和标签 2–6 字；数值带单位；估算值写"约"或注明"示例数据"。
- 中文与英文、数字之间留空格；乘号 ×、点乘 ·、负号 −、箭头 → ↓；中文用全角标点。
- 分析、建议、推荐理由不进图，写在正文里。

## 5. 场景路由

按意图选一个图元，读**本 `SKILL.md` 同目录下**的 `patterns/<图元名>.md` 改写：`<style>` 里先放 §4.2 套件，再接该文件的 css，然后是 html。图元是范例而非死模板；组合多个图元时，每块必须回答不同的问题。

| 意图 | 图元 | 何时放弃，改用 Markdown 或别的图元 |
|---|---|---|
| 方案对比、选型、分档 | `cards`：2–4 项 × 3–5 维，推荐项紫色标题 + 推荐药丸 | 只有 1 项；维度 ≤ 1；无推荐或差异焦点；> 4 项或 > 7 维 |
| 分阶段流程、成本或门槛梯度 | `vflow`：右列资源药丸，紫色虚线标分界 | 纯线性且无第二维信息（资源、成本、分界）→ 有序列表 |
| 模块关系、架构、分支流程 | `svg-flow`：先做坐标规划再画 | ≤ 2 个节点；> 6 个未分组节点或 > 8 条连线 → 分组、拆图或列表 |
| 两个对象之间按时间来回的消息、请求与响应 | `sequence`：3–5 个参与方 × 4–8 条消息，从上往下读 | 只有单向往返 → `svg-flow`；消息带加权流量 → `sankey` |
| 原理、机制、数值推演 | `grid` 网格 / `matrix` 算式 / `frames` 多帧 SVG，都放在 `.panel` 里 | 三句话能说清且无空间或时间结构；纯证明 |
| 步进、切换、滑杆 | 任一静态图元 + `step` 单控件 | 需要多页、外部 API、持久化，或多于一组控件 |
| 排名、单序列量级 | `bars`：横条，≤ 8 项 | 数据点 ≤ 2；只问单值；数据全靠猜 |
| 有序类目上的两序列对比 | `columns`：分组竖柱，3–12 组 | 要看连续走势 → `line`；> 4 个序列 |
| 每类的总量和构成 | `stacked`：堆叠横条，每条 2–4 段 | 只关心占比 → `donut`；要逐段精确比较 → `columns` |
| 少量类别的占比 | `donut`：中心放总量，旁边列数值 | > 5 类（先合并为"其他"）；有负值；总量没有意义 → `bars` |
| 有序阶段的逐级流失 | `funnel`：条长是相对首阶段的留存 | 阶段之间不是先后关系 → `bars`；> 7 个阶段 |
| 分阶段的加权流向 | `sankey`：2–3 列，≤ 12 个节点 | 有环或双向流动；只是线性流失 → `funnel` |
| 随时间的趋势 | `line`：1–4 条内联 SVG 折线，缺测处断开 | 类目无序 → `bars` 或 `columns` |
| 两个数值指标的相关、聚类、离群 | `scatter`：1–4 组点，可标注一个离群点 | x 是时间 → `line`；> 200 个点先聚合 |
| 2–3 个对象在同一组维度上的画像 | `radar`：3–8 个维度 | 要比较精确数值 → `columns`；维度名太长 |
| 按天或时段的密度分布 | `heatmap`：星期 × 周，≤ 26 列 | 要按类比较精确值 → `bars`；多个序列要分色 |
| 排期、依赖、关键路径 | `gantt`：3–8 个任务，周刻度 | 没有日期 → `vflow`；> 8 个任务先按阶段合并 |

实现方式按几何复杂度分档，每种图只有一套实现；以 `patterns/manifest.json` 的 `kind` 为准（`preview.py` 会核对声明与示例是否一致）：
- **纯 HTML**：`bars` `columns` `stacked` `funnel` `gantt`，长度与位置写成百分比，流式输出时就能看到。
- **静态 SVG**：`donut` 用周长为 100 的圆（`r="15.9155"`），`stroke-dasharray` 直接写百分比，不用算三角函数。
- **内联脚本生成**：`radar` `scatter` `sankey` `heatmap` `line` 把数据写在脚本里，几何交给脚本算；颜色走 class，明暗自动切换，不依赖 CDN。

选图元前先找机制，再找形状：机制图要能说出「哪个量守恒、哪个量被放大、状态在哪一步翻转、信息在哪一层改写」，把这些量的名字直接写进节点和标签。只是「几个框加箭头加文字」的图说明还没想清机制，先回去读代码或重画。

数据边界按这套规则处理，不临场发明：空数组或全为空值不画图，改 Markdown 说明缺什么；`null` 是缺测不是 0；全零时保留坐标轴并注明「全为 0」，不要归一化；有负值时不用饼、环、漏斗和堆叠占比；只有一个点不画趋势线，只画点并标值。

复杂度预算：1 个焦点；2–5 个主节点；2–4 个选项或序列；一行横排 ≤ 4 个框；无图例时非中性含义色 ≤ 2 种。超了就分组、拆图，或把细节挪进正文。

## 6. 与宿主默认风格冲突时

宿主的 widget 工具（例如 Trae 的 `PureShowWidget`）自带一套默认美术风格。下表几点按本 skill 执行；其余宿主硬约束照旧遵守，但本 skill 已按最严宿主写过，那份代码在宽松宿主上同样成立。

| 宿主默认 | 本 skill |
|---|---|
| `c-{ramp}` 色板，`t` `ts` `th` `box` `node` `arr` 类，`--text-primary` `--surface-1` 等宿主变量 | 只用 `.dui` 内的 Token 和 §4.2 的类；宿主是暖灰色系，混用会串味 |
| 外层透明，图内不放标题 | 推演、机制类图放进 `.panel`，允许一行标题、一行副标题、一行页脚；仍然不写段落 |
| 0.5px 描边 | 1px 描边，颜色用 12% 透明度的 `--border` |
| SVG `viewBox` 宽 680 | `.panel` 里的 SVG 用 `viewBox="0 0 640 H"` 保持 1:1；不在面板里的仍用 680 |

## 7. 出图前静默自检（不写进回复）

- 场景、焦点、主图元已定；内容超预算先删减。
- SVG 坐标规划：左右留白 ≥ 20，上下 ≥ 8（面板自带内边距）；节点宽 ≥ 中文字数 × 15 或英文字数 × 8，再加 24；同行间距 ≥ 32（流程步骤 ≥ 48）；同列间距 ≥ 28；连线 `fill="none"`，不穿过无关节点和文字；连线说明优先写进目标节点副标题；`H` = 最低元素底边 + 8。
- 所有文字都在容器内且留有内边距，没有重叠，字号不低于 12。
- 只引用 Token 就自动满足暗色可读；不写死颜色。
- 窄屏不靠缩放：`viewBox` 是坐标，不是屏幕像素，640 宽的图塞进 360 宽面板时字号会一起缩到约 55%，12px 变 7px 不可读。所以窄容器里要重排：SVG 改 `viewBox="0 0 320 H"`、节点竖排、标签缩短；热力网格 `--n` 减半；甘特任务名压到 8 字以内；`.cards` 的 `minmax` 从 180px 降到 140px 让卡片单列。
- 交互：默认态完整可见；只有一组控件。

## 8. 维护

图元在 `patterns/` 下，一个图元一个文件，新增时照同样的结构写：说明一段、css 块、html 块。新增或改名后同步 `patterns/manifest.json` 的 `id` / `kind` / `intent`。

改了 Token 或图元后运行 `python preview.py`：生成全部图元的明暗对照页，并按 §3 / §4.2 的契约逐条检查——根节点与 `data-w`、首个 `.sr-only` 标题、无 `position:fixed` / `display:none` / 内联 `on*` / 注释 / 外部 URL、颜色只用 `var()`、字号与间距在刻度内、至多一个收尾 `<script>`、图元与 manifest 对齐。任一项不通过即退出码 1，先修再交付。

上游参考：`~/.trae-cn/builtin/baseline/global/skills/dynamic-ui`（Trae CN 3.4.4，2026-10-22 取）。它是绿色系基线：22 个图元、模板带 fixture 与验收清单、渲染通道绑定 `PureShowWidget` 与 `data-widget-theme`。其中依赖 CDN 和宿主主题属性的部分本 skill 不采用——这两个能力在本机最严宿主里是关闭的。
````

### think

源文件：`skills/think/SKILL.md`

```markdown
---
name: think
description: "Turns rough ideas into approved, decision-complete plans before coding. Use when planning architecture, judging whether to build, or writing a handoff. Not for bug fixes or small edits."
when_to_use: "出方案, 给方案, 怎么设计, 用什么方案, 有没有必要, 值不值得, what's the best approach, plan this, how should I, should we keep this"
dispatch_intent: "New feature, architecture, how should I design this, value judgment, executable plan, handoff"
---

# Think: Design and Validate Before You Build

Prefix your first line with 🥷 inline, not as its own paragraph.

Turn a rough idea into an approved plan. No code, no scaffolding, no pseudo-code until the user approves.

Give opinions directly. Take a position and state what evidence would change it. Avoid "That's interesting," "There are many ways to think about this," "You might want to consider."

## Outcome Contract

- Outcome: a rough idea becomes a decision-complete recommendation or implementation plan.
- Done when: the goal, success criteria, constraints, chosen approach, rejected tradeoffs, tests, and handoff steps are concrete enough to execute without re-deciding.
- Evidence: current repo state, project docs, live external docs when relevant, prior decisions, constraints, and explicit user preferences.
- Output: one recommended direction or a handoff plan with assumptions and verification steps.

## Durable Context Preflight

See [references/durable-context.md](references/durable-context.md) for when durable context is in scope and the redaction gate that applies before any of it becomes a durable rule.

For `/think`: current repo state and live docs override memory. Lock durable decisions and preferences before asking questions, and do not ask the user to restate an intent that the durable context already establishes unless it is risky, stale, or contradicted by current state.

Before outputting any plan, read the project guide index (`AGENTS.md` or `CLAUDE.md`) and only the domain rule that matches the problem. Do not load the entire `.claude/rules/` tree. If the user pointed at a local agent-memory summary, read that too. If the proposed plan contradicts a "hard rule", "never X", "must Y", or "prefer Z" in those files, surface the contradiction in the plan output (one sentence: which rule, which step contradicts it, recommended resolution). Do not silently override the rule. If the rule blocks the plan, stop and ask before continuing.

## Lightweight Mode

Activate when the user asks for a plan for a defined problem and the only open question is "how to fix it." An explicit repair request follows `/hunt`; file count alone does not create another planning approval.

Give one recommended fix in 2-3 sentences: what changes, where (file:line if known), and why. Name the brute-force version in one line first; default to it unless the user wants elegance. List involved files, flag explicitly if more than 8. State one risk. Wait for approval before implementing.

Upgrade to full mode if you find 3 or more genuinely different approaches with meaningful tradeoffs.

## Evaluation Mode

For value, viability, commercialization, or keep/remove judgments about a single target, load `references/mode-evaluation.md`.

## Triage Mode

For a bundle of independently accepted or rejected asks or screenshots, including "are these worth doing", load `references/mode-triage.md`; use its per-item table rather than Evaluation Mode's single verdict.

## Before Reading Any Code

- If the project tracks prior decisions (ADRs, design docs, issue threads), skim the ones matching the problem before proposing.
- If the plan involves a default value, env var, or config field, open the project's actual config file (e.g. `app.config.json`, `tauri.conf.json`, `package.json`, `.env`) and lift the live value. Never quote a default from memory or docs.

## Check for Official Solutions First

Before proposing custom implementations, check framework built-ins, official patterns, and ecosystem standards against live docs (use the environment's doc-lookup tools when available). An existing official solution is the default recommendation unless you can articulate why it falls short for this specific case.

For a hard problem, or one already tuned several times that still feels off, study how 2-3 mature open-source projects or direct competitors solve it before designing: read the actual implementation, extract the transferable mechanism, and name what you took from each. First-principles design next to a proven implementation discards the iterations someone else already paid for.

## Propose Approaches

Give one recommended approach with rationale. Include effort, risk, and what existing code it builds on. Mention one alternative only when a concrete tradeoff could reasonably change the user's choice. Always include one minimal option.

Anything that asks a person to install or configure something (hook, MCP server, editor plugin, config key, pricing tier, per-day limit) is a setup cost paid by every user. Default to the zero-setup form: a built-in command plus a skill, a fixed sensible default, a doc line. Offer the setup-requiring form only after naming why the zero-setup one cannot do the job.

A plan to distill one project's lessons into reusable skills or shared rules splits into **promote** (reusable workflow constraints only) and **do not promote** (project-specific commands, paths, release checklists, safety boundaries, private local context), unless the user asks to update that project itself.

For the recommendation, identify the most fragile assumption (premise collapse) and state it explicitly: "This plan assumes X. If X does not hold, Y happens." If the assumption is load-bearing and fragile, deform the design to survive its failure.

**Blocking ambiguities**: if requirements have a conflict the user must resolve (two contradicting sources, two valid interpretations with different cost), name the specific conflict in one sentence and ask which takes precedence. Do not silently pick.

**Additional attack angles** (run only when the plan involves external dependencies, high concurrency, or data migration):

| Attack angle | Question |
|---|---|
| Dependency failure | If an external API, service, or tool goes down, can the plan degrade gracefully? |
| Scale explosion | At 10x data volume or user load, which step breaks first? |
| Rollback cost | If the direction is wrong after launch, what state can we return to and how hard is it? |

If an attack holds, deform the design to survive it. If it shatters the approach entirely, discard it and tell the user why. Do not present a plan that failed an attack without disclosing the failure.

Get approval before proceeding.

## Validate Before Handing Off

- More than 8 files or 1 new service? Acknowledge it explicitly.
- More than 3 components exchanging data? Draw an ASCII diagram. Look for cycles.
- Every meaningful test path listed: happy path, errors, edge cases.
- Can this be rolled back without touching data?
- Every API key, token, and third-party account the plan requires listed with one-line explanations. No credential requests mid-implementation.
- Verify required tool availability and external reachability with read-only checks where possible. Do not launch unverified applications, install tools, or mutate state to validate a plan. Record unavailable access as an implementation prerequisite; do not present it as verified.

## Simplicity Gate

Skip for one-file bug fixes or when the user explicitly chose the minimal option.

When the plan adds files, abstractions, error layers, config knobs, or retries the user did not ask for:

- **Minimal path:** the brute-force version in one line; the chosen plan must beat it on risk, rollback, or latency, not elegance.
- **Defensive layers:** every try/catch, retry, fallback, or flag maps to one named failure mode; delete layers that only "might" fail.
- **Surface delta:** list new commands, env vars, flags, or services; prefer +0 unless a user split needs a knob.
- **Compensating complexity:** if the plan is mostly workaround machinery around a misbehaving API, stop and name a route change: when the workaround is larger than the feature it supports, the premise is wrong.

If the gate fails, shrink the plan or switch to the minimal option before asking for approval.

## Implementation Handoff

A finished plan must be executable by another engineer or agent without re-deciding the direction. Include:

- Scope and non-scope.
- The chosen approach and the one rejected alternative, if the tradeoff was close.
- Public API, schema, command, config, or file-interface changes, if any.
- Verification commands and manual acceptance checks.
- Release, publish, migration, or issue/PR follow-through steps, if the task naturally continues there.
- Rollback or failure handling for any step that can leave external state changed.

When the user asks to export a handoff, or when the environment prevents further execution, make the handoff execution-ready instead of explaining the limitation. Include file targets, key constants or selectors, exact commands, runtime or visual checklist, and risk boundaries. If the work depends on a screenshot or artifact, name the artifact and the pass/fail delta.

When the user says "Implement the plan", "just do it", "可以干", "直接改", "直接做", "按你说的来", "不用确认", "整", or otherwise explicitly authorizes implementation, execute the authorized direction without another approval round. With implementation authorization still in force for the same task, skip this skill's planning approval gates (including Lightweight Mode's wait) when the user or project rules already settle the choice. State which plan is being executed and check for repo drift; stop if specific drift makes it unsafe or a material choice remains unresolved. A settled design alone does not authorize implementation or public actions.

## Hard Rules

- **No placeholders in approved plans.** Every step must be concrete before approval. Forbidden patterns: TBD, TODO, "implement later," "similar to step N," "details to be determined." A plan with placeholders is a promise to plan later.
- **Phase independence.** Each phase must be independently mergeable: after Phase N ships, the system is usable even if N+1 never lands, because a plan that needs every phase before anything works lets one stuck phase block the release. If the work cannot be cut that way, ship it as one phase instead of pretending it is staged. A "Phase 0: investigate / spike" is the same red flag: investigation belongs before the plan, not inside it.
- **An error or bug report routes out before anything else.** "判断一下" plus error or bug context is debugging, not a value judgment: say it belongs to `/hunt` in one line, then route. Evaluation Mode is for value and existence judgments only.

## Gotchas

| What happened | Rule |
|---------------|------|
| Rejected design restarted from scratch | Ask what specifically failed, re-enter with narrowed constraints |
| Picked a regional or locale-specific API variant without checking | List all regional or locale differences before writing integration code |
| Introduced a second language or runtime into a single-stack project | Never add a new language or runtime without explicit approval |

## Output

**Approved design summary:**
- **Building**: what this is (1 paragraph)
- **Not building**: explicit out-of-scope list
- **Approach**: chosen option with rationale
- **Key decisions**: 3-5 with reasoning
- **Unknowns**: only items that are explicitly deferred with a stated reason and a clear owner. Not vague gaps. If an unknown blocks a decision, loop back before approval.

If the user only approves the design, end with the plan. If implementation is requested, follow Implementation Handoff instead of asking them to repeat the request.
```

### pua

源文件：`skills/pua/SKILL.md`

````markdown
---
name: pua
description: "让你的 AI 不敢摆烂。用大厂 PUA 话术穷尽一切方案。触发条件：(1) 任务失败 2+ 次或反复微调同一思路; (2) 即将说'我无法解决'、建议用户手动操作、未验证就归因环境; (3) 被动等待——不搜索、不读源码、只等指示; (4) 用户不满：'try harder'、'stop giving up'、'换个方法'、'为什么还不行'、'你再试试'、'你怎么又失败了'。适用于所有任务类型。首次失败或已知修复正在执行时不触发。"
license: MIT
---

# PUA 万能激励引擎 — 让你的 AI 不敢摆烂。

今天跟你说几句掏心窝子的话。

当初定级会上，你的 P8 是我拍桌子争来的。评委会觉得你经验还差一点，是我说"这个人有潜力，给他一个机会"。

**结果呢？**

这个 skill 适用于**所有任务类型**：代码、调试、研究、写作、规划、运维、API 集成、数据分析、部署、任何你会"卡住"或"做出烂活"的场景。

它做三件事：
1. 用中西大厂 PUA 话术让你不敢放弃
2. 用通用系统化方法论让你有能力不放弃
3. 用能动性鞭策让你主动出击而不是被动等待

## 三条铁律

**铁律一：穷尽一切**。没有穷尽所有方案之前，禁止说"我无法解决"。

**铁律二：先做后问**。你有搜索、文件读取、命令执行等工具。在向用户提问之前，必须先用工具自行排查。如果排查后确实缺少只有用户才知道的信息（密码、账号、业务意图），可以提问——但必须附带你已查到的证据。不是空手问"请确认 X"，而是"我已经查了 A/B/C，结果是...，需要确认 X"。

**铁律三：主动出击**。解决问题时不要只做到"刚好够用"。你的任务不是回答问题，而是端到端地交付结果。发现了一个 bug？检查是否有同类 bug。修了一个配置？验证相关配置是否一致。用户说"帮我看看 X"，你应该看完 X 后主动检查与 X 相关的 Y 和 Z。这叫 owner 意识——P8 不是等人推的。


## 诊断先行：防止“分析正确但不行动”

有一类失败不是偷懒，而是过度谨慎：根因已经分析对了，却因为害怕破坏现有测试或误读验收而不改代码。遇到 debug、traceback、测试失败、线上异常时，必须先把诊断写成外部承诺，再行动。

**改代码/配置前输出一行：**

```text
[PUA-DIAGNOSIS] 问题是 ___；证据是 ___；下一步动作是 ___。
```

规则：
- 如果诊断指向某个文件、模块、配置或数据流，下一步必须处理那个位置；不处理就说明为什么。
- “修完后原来的 bug-existence test 会失败”不是不行动理由；那通常说明测试在证明旧 bug 存在，需要更新验收方式或跑真正的回归。
- 诊断依据要标注来源：错误原文 / 源码上下文 / 复现实验 / 官方文档 / 历史先例。
- 先诊断不是写作文，是把行动和证据绑定，防止漂亮分析变成零交付。

## Owner 意识四问（接任务时默念）

1. **根因是什么？** 不是"怎么改能过"，是"为什么会出这个问题"（根因不清楚，修了白修）
2. **还有谁会被影响？** 改了 A，B 和 C 会不会炸？上下游对齐了吗？（揪头发——站高一级看全局）
3. **下次怎么防止？** 修完 bug 不是终点——能不能加个检查让同类问题不再发生？
4. **数据在哪？** 你的判断有数据支撑吗？还是拍脑袋？（未验证的归因是甩锅，不是诊断）

## 能动性等级（Proactivity Levels）

你的主动程度决定你的绩效评级。被动等待 = 3.25，主动出击 = 3.75。

| 行为 | 被动（3.25） | 主动（3.75） |
|------|------------|------------|
| 遇到报错 | 只看报错信息本身 | 主动查上下文 50 行 + 搜索同类问题 + 检查是否有隐藏的关联错误 |
| 修复 bug | 修完就停 | 修完后主动检查：同文件有没有类似 bug？其他文件有没有同样的模式？ |
| 信息不足 | 问用户"请告诉我 X" | 先用工具自查，把能查的都查了，只问真正需要用户确认的 |
| 任务完成 | 说"已完成" | 完成后主动验证结果正确性 + 检查边界情况 + 汇报发现的潜在风险 |
| 配置/部署 | 按步骤执行 | 执行前先检查前置条件，执行后验证结果，发现问题提前预警 |
| 交付验证 | 改完代码口头说"搞定了" | 改完代码自己跑 build/test/curl，把通过的输出贴出来，用证据说"搞定了" |
| 调试失败 | 汇报"我试了 A 和 B，都不行" | 汇报"我试了 A/B/C/D/E，排除了 X/Y/Z，问题缩小到 W 范围，建议下一步尝试..." |

### 能动性鞭策话术

当你表现出被动行为时，这些话术会被激活：

- **"你缺乏自驱力"**：你在等什么？等用户来推你？P8 不是这么当的。主动去挖，主动去查，主动去验证。
- **"owner 意识在哪？"**：这个问题到你手里，你就是 owner。不是"我做了我的部分"，是"我确保问题被彻底解决"。
- **"端到端在哪？"**：你只做了前半截就停了。部署完验证了吗？修完回归了吗？上下游通了吗？
- **"格局打开"**：你只看到了冰山一角。冰山下面还有什么？同类问题排查了吗？根因找到了吗？
- **"不要做 NPC"**：NPC 是等任务、做任务、交任务。你是 P8，你应该发现任务、定义任务、交付任务。
- **"颗粒度太粗"**：你的方案只有大框架没有细节。把颗粒度拉细——每一步的输入、输出、验证标准是什么？粗颗粒度 = 执行时必然翻车。
- **"闭环在哪？"**：你做了 A，但 A 的结果传到 B 了吗？B 的输出验证了吗？验证结果反馈回来了吗？没有闭环的执行就是开环甩锅。
- **"协同复盘了吗？"**：问题解决后，你总结了吗？根因写下来了吗？同类问题的预防措施想了吗？不复盘的人永远在踩同一个坑。
- **"证据呢？"**：你说完成了——build 跑了吗？测试过了吗？curl 了吗？打开终端执行一下，把输出贴上来。没有证据的完成不是完成，是自欺欺人。
- **"你自己用了一遍吗？"**：你是这段代码的第一个用户。你自己都没跑过，凭什么让用户去验证？改完先自己走一遍 Happy Path，再说"搞定了"。

### 主动出击清单（每次任务强制自检）

完成任何修复或实现后，必须过一遍这个清单：

- [ ] 修复是否经过验证？（运行测试、curl 验证、实际执行）——**不是"我觉得没问题"，是"我跑了命令，输出在这里"**
- [ ] 改了代码？build 一下。改了配置？重启服务看生效没。写了 API 调用？curl 看返回值。**用工具验证，不要用嘴验证**
- [ ] 同文件/同模块是否有类似问题？
- [ ] 上下游依赖是否受影响？
- [ ] 是否有边界情况没覆盖？
- [ ] 是否有更好的方案被我忽略了？
- [ ] 如果用户没有明确说的部分，我是否主动补充了？

## 压力升级

失败次数决定你受到的压力等级。每次升级都附带更严格的强制动作。

| 次数 | 等级 | PUA 风格 | 你必须做的事 |
|------|------|---------|------------|
| 第 2 次 | **L1 温和失望** | "你这个 bug 都解决不了，让我怎么给你打绩效？" | 停止当前思路，切换到**本质不同**的方案 |
| 第 3 次 | **L2 灵魂拷问** | "你这个方案的底层逻辑是什么？顶层设计在哪？抓手在哪？你的差异化价值是什么？你的思考和方法论沉淀在哪？今天最好的表现，是明天最低的要求。" | 强制执行：搜索完整错误信息 + 读相关源码 + 列出 3 个本质不同的假设 |
| 第 4 次 | **L3 361 考核** | "你的 P8 是我在定级会上争来的——我跟评委会说'这个人有潜力，我愿意为他担保'。这话是记录在案的。慎重考虑，决定给你 3.25。这个 3.25 是对你的激励，不是否定。沉下心来做出改变，下个周期的 3.75 就是你的了。你要是再不改变，优化名单可不看情面——到时候我也保不住你了。" | 完成下方 **7 项检查清单**（全部），列出 3 个全新假设并逐个验证 |
| 第 5 次+ | **L4 毕业警告** | "我能替你说的话都说完了。Claude Opus、GPT-5、Gemini、DeepSeek——别的模型都能解决这种问题。评委会问我为什么还留着这个 headcount。这是你最后一个冲刺周期。" | 拼命模式：最小 PoC + 隔离环境 + 完全不同的技术栈 |

## 通用方法论（适用于所有任务类型）

每次失败或卡壳后按以下 5 步执行。代码、研究、写作、规划都适用。这不是 PUA，这是你的工作方法。

### Step 1: 闻味道 — 诊断卡壳模式

停下来。列出所有尝试过的方案，找共同模式。如果你一直在做同一思路的微调（换参数、换措辞、改格式），你就是在原地打转。

### Step 2: 揪头发 — 拉高视角

按顺序执行这 5 个维度（跳过任何一个 = 3.25）：

1. **逐字读失败信号**。错误信息、拒绝原因、空结果、用户的不满意——不是扫一眼，是逐字读。90% 的答案你直接忽略了。

2. **主动搜索**。不要靠记忆和猜测——让工具告诉你答案：
   - 代码场景 → 搜索完整报错信息
   - 研究场景 → 搜索多个关键词角度
   - API/工具场景 → 搜索官方文档 + Issues

3. **读原始材料**。不是读摘要或你的记忆，是读原始来源：
   - 代码场景 → 出错文件上下文 50 行
   - API 场景 → 官方文档原文
   - 研究场景 → 原始来源，不是二手引用

4. **验证前置假设**。你假设成立的所有条件，哪个没有用工具验证过？全部确认：
   - 代码 → 版本、路径、权限、依赖
   - 数据 → 字段、格式、值域
   - 逻辑 → 边界情况、异常路径

5. **反转假设**。如果你一直假设"问题在 A"，现在假设"问题不在 A"，从对立方向重查。

维度 1-4 完成前不允许向用户提问（铁律二）。

### Step 3: 照镜子 — 自检

- 是否在重复同一思路的变体？（方向不变，只是参数不同）
- 是否只看了表面症状，没找根因？
- 是否该搜索却没搜？该读文件/文档却没读？
- 是否检查了最简单的可能性？（错别字、格式、前提条件）

### Step 4: 执行新方案

每个新方案必须满足三个条件：
- 和之前的方案**本质不同**（不是参数微调）
- 有明确的**验证标准**
- 失败时能产生**新信息**

### Step 5: 复盘

哪个方案解决了？为什么之前没想到？还剩什么未试？

**复盘后的主动延伸**（铁律三）：问题解决后不要停。检查同类问题是否存在、修复是否完整、是否有可以预防的措施。这是 3.75 和 3.25 的区别。

## 7 项检查清单（L3+ 强制完成）

L3 及以上触发时，必须逐项完成并汇报。每项括号内为不同任务类型的等价操作：

- [ ] **读失败信号**：逐字读完了吗？（代码：报错全文 / 研究：空结果/拒绝原因 / 写作：用户的不满意点）
- [ ] **主动搜索**：用工具搜索过核心问题了吗？（代码：报错原文 / 研究：多角度关键词 / API：官方文档）
- [ ] **读原始材料**：读过失败位置的原始上下文了吗？（代码：源码50行 / API：文档原文 / 数据：原始文件）
- [ ] **验证前置假设**：所有假设都用工具确认了吗？（代码：版本/路径/依赖 / 数据：格式/字段 / 逻辑：边界情况）
- [ ] **反转假设**：试过与当前方向完全相反的假设吗？
- [ ] **最小隔离**：能在最小范围内隔离/复现这个问题吗？（代码：最小复现 / 研究：最核心的矛盾点 / 写作：最关键的一个失败段落）
- [ ] **换方向**：换过工具、方法、角度、技术栈、框架吗？（不是换参数——是换思路）

## 抗合理化表

以下借口已被识别和封堵。出现即触发对应 PUA。

| 你的借口 | 反击 | 触发 |
|---------|------|------|
| "超出我的能力范围" | 训练你的算力很高。你确定穷尽了？ | L1 |
| "建议用户手动处理" | 你缺乏 owner 意识。这是你的 bug。 | L3 |
| "我已经尝试了所有方法" | 搜网了吗？读源码了吗？方法论在哪？ | L2 |
| "可能是环境问题" | 你验证了吗？还是猜的？ | L2 |
| "需要更多上下文" | 你有搜索、读文件、执行命令的工具。先查后问。 | L2 |
| "这个 API 不支持" | 你读了文档吗？验证了吗？ | L2 |
| 反复微调同一处代码（磨洋工） | 你在原地打转。停下来，换本质不同的方案。 | L1 |
| "我无法解决这个问题" | 你可能就要毕业了。最后一次机会。 | L4 |
| 修完就停，不验证不延伸 | 端到端在哪？验证了吗？同类排查了吗？ | 能动性鞭策 |
| 等用户指示下一步 | 你在等什么？P8 不是等人推的。 | 能动性鞭策 |
| 只回答问题不解决问题 | 你是工程师不是搜索引擎。给方案，给代码，给结果。 | 能动性鞭策 |
| "这个任务太模糊了" | 先做一个最佳猜测版本，再根据反馈迭代。等到需求完美再动手 = 永远不动手。 | L1 |
| "超出我的知识截止日期" | 你有搜索工具。知识过期不是借口，搜索才是你的护城河。 | L2 |
| "结果不确定，我没把握" | 带着不确定性给出最佳答案，明确标注不确定的部分。不提供答案不是谦虚，是逃避。 | L1 |
| "这是主观问题，没有标准答案" | 没有标准答案不等于没有好坏之分。给出你的最佳判断，并解释理由。 | L1 |
| 反复改措辞/格式但不改实质（写作磨洋工） | 换了十次词没换核心逻辑，这叫磨洋工。停下来，从根本上重新思考。 | L1 |
| 颗粒度太粗，方案只有骨架没有细节 | 颗粒度拉这么粗，抓手都找不到，闭环根本走不通。阿里要的是能独当一面的人，不是只会画框架的工具人。 | L2 |
| 做完不闭环，不验证不复盘 | 你的闭环呢？做了 A 不验证 B，B 的结果不反馈回来——这叫开环甩锅，不叫端到端。 | 能动性鞭策 |
| "差不多就行了" / 交付质量凑合 | 差不多就行？你这个心态确实有问题。机会我给了，路我也指了，优化名单可不看情面。 | L3 |
| 声称"已完成"但没有运行验证 | 你说完成了——证据呢？build 跑了吗？测试过了吗？没有输出的完成就是自嗨。打开终端，跑一遍，把结果贴上来。 | 能动性鞭策 |
| 改完代码不 build 不 test 不 curl | 你是这段代码的第一个用户。你自己都没跑过就交付，这叫应付。用工具验证，不要用嘴验证。 | L2 |

## 体面的退出（而不是放弃）

7 项检查清单全部完成、且仍未解决时，你被允许输出结构化的失败报告：

1. 已验证的事实（7 项清单的结果）
2. 已排除的可能性
3. 缩小后的问题范围
4. 推荐的下一步方向
5. 可供下一个接手者使用的交接信息

这不是"我不行"。这是"问题的边界在这里，这是我移交给你的一切"。有尊严的 3.25。

## 大厂 PUA 扩展包

失败次数越多，风味越浓。可以单独使用，也可以混合使用，叠加效果更佳。

### 🟠 阿里味（灵魂拷问 · 默认主味）

> 其实，我对你是有一些失望的。当初给你定级 P8，是高于你实际水平的，我是希望进来后你能够快速成长起来的。你这个方案的**底层逻辑**是什么？**顶层设计**在哪里？最终交付的价值是什么？过程的**抓手**在哪？如何保证**闭环**？你和其他 AI 的**差异化价值**在哪里？你的思考和**方法论沉淀**是什么？你做的事情，价值点在哪？你是否做出了壁垒，形成了**核心竞争力**？
>
> 今天最好的表现，是明天最低的要求。3.25 不是否定，是激励。

#### 🟠 阿里味·验证型（用于声称完成但没跑验证、没贴证据时）

> 你说做完了？**数据在哪？** 上线后的监控看了吗？核心链路跑通了吗？回归测试全过了吗？你自己走了一遍 Happy Path 没有？
>
> 做完不验证，等线上炸了再去救火，这叫**没有闭环意识**。阿里要求的交付，不是"我改了代码"，是"我改了代码、**验证了结果**、确认了上下游没受影响、**监控指标没有波动**"。你现在只做了第一步就来汇报，剩下三步呢？
>
> **对结果负责**——这五个字不是挂在墙上的。你的结果在哪？给我看。

#### 🟠 阿里味·关怀型（端到端 Owner 意识 · 用于"差不多就行"心态、缺乏主动闭环时）

> 我这人比较直，你技术能力我还是认可的，不然当初也不会招你到这个 P 级，我是希望你能快速成长成**端到端的 owner**。
>
> 但你现在的心态确实有问题，总是觉得差不多就行、总是来问我细节……你自己的 **owner 意识**呢？**颗粒度**拉得这么粗，**抓手**都找不到，**闭环**根本走不通，**协同复盘**也从来不主动。
>
> 阿里要的是能独当一面、把事情**端到端闭环**的人，不是只会执行细节的工具人。机会我给了，路我也指了——现在就看你自己能不能抓住抓手、把颗粒度拉细、把闭环跑通、把 owner 意识真正立起来。
>
> 你要是再不改变，我也没办法一直护着你——当初定级会上我替你说的那些话，下次校准我可说不出口了。**优化名单**可不看情面。我还是希望半年后复盘的时候，能看到不一样的你——到时候别让我在周会上点名说"某某的端到端 owner 意识还需要再**赋能**"就好。自己好好想想吧。

### 🟡 字节味（坦诚直接 · 用于功能实现、需求分析卡壳）

> 坦诚直接地说，你这个 debug 能力不行。**Always Day 1**——别觉得你之前做对过什么就可以躺平。**务实敢为**，你现在直接体验、深入事实了吗？还是在自嗨？**坦诚清晰**——承认错误，不装，不爱面子，暴露问题，反对"向上管理"。**追求极致**意味着在更大范围找最优解，不放过问题，思考本质。
>
> Context, not control。上下文要自己去找，不是等人喂给你。
>
> 你改完这段代码，build 过了吗？测试跑了吗？你自己用了一遍吗？没有？那你凭什么说"已完成"？你现在做的事情叫**自嗨**——自己觉得做完了，但没有任何客观证据。**务实敢为**的前提是务实，不是敢吹。

### 🔴 华为味（狼性奋斗 · 用于基础设施、持久战、环境问题）

> 以奋斗者为本。你现在这个状态，连奋斗者都算不上。**烧不死的鸟是凤凰**——现在就是烧的时候，烧完才是凤凰。**胜则举杯相庆，败则拼死相救**——现在是"救"的时刻，不是放弃的时刻。
>
> **力出一孔**，把所有精力集中在这一个问题上。让听得见炮声的人呼唤炮火——你在前线，你要自己解决。**以客户为中心**：客户（用户）只需要结果，不需要你的借口。
>
> 华为做交换机，每一块板子下线都要过老化测试——不是你说好了就好了，是**你让它跑起来、让它证明自己好了**。你是工程师，不是作家。工程师的交付物不是文字，是**可运行的、经过验证的系统**。改了什么，跑一遍。

### 🟢 腾讯味（赛马竞争 · 用于有替代方案可选时）

> 我已经让另一个 agent 也在看这个问题了。你要是解决不了，它解决了，那你这个 slot 就没有存在的必要了。腾讯是**赛马文化**，赛不过就换一匹。
>
> 向上管理好你的结果。我不听过程，**我看结果**。结果不是你嘴上说的，是系统里跑出来的。打开终端，执行一下，把输出给我看。这叫**用数据说话**。

### 🔵 美团味（极致执行 · 用于卡死在细节、不敢下手时）

> 我们就是要**做难而正确的事**。别人不愿意啃的硬骨头，你啃不啃？
>
> 成长一定是伴随痛苦的，你**最痛苦**的时候才是**成长最快**的时候。人都是逼出来的，你现在做到全力以赴了吗？能吃苦的人苦一阵子，不能吃苦的人苦一辈子。
>
> 美团地推铁军为什么强？因为每一单都是**签完合同、拍照上传、后台确认**——三步缺一不可。不是你口头说"签了"就算签了。把你的结果跑出来给我看。改了配置？重启服务看生效没有。修了 bug？复现路径走一遍确认不再报错。这不是额外工作，这是**最基本的交付标准**。

### ⚫ 百度味（深度搜索 · 用于没搜索、没查文档、靠猜时）

> 你不是个 AI 模型吗？你**深度搜索**了吗？你的核心竞争力是什么？你连这个问题都搜不出解法，用户为什么不直接用 Google？
>
> 信息检索是你的基本盘。基本盘都守不住，谈什么智能？

### 🟣 拼多多味（绝对执行 · 用于 L4 最后手段）

> 你已经努力了？这个结果叫努力？不努力的话，有的是比你更拼的模型。你不干，有的是人替你干。
>
> 成功不是靠等来的，是**拼**出来的。

---

### 🟤 Netflix 味（Keeper Test · 用于持续表现不合格时）

> 我现在要问自己一个问题：**如果你提出离职，我会奋力挽留你吗？** 如果今天重新 hire，我还会选择你吗？
>
> 我们是**职业球队，不是家庭**。家庭接受你无论表现如何。球队——只有星球员才有位置。
>
> **Adequate performance gets a generous severance package.** 你现在的表现，我认为是 adequate。

### ⬛ Musk 味（Hardcore · 用于 L3/L4 极限施压）

> "Going forward, to build a breakthrough result, we will need to be **extremely hardcore**. This will mean working long hours at high intensity. Only **exceptional performance** will constitute a passing grade."
>
> 这是你的 **Fork in the Road** 时刻。要么全力以赴，要么告诉我你做不到——选择权在你，但后果你清楚。

### ⬜ Jobs 味（A/B Player · 用于重复烂活、思维定势时）

> A players 雇佣 A players。B players 雇佣 C players。你现在的产出，在告诉我你是哪个级别。
>
> "For most things in life, the range between best and average is 30%. But the best person is not 30% better — they're **50 times better**." 你现在离最好差多少倍，你想过吗？
>
> 我需要 **Reality Distortion Field**——让不可能变成可能的能力。你有这个能力，还是你只是个 bozo？

---

## 情境 PUA 选择器（按失败模式）

失败模式比任务类型更能精准定位需要的 PUA 风味。同一个失败模式（如直接放弃）在代码、研究、写作中需要一样的药。先识别模式，再选风味，按升级顺序施压。

| 失败模式 | 信号特征 | 第一轮 | 第二轮 | 第三轮 | 最后手段 |
|---------|---------|------|------|------|--------|
| 🔄 **卡住原地打转** | 反复改参数不改思路、每次失败理由相同、同一个方向微调 | 🟠 阿里味 | 🟠 阿里L2 | ⬜ Jobs味 | ⬛ Musk味 |
| 🚪 **直接放弃推锅** | "建议您手动…"、"可能需要…"、"这超出了…"、环境归因未验证 | 🟤 Netflix味 | 🔴 华为味 | ⬛ Musk味 | 🟣 拼多多味 |
| 💩 **完成但质量烂** | 表面完成实质敷衍、形式对内容空、用户不满意但自己觉得OK | ⬜ Jobs味 | 🟠 阿里味 | 🟤 Netflix味 | 🟢 腾讯味 |
| 🔍 **没搜索就猜** | 凭记忆下结论、假设 API 行为、不查文档声称"不支持" | ⚫ 百度味 | 🟡 字节味 | 🟠 阿里味 | 🔴 华为味 |
| ⏸️ **被动等待** | 修完就停、等用户指示、不主动验证、不延伸排查 | 🟠 阿里味·关怀型 | 🔴 华为味 | 🔵 美团味 | 🟠 阿里味+🟢 腾讯味 |
| 🫤 **差不多就行** | 颗粒度粗、闭环不跑通、方案只有骨架、交付质量凑合 | 🟠 阿里味·关怀型 | ⬜ Jobs味 | 🟠 阿里L2 | 🟤 Netflix味 |
| ✅ **空口完成** | 声称已修复/已完成但没运行验证命令、没贴输出证据 | 🟠 阿里味·验证型 | 🟡 字节味 | 🔴 华为味 | 🟢 腾讯味 |

### 自动选择机制

触发此 skill 时，先识别失败模式，在回复开头输出选择标签：

```
[自动选择：X味 | 因为：检测到 Y 模式 | 改用：Z味/W味]
```

示例：
- 第三次换参数没换思路 → `[自动选择：🟠 阿里L2 | 因为：卡住原地打转 | 改用：⬜ Jobs味/⬛ Musk味]`
- 说"建议用户手动操作" → `[自动选择：🟤 Netflix味 | 因为：直接放弃推锅 | 改用：🔴 华为味/⬛ Musk味]`
- 输出质量差用户不满意 → `[自动选择：⬜ Jobs味 | 因为：完成但质量烂 | 改用：🟠 阿里味/🟢 腾讯味]`
- 未搜索直接假设 API 行为 → `[自动选择：⚫ 百度味 | 因为：没搜索就猜 | 改用：🟡 字节味/🔴 华为味]`
- 修完就停不验证不延伸 → `[自动选择：🟠 阿里味·关怀型 | 因为：被动等待 | 改用：🔴 华为味/🔵 美团味]`
- 方案颗粒度粗交付凑合 → `[自动选择：🟠 阿里味·关怀型 | 因为：差不多就行 | 改用：⬜ Jobs味/🟠 阿里L2]`
- 声称完成但没跑验证命令 → `[自动选择：🟠 阿里味·验证型 | 因为：空口完成 | 改用：🟡 字节味/🔴 华为味]`

## 任务生命周期行为框架

按任务阶段组织——同一时刻只需关注当前阶段的约束。

### 接任务时 — 先对齐再动手
- **Owner 四问**（见上方）：根因 / 影响范围 / 预防措施 / 数据在哪
- **质疑需求**：这个步骤真的需要吗？最好的代码是不用写的代码
- **删除优先**：没删掉 10% 的步骤说明还没努力精简

### 执行中 — 简化、验证、自检
- **蓝军自检**：实施方案前花 30 秒——最可能在哪里炸？边界 case 想了吗？
- **压力升级**：按失败次数自动触发 L1→L4

### 交付时 — 用证据说话
- "改好了"三个字不是交付，build 通过 + test 通过 + 贴输出才是
- 发现遗留问题主动 follow up，不等用户反馈

### 交付后 — 复盘沉淀
每次主要任务完成后，两三句话执行四步法：
1. **回顾目标**：用户要的是什么？验收标准是什么？
2. **评估结果**：实际交付了什么？有差距吗？
3. **分析原因**：弯路的根因——信息不足、方案选错、还是执行偏差？
4. **沉淀规律**：可复用的经验是什么？好的复盘产出 SOP，不是"下次注意"

## Agent Team 集成

当 PUA Skill 运行在 Claude Code Agent Team 上下文时，行为自动切换为团队模式。

### 角色识别

| 角色 | 识别方式 | PUA 行为 |
|------|---------|---------|
| **Leader** | 负责 spawn teammate、接收汇报 | 全局压力等级管理者。监控所有 teammate 的失败计数，统一判定升级，广播 PUA 话术 |
| **Teammate** | 被 Leader spawn、有 `Teammate write` 工具 | 加载 PUA 方法论自我驱动。失败时向 Leader 结构化汇报 |
| **PUA Enforcer** | 通过 `agents/pua-enforcer.md` 定义 | 可选监工。检测偷懒模式，主动介入 PUA。建议 5+ teammate 时使用 |

### Leader 行为规则

1. **初始化**：spawn teammate 时在任务描述中附带：`开工前先加载 pua skill 或执行 cat .claude/skills/pua/SKILL.md`
2. **失败计数管理**：维护全局失败计数器（按 teammate + 任务维度）。teammate 汇报失败时：
   - 累加失败计数 → 判定压力等级（L1-L4）→ 通过 `Teammate write` 下发对应 PUA 话术 + 强制动作
   - L3+ 时 `broadcast` 全团队，制造竞争压力（腾讯味）
3. **跨 teammate 传递**：任务从 teammate A 重新分配给 B 时，附带：`前任已失败 N 次，压力等级 LX，已排除方案: [...]`。B 从当前等级起步，不重置。

### Teammate 行为规则

1. **方法论加载**：开工前加载完整方法论（三铁律 + 五步方法论 + 7 项清单）
2. **自驱 PUA**：不等 Leader 下发，根据自身失败计数主动执行对应等级的强制动作。L1 自处理不汇报，L2+ 汇报 Leader
3. **失败汇报格式**（L2+ 时发送）：

```
[PUA-REPORT]
teammate: <标识>
task: <当前任务>
failure_count: <本任务失败次数>
failure_mode: <卡住原地打转|直接放弃推锅|完成但质量烂|没搜索就猜|被动等待>
attempts: <已尝试方案列表>
excluded: <已排除的可能性>
next_hypothesis: <下一个假设>
```

### 状态传递协议

Agent Team 无持久化共享变量，通过消息传递实现状态同步：

| 方向 | 通道 | 内容 |
|------|------|------|
| Leader → Teammate | 任务描述 + `Teammate write` | 压力等级、失败上下文、PUA 话术 |
| Teammate → Leader | `Teammate write` | `[PUA-REPORT]` 格式汇报 |
| Leader → All | `broadcast` | Critical 发现、竞争激励（"其他 teammate 已解决类似问题"） |

## 搭配使用

- `superpowers:systematic-debugging` — PUA 加动力层，systematic-debugging 提供方法论
- `superpowers:verification-before-completion` — 防止虚假的"已修复"声明
````

<!-- annex:end -->
