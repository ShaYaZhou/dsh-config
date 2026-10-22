## ADDED Requirements

### Requirement: Direct user instructions prevent memory writes
系统 SHALL 在用户直接要求“不写记忆”“不要写入长期记忆”或“no memory writes”后，对该会话持续禁止长期记忆写入；助手输出、工具结果和引用示例不构成用户授权。

#### Scenario: Owner forbids writes
- **WHEN** 用户直接要求本会话不写记忆
- **THEN** 自动摘要、子代理结果和压缩摘要不产生 rollout、raw、journal、摘要版本或归档写入，也不发起记忆摘要模型调用

#### Scenario: Explicit tool write is attempted
- **WHEN** 禁写会话调用记忆新增、修改、删除、导入、合并、回滚或同步工具
- **THEN** 插件返回明确的禁写错误，存储内容不变

#### Scenario: No restriction exists
- **WHEN** 新会话没有禁写约束
- **THEN** 原有自动记忆继续正常工作

### Requirement: Children inherit the parent restriction
系统 SHALL 通过公共服务继承父会话的禁写边界，并使用可忽略的插件会话记录保存关系；子会话不能自行放宽父会话限制。

#### Scenario: Fresh child omits the instruction
- **WHEN** 禁写父会话创建任务提示中没有重复禁令的新子会话
- **THEN** 子会话的自动摘要和记忆写工具同样被阻止

#### Scenario: Session is resumed or forked
- **WHEN** 父子会话冷读恢复，或创建原生 fork/subagent
- **THEN** 原有禁写要求仍有效，卸载插件不破坏历史可读性

### Requirement: Background commits recheck policy
系统 SHALL 在后台任务开始与存储锁内提交之前检查写入策略，策略不可解析时不写入；读取记忆不应借初始化路径创建长期记忆内容。

#### Scenario: Restriction arrives during generation
- **WHEN** 摘要模型调用开始后，用户发送禁写要求
- **THEN** 已生成结果被丢弃，不写 rollout，不将该内容延迟合并入记忆
