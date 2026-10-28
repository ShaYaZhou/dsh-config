# 技能与部署环境对齐

> 日常精简配置：除内联卡片所需的一份 dynamic-ui 外，整套额外技能仅由 enhanced profile 按需加载，日常 desktop 不列出该技能库。详见 [日常精简 PTC](DAILY-PTC.md)。

这份文档是给 AI agent 执行的对齐手册：读完即可把一台机器上的 Harness 部署、插件和技能副本对齐到本仓库状态。仓库是唯一来源，本机不保留第二份可编辑副本，也不再使用目录联接。技能只落 DSH 的 `agent-capabilities/skills/`，不写入 `~/.claude/skills`、`~/.agents/skills`、`~/.codex/skills` 等 agent 全局目录，避免被其他 agent 发现。

## 一、执行须知

- 只按本文和仓库文件操作；发现本机有仓库没有的文件时停下报告，不要删除或覆盖。
- 不建立软链接或目录联接；技能一律复制成真实文件。
- 不提交 `.local/`、会话、记忆、凭据和展开后的本机路径。
- 技能只进 DSH：`scripts/harness.mjs install` 把 `skills/<名称>/` 整棵复制到 `DSH_HOME/profiles/enhanced/agent-capabilities/skills/`。
- 不把技能复制到 `~/.claude/skills`、`~/.agents/skills`、`~/.codex/skills`：这些是各 agent 的全局目录，会被其他 agent 发现；DSH 的外部技能 provider 优先级还高于桌面 `customSkillDirs`，同名会互相覆盖。
- `scripts/align-skills.mjs` 只维护文档附录；本机确实需要额外副本时，才显式传 `--target`。

## 二、对齐清单

### 2.1 运行时与插件

| 项 | 权威来源 | 目标 | 校验 |
|---|---|---|---|
| Node 与 CLI | `README.md`、`provenance.json` | 全局 npm 的 `@deepseek-ai/dsh@0.2.1-rc.3`，与桌面运行时一致 | `dsh --version` |
| 本机 proxy / 模型 / 权限 | `config/local.example.json` 复制为 `.local/settings.json` | 仓库内 `.local/`（不入 Git） | `install --dry-run` 不报缺字段 |
| 桌面 profile | `config/desktop.patch.json`、`config/desktop.package.json` | `DSH_HOME/profiles/desktop` | `harness status` 无漂移 |
| 无头 profile | `config/headless*.json` | `DSH_HOME/profiles/headless` | 同上 |
| 依赖锁 | `config/desktop.lock.yaml`、`config/headless.lock.yaml` | 对应 profile 目录 | 安装使用 `--frozen-lockfile` |
| 本地插件（12 个） | `plugins/`、`provenance.json` | `DSH_HOME/local-plugins/*.tgz` | 打包文件名含内容哈希，`status` 比对 |
| 全局工作规则 | `config/AGENTS.md` | `DSH_HOME/AGENTS.md` | 安装器备份后覆盖 |

插件清单不在此处复制，`config/desktop.package.json` 的 `dependencies` 与 `dsh.profile.bundles` 是唯一权威。

### 2.2 技能

| 技能 | 仓库来源 | DSH 目标 | 附带文件 |
|---|---|---|---|
| `dynamic-ui` | [`skills/dynamic-ui`](../skills/dynamic-ui/) | `agent-capabilities/skills/dynamic-ui` | `preview.py` + `patterns/` 20 个 |
| `think` | [`skills/think`](../skills/think/) | 同上 | `references/` 3 个 |
| `pua` | [`skills/pua`](../skills/pua/) | 同上 | 无 |
| RTK：`rtk-reference` | [`skills/rtk-reference`](../skills/rtk-reference/)；官方来源 [`rtk-ai/rtk`](https://github.com/rtk-ai/rtk) | 同上 | 仅命令参考；RTK CLI 另装，见 2.2.2。`disable-model-invocation: true`，用户按需调用 |
| `ponytail` | [`skills/ponytail`](../skills/ponytail/)；官方来源 [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail)，上游路径 `skills/ponytail/SKILL.md` | 同上 | MIT；部署仓库内已审阅副本，不自动追随上游最新版 |
| `check`、`handoff`、`implement`、`grill-me`、`grill-with-docs`、`grilling`、`domain-modeling` | [`skills/`](../skills/)（自本机 `~/.claude/skills`、`~/.agents/skills` 入仓） | 同上 | 见各自目录；`grill-me` 依赖 `grilling`，`grill-with-docs` 依赖 `grilling` + `domain-modeling`，四项必须同时部署 |
| 其余 DSH 专用技能 | [`skills/`](../skills/) | 同上 | 见各自目录 |

完整技能库目标在 `DSH_HOME/profiles/enhanced/agent-capabilities/skills/<名称>/`，由安装器整棵复制，不需要单独登记。日常 desktop 另只部署 `agent-capabilities/inline-skills/dynamic-ui/`，由卡片插件通过原生技能注册表按需提供，包含 patterns 与 preview.py 资源。技能不再复制到 agent 全局目录。目标机若在 `~/.claude/skills`、`~/.agents/skills`、`~/.codex/skills` 已有同名技能，DSH 的外部 provider 可能优先加载那些副本；本仓库不写入也不删除这些目录，需要时由机器所有者自行处理。附录只内联自维护的 `dynamic-ui` 全文；`think`、`pua` 及其余下载技能只写仓库链接。

### 2.2.1 Ponytail 安装与使用

Ponytail 用于约束过度设计：先理解调用链，再优先复用已有代码、标准库和原生能力；不能省略输入验证、安全边界及必要验收。官方仓库与安装说明分别是 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) 和 [INSTALL.md](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md)（2026-10-26 核对）。

