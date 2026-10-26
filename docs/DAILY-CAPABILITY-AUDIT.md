# 日常精简的完整影响与修复核查

> 已完成隔离宿主、Mac安全载体与生产桌面入口验收，并部署到日常配置（2026-10-27）。保留安装器备份；部署状态无漂移。

核查基线为 d05e3cd；精简发生于 4a00fa0（随后35ad642补回引导状态）。对照同版本官方rc.3、精简前完整配置、精简后的日常配置及后续修复。不能把第三方或自写能力统称为原生，也不能把未参与消融的功能判作负优化。

## 实际精简了多少

精简前桌面manifest有29项直接依赖、23个bundle。第一次精简后的daily仅有Playwright这一项依赖、官方base/web-app两个bundle：**21个已加载bundle退出了日常**。完整配置整体搬到enhanced，源码保留；headless改为原生配置。后续补回市场、嵌套会话、管理入口和动态卡片后，核查基线daily为6个bundle，仍有17个未加载。

这次恢复5个日常交互包：browser-review、file-links、rewind、desktop-commands、delete-session。其余按需能力在管理页“功能清单”明确显示状态和入口，不把源码存在冒称为已启用。当前用户确定的四开两关组合保持：worktree、总线、Claude上下文、用量报告开；Team、浏览器与桌面指引关。

## 21个bundle逐项核查

| 初次移出项 | 影响 | 本轮处置或现状 |
|---|---|---|
| dshmarket | 插件市场入口消失 | 已在此前修复恢复；本轮保护市场安装内容跨部署保留 |
| archify-dsh | Archify架构图技能不再由daily提供 | enhanced按需；清单说明。dynamic-ui不是同一技能 |
| dsh-btw | /btw、旁问气泡及快捷键退出daily | enhanced按需，清单显式列入口；不能称已证明无价值 |
| dsh-rewind-plugin | Rewind按钮、/rewind、文件快照回退入口丢失 | 本轮恢复；实际文件还原、聊天回退、错误目标及卸载后冷读验收 |
| dsh-better-sidebar | 该插件的文件树、编辑器、变更和侧聊面板退出daily | enhanced按需；原生侧栏/文件预览不等于这个扩展工作台 |
| dsh-code-review | 专用代码审查入口退出daily | enhanced按需；普通子代理审查仍在，但不宣称体验等价 |
| 原生experimental-agent-team-profile | 原生实验性Team整套profile不再默认激活 | 有意按需；本地Team服务/工具已安装但按用户选择默认关闭 |
| dsh-subagent-workspace-ui | 可搜索的工作区子代理管理界面退出daily | enhanced按需；当前原生子代理、嵌套会话入口保留，不能称所有管理细节等价 |
| dsh-skills-manager | 扩展技能管理、统一发现/管理界面退出daily | enhanced按需；原生skill-filesystem和skill仍在 |
| dsh-memory | 自动记忆捕获/总结/注入及工具退出daily | 有意按需；旧记忆文件保留，Claude上下文模块不是该记忆系统 |
| desktop-commands | /agents、/resume、/fork、/clear、/help等桌面快捷入口退出daily | 本轮恢复，复用原生会话/命令接口 |
| nested-sessions | 关联会话、并排查看、状态面板、协作入口退出daily | 已在此前修复恢复，现名“嵌套会话”，命令仍/collaborate |
| browser-review | 内置浏览器工具栏的截图、区域截图、CSS元素批注退出daily | 本轮恢复；与Playwright Dashboard批注严格区分 |
| idle-settings | 自定义压缩阈值/空闲维护设置页退出daily | enhanced按需；原生上下文压缩和/compact仍在 |
| enhancement-settings | Harness增强管理页退出daily | 已恢复；本轮新增完整功能清单，区分已启用/停用/未加载 |
| local-environments | 环境目录/变量/工作树准备及管理页退出daily | enhanced按需；原生工作目录不等同环境管理 |
| follow-ups | 后续建议确认卡片、设置及工作区准备退出daily | enhanced按需；不恢复成自动后台派工 |
| file-links | 普通代码路径及行号的侧栏预览增强退出daily | 本轮恢复；原生主要识别本轮产出/交付文件的逻辑仍优先 |
| team-view | 本地Team成员/计划面板退出daily | enhanced按需，执行开关与管理视图分开说明 |
| delete-session | 会话菜单中的可恢复删除入口退出daily | 本轮恢复；保留先停止归档、再移入恢复目录的边界 |
| dynamic-ui-view | render_widget工具和会话内交互卡片退出daily | 已恢复，受管dynamic-ui技能按需加载；不强制完整网页走卡片 |

## 模块、技能与headless变化

完整配置的16个本地模块中，daily只部署9个，且其中Team及browser-guidance默认关闭。其余7个是：compaction-basic本地改造、idle-compaction-agent、idle-compaction、range-commands、role-policy、ultracode、workflow-command。原生对应基础能力不能因此被说成消失：原生压缩、权限、取消、历史、普通子代理仍由base提供；自定义范围压缩、空闲维护、角色治理、Workflow恢复命令不在daily。

