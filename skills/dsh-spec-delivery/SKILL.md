---
name: dsh-spec-delivery
description: >-
  Deliver a feature end to end in DSH from a natural-language request: write an OpenSpec specification, let the main session delegate implementation and independent review to linked sessions, run acceptance checks, fix gaps, and report evidence. Use when the user asks “先写 spec，再自动分配嵌套会话执行和验收”, “用 OpenSpec 自动实现并验收”, or “spec first, then implement and verify automatically”. Do not use for research-only or specification-only requests.
---

# Spec 到交付

这是主会话的完整交付流程。用户明确要求规格、实现和验收时，一次请求即授权连续推进这些阶段，不再要求用户依次输入 propose、apply、collaborate 或其他命令。只要目标和项目明确，直接执行。若用户只要求研究或写规格，使用对应的官方技能并在该范围结束。

本技能直接使用 OpenSpec CLI 的 artifact instructions；不调用只负责规划并要求另起一轮的 `openspec-propose` 技能。保留官方技能原文，供需要分阶段控制时使用。普通权限、显式暂停、归档保护和用户后来给出的限制仍然生效。

## 1. 定位目标与规格根

- 先确认当前工作目录、Git 根和现有项目结构，不假设新建应用或重新搭脚手架。
- 从原始用户消息提取需求、约束和不改动的行为。只有答案会改变范围、外部行为或验收标准且无法从代码查明时才询问；普通实现细节自行决定并记录。
- 检查 `openspec --version`，本部署固定 `1.14.3`。版本错误需报告实际值，不静默下载 `@latest`。
- 执行 `openspec list --json` 并读取 `root`。若只是没有 OpenSpec 根，这个明确的端到端请求授权在当前项目 Git 根执行 `openspec init --tools dsh --profile core --language Chinese --no-animation`。不要初始化其他工作区。
- 已声明 store 但解析失败不等于未初始化；先读取诊断并修复明确的问题，不能抹掉声明。用户指定 store 时先查询注册信息，此后全部规格命令保持同一个 `--store`。
- 选择本次变更；用户明确要继续某个变更时复用它，否则创建有意义的新变更，不能覆盖无关的现有变更。

## 2. 主会话写规格和任务

1. 用 `openspec new change <name>` 创建变更，再用 `openspec status --change <name> --json` 获得 artifact 依赖。
2. 对每个 ready artifact 先运行 `openspec instructions <artifact-id> --change <name> --json`，遵循返回的模板、依赖、输出路径和项目上下文，再写文件。用实际 schema，不凭记忆假定文件名。
3. 需求使用稳定的标识，例如 R1、R2，写清可观察的行为和正反验收场景。交互要求必须写出真实点击、拖动、输入、发送和关闭后的结果，不能只写“界面正常”。
4. 设计保持高内聚、低耦合；优先现有原生能力。`tasks.md` 的实现和验收任务引用需求标识，说明所需证据。只覆盖用户请求，不擅自添加功能。
5. 运行 `openspec validate <name> --strict`。格式通过只意味着规格结构合法。
6. 简短报告规格位置、主要验收条件和接下来的分工，然后在同一轮继续实现。不要把“规格已写完”作为完整交付请求的终点。

## 3. 主会话自动分派

- 先调用 `list_session_models`，根据实际可用模型自行决定工作流数量、模型和简短理由；不要求用户填写人数、模型或再打开管理页。不要编造模型价格或能力。
- 至少将实际实现委派给可见的独立子会话。任务规模小可以只安排一个实现者；独立部分才并行。选择的数量来自任务，不是固定阵容。
- 用 `start_session`，通常 `context="fresh"`、`agent_preset="standard"`，提供完整任务说明：规格根、变更、需求标识、允许修改的文件、需要保留的行为、具体测试和预期交付。
- 只有主会话写规格、设计、任务勾选和验收记录。子会话不得编辑 `openspec/**` 或其他实现者的文件。
- 并行改代码前创建独立 worktree 并传 cwd；没有隔离条件就串行。结果进入不同 worktree 时，主会话先审阅和整合到交付工作区，再对整合后的状态验收，不能把未整合分支当作已交付。
- `create_worktree` 会切换调用会话的目录。先记录交付目录和固定基准 commit；每次准备 worktree 前回到交付目录，用同一基准创建，全部准备完回到交付目录再分派。只带入用户明确选中的忽略配置，不自动复制凭据或未提交内容。
- 子会话不能创建孙会话；需要更多人手时向主会话发消息，由主会话决定增加同级任务。
- 用 `wait_for_sessions` 和 `read_session` 收集真实结果。尚在运行、失败、阻塞或停止都不能当作完成。明确暂停的家族不能被技能自行恢复，应向用户说明这一冲突。

## 4. 验收和修复闭环

- 实现结束后，由主会话检查实际 diff、调用方和集成位置，运行规格要求的测试。需要界面或真实宿主的行为必须实际操作；缺少必要运行条件时报告缺少什么，不改写验收条件来取得通过。
- 分派独立审查给没有写该实现的 fresh 子会话，通常 `agent_preset="reviewer"`。让它对照需求和当前文件寻找未实现、回归和缺失证据，不让它改实现。数量和模型仍由主会话按工作量选择。
- 审查者受工具约束时，由主会话运行命令和界面验证，把准确的结果交给审查者。审查通过与实际测试都要有依据。
- 发现缺口就把明确的问题交回实现者，等待修复，再重跑受影响的验收；未解决的缺口不能变成“以后再做”或擅自降级的范围。
- 只有主会话核对行为和证据后才勾选任务。记录简短 `acceptance.md`，逐项列出需求标识、检查方式、真实结果和证据位置；失败或未执行要明确标记。不要保存隐藏推理、凭据或私人数据。
- 用 `openspec instructions apply --change <name> --json` 检查剩余任务；若还有未完成项继续工作，或报告具体阻塞，不能用规划完成标记冒充交付。
- 自动验收不是自动发布授权。只有用户另有授权才推送、部署、发布或归档；普通本地实现和验证不需要反复确认。已授权范围内的可逆操作正常继续。

## 5. 最后汇报

用简短中文交代变更位置、已交付行为、验收证据和真实限制。保留规格及历史。不要让用户把子会话输出逐个复制回主会话，也不要让用户手工串联命令。
