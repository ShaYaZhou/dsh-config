---
name: inline-figure
description: 在回答旁内联渲染紧凑的图，覆盖方案对比卡、阶段流程、架构与时序、数据图（折线、柱、环形、散点、雷达、热力、漏斗、桑基、甘特）、机制与矩阵推演、单控件交互。回答中需要一张图才能讲清关系、先后、分叉、数量分布、取舍或机制时主动使用；用户要求画图时必用。触发词：画个图、图解、可视化、对比一下、流程图、架构图、时序图、甘特图、桑基图、热力图、示意图、原理讲解、diagram、visualize 等。不适用于完整网页、应用、长报告、看板、幻灯片。
compatibility: 依赖宿主的 HTML 小组件工具（如 show_widget），无则存 .html 文件交付；自检需 Python 3 与 Edge、Chrome 或 Chromium（FIG_BROWSER 指定浏览器路径；只有渲染自己生成、不含外部脚本的内容时，容器内 root 运行才设 FIG_NO_SANDBOX=1）；Linux 容器需装中文字体，否则中文显示为方框。
---

# 内联小图

在回答旁放一张紧凑的图，让读者扫一眼看清关系、顺序、量级或机制；正文仍负责讲解。

## 1. 画不画

完整网页、可交互应用、长报告、看板、幻灯片不用本 skill。命中多条时，明确要图优先，其次看内容；下表从上往下，命中即止。

| 情况 | 做法 |
|---|---|
| 用户明确要图（画个图、图解、流程图等），哪怕内容简单 | 一律画：按第 5 节选图元；无合适的，按第 5 节末自己组最小的图 |
| 一个数字，或两三句话能说清 | 写文字 |
| 要逐格精确读数或排名，明细很多 | 用表格 |
| 讲对比、先后、架构或调用顺序、分布或走势、卷积与矩阵等机制 | 主动画 |

- 一张图只讲一件事。
- 不编造精确值，估算与示例数据按第 4.5 节标注。

## 2. 怎么交付

| 项 | 做法 |
|---|---|
| 工具 | `show_widget`（完整名 `mcp__visualize__show_widget`）；只见名字时先用 ToolSearch 加载 |
| 首次出图前 | 每会话调用一次 `mcp__visualize__read_me`，`modules` 传空数组；不加载 diagram、mockup、chart 等风格模块 |
| 参数 | `widget_code` 放片段；`title` 用具体的 snake_case 名；`loading_messages` 给 1 至 4 条同语言短文案，严肃话题只写平实动作 |
| 节奏 | 决定出图后直接调用，不预告、不贴代码、不提及调用 |
| 无该工具 | 片段写入 `<图名>.html`，文件头补 `<!doctype html><meta charset="utf-8"><body style="max-width:680px;margin:24px auto">` 仅供浏览器打开；片段仍按第 3 节。有发文件工具就用（如 SendUserFile，display 设 render），否则给出完整路径并说明用浏览器打开。只存文件时不调用 `read_me`、`show_widget` |

## 3. 运行时约束

| 项 | 要求 |
|---|---|
| 结构 | `<style>`、标记、至多一个 `<script>`，依此顺序。不含 `<!DOCTYPE>`、`<html>`、`<head>`、`<body>`，不含任何注释 |
| 根节点 | `<div class="fg fx-<编号>" data-fig="图名">`，首子节点为 `<h2 class="fg-sr">` 一句话概述。`fx-<编号>` 是图元身份类（编号小写），改写时保持。`data-fig` 是实例名，同页多图须互异，改名时同步改脚本 |
| 流式 | 边生成边显示，脚本在内容到齐后才执行。不用 `display:none`、标签页或轮播藏内容；唯一例外是窄屏备用排法（容器或媒体查询控制，同一份数据）：可只留最近一段或略去依赖线、流带，省略处在副标题或页脚写明；默认排法不隐藏 |
| 脚本失败的底线 | 标题、页脚、图例（如有）、坐标标签、网格线须是静态 HTML 或 SVG；数据标记可由脚本生成 |
| 脚本写法 | `document.querySelector('.fg[data-fig="图名"]')` 找根，查询限于根内；用 `addEventListener`，不写内联事件；用 `data-ready` 防重复初始化；只做本地行为；需模型继续推理的追问才用 `sendPrompt('文字')` 发一句话 |
| 外部库 | 默认不用；确需时只从 cdnjs.cloudflare.com、cdn.jsdelivr.net、unpkg.com、esm.sh 加载，写在脚本之前；失败时图仍可读 |
| 宿主 | 容器宽约 680 至 720px，最窄约 320px；`<html>` 可能设 `data-mode`，否则跟随系统 |
| 禁用 | `position: fixed`、嵌套滚动、全屏 API、表单提交、持久化存储；不用 `<a href>` |
| 数字与图标 | 按数据精度统一小数位，不混用取整与小数；确需图标用 Tabler 字体（`ti` 类），不手画图标路径 |