完整受管技能25项：check、claude-context、computer-use、domain-modeling、dsh-code-review、dsh-spec-delivery、dynamic-ui、grill-me、grill-with-docs、grilling、handoff、implement、ponytail、pua、rtk-reference、security-review、think、usage-report、workflow-orchestration，以及6项OpenSpec技能。daily只主动注册dynamic-ui；computer-use资源仅供可选指引模块使用。用户全局技能可能另外被原生发现，因此“这台机器能调用”不能证明全新Mac安装也具备全部技能。

headless也改为原生：原有Claude hooks桥接、记忆等增强不再挂载。当前Mac的两份被配置检查引用的hooks文件均不存在，没有证据证明此机正在使用的hook被剥夺；此差异仍明确列入清单，不能默认为全平台行为等价。

## 确认的问题与修复

1. **批量卸载没有区分UI与执行策略。** 21项一同迁走，导致已经验证过的交互入口丢失。恢复截图/批注、路径预览、Rewind、桌面命令和可恢复删除；不把后台记忆/工作流自动启用当成修复UI的必要条件。
2. **按需能力缺少可见清单。** 仅留下CLI启动说明，用户很难知道何处提供。管理页新增“功能清单”，从原生插件/包清单读取状态，列明完整增强入口，不伪造无效开关。
3. **失效提示指向未安装技能。** Claude上下文可能要求调用缺失的claude-context技能；改为仅在相关时使用现有read工具读取索引，记忆仍只提供路径、不自动读正文。
4. **部署会整份重写清单与配置。** 市场新增包、模型设置和本机开关可能被覆盖。改为保存带完整性哈希的生成基线，使用上次基线/本机值/新模板三方合并；保留本机增加、编辑、删除，并在双方修改同一值或基线不可信时写入前拒绝。保留本机锁作为原生安装器的解析输入，避免把自装包从依赖中抹去。不会把本机配置导出回仓库。
5. **status只知道上次落盘文件。** 增加部署源文件/模板/依赖及本机settings的指纹对照，新增或删除源码也能识别；旧部署没有完整基线时明确说无法确认最新。文件一致与功能验收分开，不再把无漂移当全功能证明。
6. **缺少可验证的生成基线与跨副本保护。** 原部署没有保存可用于三方合并的生成配置基线；现在基线有哈希并随备份回滚，损坏或缺失时拒绝覆盖。未捕获的运行时代码改动会阻止部署；两个profile对同一源码的不同改动也不能在capture时互相覆盖。
7. **回退成功提示可能掩盖无快照/部分失败。** 代码回退原先固定前缀为Files restored；现在依据实际还原、删除、失败及跳过计数判断，缺失快照或部分还原明确返回未完整还原。精简期间从未记录的文件快照不能事后自动补造。
8. **原生Team与本地Team混用会破坏预设。** 已在隔离宿主复现重复team:identity导致新会话创建失败。管理页禁止在原生Team已启用时再开启本地Team；工具扩展通过公开插件清单和扩展服务契约判断归属，冲突时不重复注册。两套Team仍应择一使用，不把配置冲突说成有效协作。
9. **原生浏览器回归脚本只支持Windows。** 增加macOS的隔离运行时副本，使用同版本Electron并保持sandbox=true/contextIsolation=true/nodeIntegration=false；不修改安装版，不使用宽松浏览器配置。

## 验收范围与边界

- 重复部署：保留模拟市场安装、本机额外模型、用户开关，允许独立模板更新；冲突、损坏基线和未知代码漂移必须在写入前拒绝。
- 回滚：插件/配置恢复、真实历史及模拟记忆文件哈希保持；卸载Rewind后原生仍可冷读历史，不能只检查成功提示。
- Standard/PTC：实际write后code回退恢复原字节且对话保持；chat回退保持原始历史记录；错误目标拒绝。
- Mac原生安全载体：独立截图、区域截图、CSS吸附、编辑删除编号、可选附图、附件归属、未发送草稿及窄屏控制。
- 真机：实际入口、文件路径预览、重启后加载及原有默认开关；模型路由和凭据不写入Git。

本清单基于源码与已保存验证逐项核对。第三方完整功能不因包还在就被宣布全部验收；未加载的复杂能力以清单和真实增强入口提供。最终执行结果见VALIDATION.md本轮记录，不能把仍待验证项写成已通过。

## 生产桌面复验（2026-10-27）

- 退出前全局状态显示进行中0；预览135个受管文件后部署，备份`portable-harness-2026-10-26T23-45-26-217Z`。
- 重开后Rewind顶部菜单和逐消息入口、删除会话菜单、桌面命令联想、功能清单均实际可见；没有回退或删除用户会话。
- 用户指定四开两关、嵌套auto、Economy模型保留。内联卡片仍能渲染。
- 实际内置浏览器打开本地合成页面，截图预览正确；批注吸附`button#counter`，意见关闭再开保留，测试批注随后清理。附件发送归属由隔离安全载体覆盖，此轮没有向用户原会话发送测试图片。
- 新建验收会话仅要求模型重复已存在路径：纯文本不自动变链接，Markdown行内代码路径成功变为按钮，点击在原生侧栏预览正确文件。该文件不是模型本轮产物；没有额外文件生成或工具调用。
- 限制：停用Rewind期间未生成的文件快照无法补造；原生与本地Team仍应二选一；按需插件仅确认清单与配置边界，不宣称全部第三方功能逐项端到端通过。
