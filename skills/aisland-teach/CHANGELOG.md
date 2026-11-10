# 变更记录（Aisland-teach 相对 Matt Pocock teach 的改编）

本 Skill 改编自 [Matt Pocock 的 `teach`](https://github.com/mattpocock/skills)（`skills/productivity/teach`），保留其 MIT License。本文记录我们在其基础上做了哪些改编。

## 保留（沿袭他的学习科学骨架）

- 学习科学内核：流畅感 vs 储存强度（fluency vs storage strength），靠**提取练习、间隔（第 1/3/7 天）、混合**建立长期记忆。
- 最近发展区（ZPD）：每次「刚好够到」的挑战。
- 知识 / 技能 / 智慧三要素；智慧以真实世界可迁移衡量，必要时委托社区。
- 用 MISSION 锚定所有教学；使命变化先与用户确认。
- 参考文档作压缩单元、素材组件复用、反馈环保持紧（测验即时反馈）。
- 信任一手/权威资料，不用参数记忆冒充信源。
- MIT 授权。

## 改编（在其基础上新增/改动）

| 方面 | Matt 原版 | 我们 |
| --- | --- | --- |
| 默认模式 | 建文件教学区（MISSION/RESOURCES/learning-records/lessons(.html)/assets/） | 默认**直接在对话里教**；文件/HTML Course 只在用户**明确同意**后建 |
| 教学流程 | 有原则章节，无编号执行顺序 | 新增**7 步流程**：判断尺度 → 确认起点/结果 → 建知识依赖 → 核验来源 → 实施教学 → 复述反馈 → 收尾 |
| 评估 | 无正式量表 | 新增**复述评分量表**（准确性/结构/术语/迁移 × 0-4）+ 错误分类 + 学习记录准入门槛 |
| 深度 | 无分层 | 新增**L1–L4 深度分层**与**证据层级**（看过<能识别<能解释<能迁移<能自我纠错） |
| 结构 | 平行的 `*-FORMAT.md` | 重组成 `references/` 五个原则文档 + `agents/openai.yaml` |
| 语言 | 英文 | 中文为主（保留中英术语）+ 增加「比喻必须边界」原则 |
| HTML 产物 | 默认产出、Tufte 风、互相锚链 | 改为**同意制**、非装饰化、可访问性校验；借鉴 AIPath 但禁抄文案/视觉/代码/构图 |
| 授权 | MIT (c) 2026 Matt Pocock | 保留 MIT + 新增 Aisland-SJL 版权行 |