## 4. 视觉系统

### 4.1 气质

1. 像技术书里的插图：安静、平、克制，不像仪表盘或营销页。
2. 结构全用中性灰，整张图只有一个紫色焦点（推荐项、关键路径、分界线、峰值等）；焦点不只靠颜色，还要靠位置、标签或线型。

### 4.2 Token 与 kit 样式

把下面的 kit 样式原样放在 `<style>` 最前。

```css
.fg{--paper:light-dark(#F7F7F8,#171717);--sunk:light-dark(#EFEFF2,#262626);--ink:light-dark(#171717,#E5E5E5);--ink-2:light-dark(#52525B,#A1A1AA);--rule:light-dark(rgba(23,23,23,.12),rgba(229,229,229,.12));
--focus:light-dark(#4B3FE3,#6054F1);--focus-ink:light-dark(#4B3FE3,#A9AEFF);--focus-wash:light-dark(#F2F7FF,#1A1759);--focus-deep:light-dark(#1A1759,#CFD8FF);--on-focus:#FFFFFF;--on-light:#171717;--heat:light-dark(#ADA9EC,#4B3FE3);--heat-1:light-dark(#E1E3FA,#404158);--heat-2:light-dark(#C7CAFC,#7275A7);--heat-3:light-dark(#6F6FFF,#6F6FFF);--heat-4:light-dark(#3C2ECA,#4B3FE3);
--ser-0:#D3D4DA;--ser-1:light-dark(#3C2ECA,#6054F1);--ser-2:#A9AEFF;--ser-3:light-dark(#6F6FFF,#8585FF);--ser-4:#22A5F7;--good:#1DC981;--caution:#EFAA17;--alert:#E8463A;
--f-sans:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei UI","Noto Sans SC",sans-serif;--f-mono:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--r-1:4px;--r-2:8px;--r-3:12px;--r-pill:999px;
color-scheme:light dark;color:var(--ink);font:400 14px/20px var(--f-sans);text-wrap:pretty;container-type:inline-size}
:root[data-mode=light] .fg{color-scheme:light}
:root[data-mode=dark] .fg{color-scheme:dark}
.fg *,.fg *::before,.fg *::after{box-sizing:border-box}
.fg-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap}
.fg-panel{background:var(--paper);border:1px solid var(--rule);border-radius:var(--r-3);padding:var(--sp-5)}
.fg-head{display:grid;gap:var(--sp-1);margin-bottom:var(--sp-5)}
.fg-canvas{background:var(--sunk);border-radius:var(--r-2);padding:var(--sp-4);width:100%}
.fg-title{font:500 16px/24px var(--f-sans);color:var(--ink)}
.fg-sub,.fg-note{font:400 12px/18px var(--f-sans);color:var(--ink-2)}
.fg-foot{display:flex;flex-wrap:wrap;gap:var(--sp-2) var(--sp-6);margin-top:var(--sp-5);padding-top:var(--sp-3);border-top:1px solid var(--rule);font:400 12px/18px var(--f-sans);color:var(--ink-2);text-wrap:balance}
.fg-foot>.is-end{margin-left:auto}
.fg-label{font:500 12px/18px var(--f-sans);color:var(--ink)}
.fg-name{font:500 14px/20px var(--f-sans);color:var(--ink)}
.fg-mono{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
.fg-stack{display:grid;justify-items:center;gap:var(--sp-2)}
.fg-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:var(--sp-6) 32px}
.fg-stats{--cols:4;display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:var(--sp-2);width:100%}
@container (width < 480px){.fg-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.fg-stat{display:flex;flex-direction:column;padding:var(--sp-2) var(--sp-3);border:1px solid var(--rule);border-radius:var(--r-2);background:var(--sunk)}
.fg-stat-v{font:500 16px/24px var(--f-mono);font-variant-numeric:tabular-nums;color:var(--ink)}
.fg-stat-l{font:400 12px/18px var(--f-sans);color:var(--ink-2)}
.fg-canvas .fg-stat{background:var(--paper)}
.fg-chip{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:0 var(--sp-3);border:1px solid var(--rule);border-radius:var(--r-pill);background:var(--sunk);font:500 12px/18px var(--f-sans);color:var(--ink-2);white-space:nowrap}
.fg-chip.is-focus{border-color:var(--focus);background:transparent;color:var(--focus-deep)}
.fg-dot{display:inline-block;width:8px;height:8px;margin-right:var(--sp-2);vertical-align:middle;border-radius:var(--r-pill);background:var(--focus)}
.fg-dot.s0{background:var(--ser-0)}
.fg-dot.s1{background:var(--ser-1)}
.fg-dot.s2{background:var(--ser-2)}
.fg-dot.s3{background:var(--ser-3)}
.fg-dot.s4{background:var(--ser-4)}
.fg-key{display:inline-block;width:16px;height:10px;margin-right:var(--sp-2);vertical-align:middle;border:1px solid var(--ink-2);border-radius:var(--r-1)}
.fg-key.is-dash{border-style:dashed}
.fg-key.is-fill{background:var(--focus);border-color:var(--focus)}
.fg-val{font:500 13px/20px var(--f-mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--ink)}
.fg-val.is-dim{font-weight:400;color:var(--ink-2)}
.fg-val.is-focus{color:var(--focus-ink)}
.fg-track{height:8px;border-radius:var(--r-pill);background:var(--sunk)}
.fg-bar{display:block;height:100%;border-radius:var(--r-pill);background:var(--ser-2)}
.fg-bar.is-focus{background:var(--focus)}
.fg-grid{--cols:3;--cell:32px;display:grid;grid-template-columns:repeat(var(--cols),var(--cell));gap:var(--sp-1)}
.fg-grid.is-small{--cell:24px}
.fg-cell{display:flex;align-items:center;justify-content:center;height:var(--cell);border:1px solid var(--rule);border-radius:var(--r-2);background:color-mix(in srgb,var(--heat) calc(var(--v,0)*100%),var(--sunk));font:500 13px/20px var(--f-mono);font-variant-numeric:tabular-nums;color:var(--ink)}
.fg-grid.is-small .fg-cell{font-size:12px;line-height:18px}
.fg-cell.is-key{border-color:var(--focus);background:var(--focus-wash);color:var(--focus-ink)}
.fg-svg{display:block;width:100%;height:auto;max-width:640px;margin-inline:auto}
.fg-node{fill:var(--sunk);stroke:var(--rule);stroke-width:1px}
.fg-node.is-focus{fill:var(--focus-wash);stroke:var(--focus)}
.fg-canvas .fg-node:not(.is-focus){fill:var(--paper)}
.fg-fill{fill:var(--focus)}
.fg-axis{fill:none;stroke:var(--rule);stroke-width:1px}
.fg-gridline{fill:none;stroke:var(--rule);stroke-width:1px}
.fg-t{font:400 14px var(--f-sans);fill:var(--ink)}
.fg-t-strong{font:500 14px var(--f-sans);fill:var(--ink)}
.fg-t-dim{font:400 12px var(--f-sans);fill:var(--ink-2)}
.fg-t-focus{font:500 12px var(--f-sans);fill:var(--focus-ink)}
.fg-line{fill:none;stroke:var(--ink-2);stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round}
.fg-line.is-focus{stroke:var(--focus)}
.fg-line.is-dash{stroke-dasharray:6 6}
.fg-arrow{fill:var(--ink-2)}
.fg-arrow.is-focus{fill:var(--focus)}
:where(.fg) [data-tip]{position:relative}
.fg [data-tip]::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + var(--sp-2));z-index:2;transform:translateX(-50%);padding:var(--sp-1) var(--sp-2);border:1px solid var(--rule);border-radius:var(--r-2);background:var(--paper);font:500 12px/18px var(--f-sans);color:var(--ink);white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden}
.fg [data-tip]:is(:hover,:focus-visible)::after{opacity:1;visibility:visible}
@media (prefers-reduced-motion: no-preference){.fg [data-tip]::after{transition:opacity 120ms,visibility 120ms}}
.fg :focus-visible{outline:2px solid var(--focus);outline-offset:2px}
```