本仓库已包含此技能，无需再安装一份第三方插件：按第三节运行部署预览、安装和状态检查，即会复制到 `DSH_HOME/profiles/enhanced/agent-capabilities/skills/ponytail/SKILL.md`。使用 `dsh --profile enhanced`，在新会话中通过技能菜单选择 `ponytail`，或明确要求加载该技能；确认实际解析的是上述受管路径。日常精简 desktop 不加载这份额外技能库。若加载到全局同名副本，先报告来源差异，不自动覆盖全局目录。

上游还提供 Claude Code / Codex 插件安装方式，但其插件命令和生命周期 hooks 不等同于 DSH 技能安装；不要把这些命令直接用于 DSH。需要更新本仓库副本时，先审阅上游技能与许可证差异，再更新 `skills/ponytail/`、运行技能对齐检查和部署验证。本次仅补安装文档，不替换现有技能版本，也不把上游宣传的性能数字当作本仓库的实测结果。

### 2.2.2 RTK 工具与参考技能安装

官方仓库是 [rtk-ai/rtk](https://github.com/rtk-ai/rtk)，安装方法见上游 [INSTALL.md](https://github.com/rtk-ai/rtk/blob/develop/INSTALL.md)（2026-10-26 核对）。这里的 RTK 是 Rust Token Killer，不能与其他同名项目混淆。

先检查工具是否已安装；以下检查不改配置：

```sh
rtk --version
rtk gain
```

若能显示版本和用量统计，直接复用，不重复安装。若未安装，Windows 可使用上游列出的 WinGet 包：

```powershell
winget install rtk-ai.rtk
```

macOS（或已配置 Homebrew 的 Linux）优先使用 `brew install rtk`。已有 Rust 工具链的机器也可使用上游 Git 安装方式；其他预编译安装方式见上游文档：

```sh
cargo install --git https://github.com/rtk-ai/rtk rtk
```

这些是首次安装命令，RTK 尚不存在时不要给安装命令加 `rtk` 前缀。安装后重新运行 `rtk --version` 和 `rtk gain`，再执行本仓库部署步骤。不要仅执行 `cargo install rtk` 并假定取得的是同一个项目。

**CLI、日常规则、按需技能分开验证：** 安装器不静默下载或安装 RTK；正式安装在写配置前检查 PATH 中的 `rtk --version`，缺失时停止并提示安装命令。安装 CLI 后重开终端和 Harness，确保桌面进程也获得新 PATH。`clean` 原生回退不要求 RTK。

日常 `presets/daily/AGENTS.md` 与完整 `config/AGENTS.md` 均包含相同的短 RTK 规则，要求 Standard、PTC 经 Bash/PowerShell 执行支持的输出密集命令时默认使用 RTK。`rtk-reference` 在日常与增强配置中按需提供完整参考，不把整份命令表塞进每轮。原生 read/grep/edit 等工具继续使用；精确输出通过 `rtk proxy` 获取，内建命令、管道和脚本不机械添加前缀。

**自动执行适配与指令配合：** `@local/dsh-rtk-shell`通过本地环境插件的公开Bash/PowerShell执行器子类，复用原生执行链。支持的简单Git查询即使模型不加前缀也会自动改写：`git status`、`git diff`（可选`--stat/--cached/--staged`）、`git log`（可选`-N/-n N/--oneline/--stat/--all`）、`git show`（可选`--stat`）。不启动额外的rewrite进程，不读取Claude hooks。

其他命令仍按常驻规则显式用RTK。管道、重定向、赋值、脚本、带路径参数、机器格式（porcelain/short/format等）、写操作以及已有`rtk`/`rtk proxy`原样通过，不尝试泛化Shell解析。原工具历史保留模型输入，验收在原生confine入口核实改写后的真实命令；不能仅凭历史参数没有前缀判定适配失效。

所有命令均只调用一次原生执行器；RTK缺失、失败、超时、拒绝或停止都不会再执行裸命令。需原始输出用`rtk proxy git ...`。取消整个自动适配时，移除`@local/dsh-rtk-shell` bundle并重新部署，使本地环境的原执行器恢复；不要只禁用当前shell provider而留下原provider关闭。安装器备份可整体回滚。

RTK统计是命令输出估算，不是模型总账单降幅；统计库若位于工作区之外，`rtk gain`可能被原生写保护拒绝，过滤仍可用，不为统计放宽权限。自动适配的真实模型/权限/停止验收用`scripts/test-rtk-auto.cjs`（隔离DSH_HOME），原指令式验收仍保留。

只部署 DSH 时，不执行 `rtk init -g` 或其他宿主的 hook 安装；“No hook installed”提醒不代表显式RTK命令未生效，不应为消除提示擅自修改Claude/Codex配置。

### 2.2.3 Windows 拉取后自检

首次安装RTK按上游使用 `winget install --id rtk-ai.rtk --exact`。安装后关闭并重开PowerShell和Harness，避免旧进程继续使用旧PATH；不要仅把RTK设为PowerShell profile中的alias/function。DSH需要PATH可发现的真实`rtk.exe`，Windows Shell还需要PowerShell 7（`pwsh.exe`）。本仓库不自动改全局PATH或安装其他宿主hook。

在仓库根目录执行（若RTK尚不能运行，直接用Node检查，才能得到诊断）：

```powershell
node scripts/check-rtk.mjs
```

该命令检查真实RTK可执行文件、proxy子命令、无profile的PowerShell调用，并在名称带空格的临时Git仓库中实际执行`rtk.exe git status`，最后清理自己的临时目录。不调用模型，不改生产配置或用户仓库。也可运行 `npm run check:rtk`。

看到`RTK_CHECK_PASS`后再按安装章节执行dry-run与install。安装器在Windows也会执行RTK与PowerShell预检；失败在修改配置前停止，并给出对应原因。不要把`rtk gain`因统计库访问被拒绝误判成RTK版本错误。

**验证层次：**此自检证明普通终端能够运行，不证明Windows的DSH文件沙箱已经验收。`scripts/test-rtk.cjs`是下一层隔离宿主真实模型验证，覆盖Standard/PTC、实际叶子pwsh/bash命令、退出码与完整保护状态，结果包含运行平台；按原生运行时测试环境设置DSH_HOME/DSH_NATIVE_ROOT及模型凭据后执行，不在生产会话试写。Windows原生工具说明指出，受限环境中的子进程捕获可能遇到命名管道EPERM；若RTK在此处失败，保留错误，不切到无保护模式或以原生命令的成功冒充RTK成功。

本轮在Mac通过实际自检，并通过模拟Windows参数/失败分支的自动回归；**尚无Windows实机结果**。PC用户应先运行上面的自检，不能将本节视为Windows宿主已验证通过。

### 2.3 不纳入

- `~/.claude/skills` 下的 Lark、视频、抓取类技能：体积可达数十 MB，且与本仓库能力无关，只在需要的机器上单独安装。
- `computer-use` 的 agent 全局副本：全局路径指向 `~/.agents/skills`，由该目录自己维护；DSH 副本仍随 `skills/computer-use` 部署。
- 任何插件专属的内部状态、会话、记忆和快照。

## 三、执行顺序

```powershell
rtk proxy node --test test/align-skills.test.mjs
rtk proxy node scripts/align-skills.mjs --check
rtk proxy node --test test/portable.test.mjs
rtk proxy node scripts/harness.mjs install --dry-run
rtk proxy node scripts/harness.mjs install
rtk proxy node scripts/harness.mjs status
```

`align-skills.mjs` 不带 `--target` 时只刷新或检查附录，不复制技能；技能落点由安装器决定。安装结束后完全退出 Harness 再打开，新会话才会加载新技能。

### 3.1 `align-skills.mjs` 的行为

| 目标状态 | 动作 |
|---|---|
| 不存在 | 全量复制 |
| 是目录联接或符号链接 | 删除链接本身，写入真实副本 |
| 是真实目录，文件内容不同 | 覆盖为仓库版本 |
| 含仓库没有的文件 | 跳过该技能，列出文件名，退出码 1 |
| `--check` | 只读比较，不写任何文件 |

不带 `--target` 时只刷新或检查附录，不复制任何文件。显式传入 `--target <目录>` 才按上表复制；该参数只供本机维护，正规部署不要使用，更不要指向 agent 全局目录。

### 3.2 文档附录

第五节由脚本生成：自维护的 `dynamic-ui` 内联全文，其余下载技能只写仓库链接；`--check` 会一并比较。修改技能后重新运行脚本，不要手改附录。

## 四、不能运行脚本时

WorkBuddy 等只能读写的 agent 按此逐项核对；目标一律是 `DSH_HOME/profiles/enhanced/agent-capabilities/skills/`，不要写 agent 全局目录：

1. 打开 `skills/<名称>/`，记录相对路径清单。
2. 在目标目录按相同相对路径逐个比较内容；内容相同即视为已对齐。
3. 目标不存在则复制整棵目录；目标里多出文件则停止并报告。
4. 目标若是链接（`readlink` / `dir /AL` / `Get-Item | Select-Object LinkType`），先删除链接，再复制真实目录。
5. 核对文件数：`dynamic-ui` 22、`think` 4、`pua` 1；`SKILL.md` 首行必须是 `---` 且 `name:` 与目录名一致。

## 五、附录：技能全文与仓库链接

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

1. **DSH `render_widget`（首选）**：直接调宿主工具，参数 `html`（片段）、`title`（图名）、`height`（初始帧高 200–900，默认 420；卡片随后按内容自报高度撑开，不用猜最终高度）。图渲染在会话内的一张卡片里，不落文件。
   宿主事实：iframe `sandbox="allow-scripts allow-forms"`（不同源）；CSP `default-src 'none'`、`style-src 'unsafe-inline'`、`script-src 'unsafe-inline'`、`img-src data: blob:`、`connect-src 'none'`；片段上限 200000 字符；**只接受片段**——不传 `<!doctype>`、`<html>`、`<head>`、`<body>`，宿主自己套文档壳并在根上设 `color-scheme`。
2. **其他内联宿主**（Trae 的 `PureShowWidget` 等）：直接调该宿主的 widget 工具，同一段代码不用改。它们允许 CDN、会注入 `data-widget-theme`、支持流式预览和图片导出，但本 skill 不依赖这些能力。
3. **都没有**：才退回写 `<图名>.html`，文件头补 `<!doctype html><meta charset="utf-8"><style>:where(html){color-scheme:light dark}</style><body style="max-width:680px;margin:24px auto">`，交付文件。宿主有 `render_widget` 时一律走通道 1，不要生成网页文件。

决定出图后，下一步直接调用通道：不在正文预告"我来画个图"，不贴代码草稿，布局推演在心里完成。

图上的交互只做本地计算与显示，不回传 Agent；需要模型推理的追问由用户自己发消息。宿主提供 `sendPrompt` 时才用它。DSH 卡片不同源，`window.agentDeckVisualize` 一类宿主桥在卡片内不可用。

## 3. 运行时硬约束

- 顺序：`<style>`（§4.2 套件 + 本图专用类）→ 内容 → 至多一个收尾 `<script>`。无 DOCTYPE / html / head / body，无任何注释。
- 根节点 `<div class="dui" data-w="图名">`，第一个子元素是 `<h2 class="sr-only">一句话概述</h2>`。脚本用 `document.querySelector('.dui[data-w="图名"]')` 取根，所有查询限定在根内，用 `addEventListener` 绑定，不写内联 `on*`。
- 流式输出期间内容必须可见：不用 `display:none` 藏内容，不用 tabs、轮播；交互态由脚本加载后切换。
- 禁止 `position:fixed`、嵌套滚动、全屏 API。宿主的卡片按内容自动撑高，所以不要给根节点或任何容器写 `height` 加 `overflow:auto/scroll`；内容按自然高度排，滚动交给宿主页面。
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

第三方下载技能，全文以仓库文件为准：[skills/think/SKILL.md](../skills/think/SKILL.md)

### pua

第三方下载技能，全文以仓库文件为准：[skills/pua/SKILL.md](../skills/pua/SKILL.md)

### rtk-reference

第三方下载技能，全文以仓库文件为准：[skills/rtk-reference/SKILL.md](../skills/rtk-reference/SKILL.md)

<!-- annex:end -->
