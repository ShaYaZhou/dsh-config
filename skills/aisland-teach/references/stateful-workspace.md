# 状态化教学工作区

只在用户提出连续学习目标，或明确要求保存学习进度时使用。短教学不创建工作区。

优先适配现有项目结构。没有现成结构时，使用最小布局：

```text
<learning-workspace>/
├── MISSION.md
├── RESOURCES.md
├── NOTES.md
├── lessons/
├── reference/
├── learning-records/
└── assets/
```

目录按需创建，不预先生成空文件夹。

## MISSION.md

```markdown
# Mission: <主题>

## Why
<学习完成后，现实中会发生什么变化>

## Success looks like
- <可观察成果>

## Constraints
- <时间、基础、工具或范围>

## Out of scope
- <当前不追逐的相邻主题>
```

- 一个工作区只维护一个主 Mission；
- Mission 变化需要用户确认；
- 保持一屏以内。

## RESOURCES.md

只保存高质量、与 Mission 直接相关的资源：

```markdown
# Resources

## Knowledge
- [来源](URL)：覆盖什么，什么时候使用。

## Practice / Community
- [练习或社区](URL)：提供什么真实反馈。

## Gaps
- 当前缺少的可靠资料。
```

宁可保留五个高质量来源，也不要堆三十个未评估链接。

## NOTES.md

只记录会影响未来教学的偏好与约束，例如：

- 用户喜欢或不喜欢的解释方式；
- 已确认的术语习惯；
- 需要避免的教学摩擦；
- HTML Course 的项目位置。

不写会话流水账。

## learning-records

文件命名：`0001-short-title.md`，顺序递增。

```markdown
# 已建立的能力或修正

<学会了什么，以及它为什么改变后续教学。>

## Evidence
<复述、练习、迁移或自我纠错证据。>
```

- 材料被讲过不等于学会；
- 旧理解被修正时标记 superseded，不删除历史；
- 记录能力变化，不记录每次活动。

## lessons 与 reference

- `lessons/`：经确认需要长期保存的课程正文或课后笔记，默认使用 Markdown；
- `reference/`：术语表、流程图、速查表等压缩知识；
- HTML 只在用户明确同意后生成，并优先接入现有课程网站；
- `assets/` 只存真实复用两次以上的样式、组件和媒体。