| 类别 | token |
|---|---|
| 面与线 | `--paper` 面板；`--sunk` 次级面；`--rule` 发丝线；`--ink` 主文字；`--ink-2` 次要文字与连线 |
| 焦点 | `--focus` 唯一强调色；`--focus-ink` 强调小字；`--focus-wash` 强调浅底；`--focus-deep` 浅底药丸的深字；`--on-focus` 实心焦点上的字 |
| 系列与热度 | `--ser-1` 至 `--ser-4` 按序；`--ser-0` 其他；`--on-light` 浅色填充上的字；`--heat` 与 `--heat-1` 至 `--heat-4` 热度 |
| 状态 | `--good`、`--caution`、`--alert`，只表示状态、风险或健康度；只作图形色，不作文字色 |
| 字与距 | `--f-sans` 正文；`--f-mono` 数值与公式；`--sp-1` 至 `--sp-6` 为 4、8、12、16、20、24 |
| 圆角 | `--r-1` 4；`--r-2` 8（单元格、节点、控件）；`--r-3` 12（面板）；`--r-pill` 999 |

刻度：字号与行高只用 12/18、13/20（仅等宽数值）、14/20、16/24，16 为上限；字重只用 400 和 500。线宽：发丝线 1px；连线与箭头 1.5px；焦点轮廓 `outline: 2px solid var(--focus)`，偏移 2px。

