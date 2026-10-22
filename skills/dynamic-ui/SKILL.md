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