### 4.3 类名速查

| 类名 | 用途 |
|---|---|
| `.fg`、`.fg-sr` | 根：定义 token，正文 14/20，每张图必有；视觉隐藏的一句话概述 |
| `.fg-panel` `.fg-head` `.fg-title` `.fg-sub` | 面板（发丝边、圆角 12、内边距 20）；面板头；主标题 16/24 500；副标题 12/18 |
| `.fg-canvas` | 次级画布：`--sunk` 底、圆角 8、内边距 16、无边框，撑满面板内容区；只放图、线、节点，画布内的 `.fg-stat` 与非焦点的 `.fg-node` 自动用 `--paper`；不套卡片。需与面板区分时用：S01 表头带与左栏，S02 至 S04、D10 主图区 |
| `.fg-foot` `.is-end` | 页脚：顶部发丝线，12/18，断行均衡；子元素加 `.is-end` 靠右 |
| `.fg-note` `.fg-label` `.fg-name` `.fg-mono` | 说明 12/18；标签 12/18 500；名称 14/20 500；等宽数字与公式 |
| `.fg-chip` `.is-focus` | 药丸标记；焦点版为细焦点边框、深字 |
| `.fg-dot` `.s0` 至 `.s4` | 8px 圆点；默认焦点色，后缀取系列色 |
| `.fg-key` `.is-dash` `.is-fill` | 图例块：灰描边、虚线、实心焦点色 |
| `.fg-val` `.is-dim` `.is-focus` | 等宽右对齐数值；次要；焦点 |
| `.fg-track` `.fg-bar` `.is-focus` | 8px 横条轨道；填充条（默认系列 2，焦点用焦点色） |
| `.fg-row` `.fg-stack` | 可换行的水平居中横排（行距 24，列距 32）；纵向居中（行距 8） |
| `.fg-stats` `.fg-stat` `.fg-stat-v` `.fg-stat-l` | 摘要条（`--cols` 默认 4，窄于 480 自动两列）及摘要块、数值、说明 |
| `.fg-grid` `.is-small` `.fg-cell` `.is-key` | 方格（`--cols` 默认 3，`--cell` 默认 32px，小格 24px）；底色随 `--v` 混入热度色；关键格 |
| `.fg-svg` `.fg-node` `.is-focus` `.fg-fill` | SVG 容器（块级，宽 100%，最大 640）；节点框；`.is-focus` 为焦点底、焦点描边；`.fg-fill` 为实心焦点色 |
| `.fg-axis` `.fg-gridline` | 坐标轴、网格线（发丝色，不填充） |
| `.fg-t` `.fg-t-strong` `.fg-t-dim` `.fg-t-focus` | SVG 文字：14 常规；14 中粗；12 次要；12 焦点小字 |
| `.fg-line` `.is-focus` `.is-dash` `.fg-arrow` | 连线 1.5px 圆头，焦点色或 6 6 虚线；箭头小三角，尖端对准终点，由图元自绘 |
| `[data-tip]` | 悬停或聚焦时在上方显示读数气泡；SVG 元素改用子元素 `<title>` |

### 4.4 用色

- 颜色只落在焦点、数据标记（柱、线、点、热度格）和图例上；每张图恰好一个焦点（`--focus`、`--focus-ink`、`--focus-wash`；多系列图也可用 `--ser-1`），其余中性。
- 焦点可由几个元素组成（S02 的根节点与主路径、M02/M03 的核格）；热度图（如 M01）无焦点。
- 同类系列取 `--ser-1` 至 `--ser-4`；超过四个就合并为「前几名 + 其他（`--ser-0`）」或拆图。

### 4.5 文案

- 标题：「主题：一句话要点」或名词短语，不超过 22 字，不加句号；只描述图在展示什么，不写建议和因果结论。
- 副标题：读图方式、前提或公式，不超过 30 字；公式用 `.fg-mono`。
- 页脚：一句话，句号结尾，只解释编码或读图规则。
- 节点与标签尽量短，多数 2 至 6 字；说明性文字可到约 20 字，放不下就删减或换行。
- 数值带单位；估算写「约」，「一个量级」「几倍」等相对说法不加；示例数据注明「示例数据」。
- 短语、公式与含连字符的专名整体不断行（`white-space: nowrap`）；英文多词名保持原样。
- 推荐标记（药丸、焦点色）可用，理由写在正文。
- 结论句移到正文；图里只留数据与比较描述，决策图分支只写条件式结果。
- 中文与英文、数字之间留空格；符号用 × · − → ↓，范围用 –；中文用全角标点；不用全大写、Title Case、emoji。

### 4.6 数量上限

- 一个焦点；主节点一般 2 至 5 个（S05 可到 6 个）；选项或系列 2 至 4 个；一行横排不超过 4 个框。超出就分组、拆图或移入正文。
- 「框」指节点、卡片、块，不含数据格子；自己组的图主框一般 2 至 6 个，超出先分组。

### 4.7 版面与响应

- 面板随容器，窄了换行或纵向堆叠，不出现横向或嵌套滚动。
- 宽度口径：SVG 为主的图元居中、不放大（`.fg-svg` 最大 640），面板随容器满宽；圆形、环形、雷达居中，最大宽 360。
- SVG 用 `viewBox` 加 `width: 100%`，高度随内容。文字放不下就删减或换行，不缩字号、不裁切。例外：SVG 为主的图元在窄屏（容器窄于 680px）可整体等比缩小，缩放后字号不低于 10px，不溢出、不叠字；容器 680–700px 时缩放比不低于 0.93，700px 及以上用规定字号。

### 4.8 交互与动效

- 默认静态。仅在有助理解时加交互，一张图最多一组控件（悬停读数、高亮、淡出其他项）。
- 过渡不超过 120ms，只动 `opacity`、`transform`、`stroke-dashoffset` 与颜色属性；`visibility` 可与 `opacity` 同步。循环或装饰动效包在 `@media (prefers-reduced-motion: no-preference)` 内。可聚焦元素用 kit 的 `:focus-visible` 轮廓。

### 4.9 明暗与禁止项

- 颜色经 token，亮暗自动切换。文字对背景的对比度至少 3，小字尽量 4.5 以上；SVG 的 `fill`、`stroke` 也用 token。
- 不做：渐变、阴影、模糊、发光、纹理、彩虹色；装饰插画；英雄区、导航、导出按钮；卡片套卡片（`.fg-canvas` 不算卡片）；大号数字；彩色卡片底；写死的亮色；注释。

## 5. 选图元

按用户意图找行。落在两行之间，选「何时放弃」更不符合的那个；都不合适就按本节末尾自己组。

| 用户意图 | 图元 | 何时放弃或改用别的 |
|---|---|---|
| 有序时间上的单指标走势（4 至 12 点，单线） | `patterns/D01.md` | 只要一个数字；类目无先后（用 D02、D03）；多于一条线；超过 12 点 |
| 有序类目上两个系列逐组比大小（3 至 12 组） | `patterns/D02.md` | 看走势（D01）；看构成（D03）；系列超过两个；只需一个数字 |
| 两段叠成的类目，看总量与构成（3 至 12 类目） | `patterns/D03.md` | 只比两段大小（D02）；只看占比；数值有负；段数超过两段 |
| 2 至 5 类占比，总量有意义，放在环心 | `patterns/D04.md` | 要精确比排名（柱图）；有负值；超过 5 类（并入「其他」）；总量无意义 |
| 3 至 5 类占比，直接在扇区里写类别名 | `patterns/D05.md` | 要精确比较（D02）；名字放不进扇区（用 D04 或表格）；有负数 |
| 两指标的关系，可选气泡面积作第三维（1 至 3 系列，4 至 20 点） | `patterns/D06.md` | 随时间变化（D01）；类别排名（柱图）；横轴是日期或文字；点数上千 |
| 两对象在 3 至 8 维上的画像，看形状与侧重 | `patterns/D07.md` | 要精确比数值（柱图）；维度名很长；随时间变化（D01）；对象超过两个 |
| 日计数按周与星期排布（12 至 26 列，7 天） | `patterns/D08.md` | 要比数值排名（柱图）；只看连续走势（D01）；数据无法按周和星期分格；要比较多个来源 |
| 有先后的阶段逐级流失，首阶段 100%（3 至 7 阶段） | `patterns/D09.md` | 阶段彼此独立（排行柱图）；比较并列流程（D02）；数值含负或会回流；超过 7 个阶段 |
| 三列加权流向，如来源、落地页、结果（每列 3 至 4 节点） | `patterns/D10.md` | 流向有环或双向；需要精确排名；来源超过 4 个；数值含负；需要拖拽 |
| 3 至 8 项任务的排期、依赖与关键路径，跨 4 至 12 周 | `patterns/S01.md` | 要拖拽改期、分配资源或做基线对比；超过 8 项；日期不明 |
| 4 至 10 个节点的分叉流程树，从左到右，突出主路径 | `patterns/S02.md` | 有合并或环（缩进列表或拆图）；要拖拽或编辑；节点是长段文字 |
| 架构块与连线的样式板（四种块，四种连线） | `patterns/S03.md` | 展示具体系统的拓扑（另画）；需要步骤或建议（正文）；超过 6 个模块 |
| 3 至 5 个参与者的调用与返回，4 至 8 条有序消息 | `patterns/S04.md` | 参与者超过 5 个或消息超过 8 条；要解析任意时序语言；关系是依赖树（S02） |
| 3 至 6 个有先后、越往下越便宜的阶段，虚线标分界 | `patterns/S05.md` | 少于 3 个或多于 6 个阶段；只有先后、没有资源差异（文字列表）；有分支或汇合 |
| 2 至 4 个方案在 3 至 5 个维度上并列对比，标推荐项 | `patterns/C01.md` | 只有一个方案（正文）；超过 4 个方案或 7 个维度（表格）；要逐格精确比数值；各方案几乎一样 |
| 同一小输入经三个卷积核后的输出并排对照（模糊、描边、锐化） | `patterns/M01.md` | 只讲一个核（一句话或小表）；输入超过 5×5；只要公式（正文） |
| 3×3 输入与 2×2 核按行展平成列向量，标下标 | `patterns/M02.md` | 只要结果（正文）；矩阵超过 4×4；要讲矩阵乘法本身（M03） |
| 卷积写成 W·x=y 的矩阵乘法，结果折回 2×2 | `patterns/M03.md` | 只需一个数字（正文）；要逐步看窗口滑动（I01）；矩阵更大 |
| 大权重矩阵的带状稀疏结构，只看结构不看数值 | `patterns/M04.md` | 需要具体数值（M03）；只有一个卷积位置（正文）；要逐步解释乘法（M03、I01） |
| 两个方波相卷，重叠面积随平移变化得三角波（四帧） | `patterns/M05.md` | 离散数据或只要结论；超过 4 帧（拆图）；函数不是方块 |
| 单控件步进：窗口一步步移动，算式随之更新 | `patterns/I01.md` | 只要最终结果（M03）；需同时操作多个控件（拆图）；需保存状态或继续对话 |

无合适图元时，用第 4.3 节的 kit 类自己组，根节点照第 3 节写，身份类自取。整张（含 kit）约 10 至 20KB 属正常；图元部分（不含 kit）尽量约 8KB 内。仍讲不清（且非明确要图）就改用表格或文字。

自己组一张（要点）：

- 外框 `.fg-panel` 加 `.fg-head`；`.fg-canvas` 内放 `.fg-svg`（`viewBox` 宽 640）。
- 节点 `.fg-node` 约 84×40、圆角 8；列距不小于 60，行距不小于 24，坐标取 4 的倍数。
- 连线 `.fg-line` 画 1.5px 直角折线，汇合共用竖线；箭头 `.fg-arrow` 自绘小三角。
- 焦点只一个，用 `.is-focus`，靠位置或标题说明。
- 窄屏（容器窄于约 680px）下 640 宽的 SVG 缩小后字会小于 10px：用容器查询（`.fg` 已是容器）切到编号列表，副标题写「窄屏以列表呈现」，样式以 `.fx-<编号>` 开头。

## 6. 怎么改写图元

| 步骤 | 做法 |
|---|---|
| 1 读 | 打开 `patterns/<ID>.md`。第一段说明何时用、怎么改、焦点在哪；css 块为图元样式，html 块为完整片段 |
| 2 组装 | 一个 `<style>`：先放第 4.2 节的 kit 样式，再接图元 css；随后 html 块；脚本放最后 |
| 3 换数据 | 换成用户的内容。多数数据在脚本顶部对象里（如 `D`）；无脚本的图元（C01、D09、M01 至 M05、S01 至 S05）直接改 HTML；缺值写 `null` |
| 4 换文案 | 图元自带的文案块都换（`fg-sr` 必换）；无标题、页脚的图元（如 C01、S05）保持原样，需要时按第 4.5 节添加 |
| 5 改数量 | 增减类目或系列时，网格线、刻度、标签、图例与脚本数组一起改 |
| 6 焦点 | 换成要强调的那一项；图元无焦点（如 M01）就不加 |
| 7 骨架 | 保留 `fg`、`fx-<编号>`、静态骨架与 `data-fig`；图元 css 选择器以 `.fx-<编号>` 开头，kit 的类写在它之后（如 `.fx-d06 .fg-node`）；缺的样式用图元 css 里的 token 补，不改 kit |
| 8 自检 | 过第 7 节清单 |

特例提醒：D08 的档位类 `fx-l0` 至 `fx-l4`、D10 的流带、S01 的条与依赖线、M04 的短杠、S04 的消息行距、S05 的分界线，改数据后按图元首段重算。

## 7. 出图前的静默自检（不写进回复）

1. 只有一个焦点（可由几个元素组成），且焦点不只靠颜色。
2. 没有结论、分析或推荐理由。
3. 数量在第 4.6 节上限内。
4. `<style>` 在前，至多一个 `<script>`；无 DOCTYPE、html、head、body，无注释。
5. 根为 `div.fg.fx-<编号>[data-fig]`，首子节点为 `<h2 class="fg-sr">`；同页多图的 data-fig 互异。
6. 只用 kit 的类、本图元的 `fx-<编号>` 类与 token；无写死颜色、渐变、阴影、`position: fixed`、内联事件；字号只用 12、13、14、16。
7. 数据与用户内容一致，数字统一小数位，缺值不画；静态骨架（标题、页脚、图例、坐标标签、网格线）不靠脚本也看得懂。
8. 文案符合第 4.5 节，没有 emoji；亮暗都可读，窄屏无横向滚动。
9. 无外部资源、`<a href>`、表单、持久化存储（外部库见第 3 节）。

## 8. 装配后自检（可选）

有 Edge、Chrome 或 Chromium 时，可渲染装配好的片段：

`python <skill 目录>/tools/render.py <片段.html> [--out <输出目录>]`（`python3` 亦可）

- `<skill 目录>` 即 SKILL.md 所在目录。默认宽 720，建议另测 `--width 360`；`--out` 默认当前目录的 `fig-out`；`--kit` 默认取 SKILL.md 的 kit。
- 浏览器取 `FIG_BROWSER` 指向的文件（设了只用它），否则查常见安装位置与 PATH。只有渲染自己生成、不含外部脚本的内容时，容器内以 root 运行才设 `FIG_NO_SANDBOX=1`。
- 输出亮、暗 PNG，另有体检 `<名>.json` 和渲染副本 `_<名>-<亮暗>.html`。
- 检查全部 `<style>` 块：脚本报错、越出根节点、文字裁切、字号小于 11.5px（提示）、对比度（<3 失败，<4.5 提示）、写死颜色、注释、`position: fixed`、内联事件、非刻度字号。
- 退出码 0 即无 FAIL，WARN 逐条判断。退出码 1 分三类：仅一行找不到浏览器的提示（未渲染）；首条 FAIL 行含「无法启动浏览器」「浏览器超时」「截图没生成」「没取到体检结果」之一（环境问题，可查 FIG_BROWSER）；其余 FAIL（要修图）。前两类不是图的问题，跳过本节，靠第 7 节清单。
