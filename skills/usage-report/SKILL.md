---
name: usage-report
description: Explain or obtain token usage, cache-hit rate, context pressure, timing, and optional cost estimates via the native usage_report tool. Use when the user asks how many tokens a session used, how close it is to the context limit, why it is slow, or what it costs.
---

# 用量与成本

## 工具

`usage_report` 读取 DSH 原生会话投影，不解析日志文件：

- 不传参数：报告当前会话。
- `session_ids: ["<id>", ...]`：报告指定会话，最多 20 个，每个都要通过当前会话的访问检查。
- 会话不存在、未加载或无投影时返回 `unavailable: true`，不会猜测数字。

会话 ID 从 `list_recent_sessions`、桌面侧栏或用户处获取；不要为了“顺便看看”去查询无关会话。

## 指标

| 字段 | 含义 |
| --- | --- |
| `tokens.uncachedInputTokens` | 未命中缓存、按普通输入计费的输入 token |
| `tokens.cacheReadTokens` | 从提示缓存读取的 token |
| `tokens.cacheWriteTokens` | 写入提示缓存的 token |
| `tokens.outputTokens` | 模型输出 token |
| `totalTokens` | 以上四项之和 |
| `cacheHitRate` | `cacheRead / (uncachedInput + cacheRead)`；无输入时为 `null` |
| `context.pressureTokens` / `context.contextWindow` | 压缩压力与窗口大小 |
| `context.pressurePercent` | 压力占窗口比例；接近 1 时即将压缩 |
| `context.projectedTokens` | 按当前上下文增量推算的下一次占用（原生提供时） |
| `stats.llmMs` / `stats.toolMs` | 模型调用与工具执行耗时 |
| `stats.ttftMs` | 首 token 延迟累计 |
| `stats.turns` / `stats.steps` | 轮次与步数 |
| `cost` | 估算费用；未配置价格时为 `null` |

## 成本

DSH 原生只记录 token，不记录价格。`cost` 只有在模块配置里为对应模型提供费率后才存在：

```json
{
  "pricing": {
    "<model-id>": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
  }
}
```

- 单位是“每百万 token”，四项都可省略，但 `input` 和 `output` 至少要有一个数字。
- 没有匹配的模型费率时该会话 `cost` 为 `null`；`totals.cost` 只汇总有价格的会话，并给出 `unpricedSessions`。
- 这是**估算**，不是账单。不要凭记忆填写厂商价格；用户没有提供费率就只报告 token。
- 不要把不同模型、不同轮次的会话直接按总 token 排名当作效率结论。

## 解读

- 缓存命中高、未缓存输入低，通常说明前缀复用良好；但缓存写入本身也可能计价。
- `pressurePercent` 高说明上下文接近窗口上限，优先建议压缩、拆分任务或减少无关读取，而不是继续堆工具输出。
- `llmMs` 远大于 `toolMs`：瓶颈在模型；反过来则在工具或等待外部进程。
- `ttftMs` 高但 `decodeMs` 不高：首 token 慢，可能是排队或冷启动。
- token 多不等于质量高，token 少也不等于高效；要结合任务是否完成、是否返工来判断。

## 输出

- 先给结论（用了多少、贵不贵、是否接近上限），再给表格或字段明细。
- 明确标注“估算”以及哪些会话没有价格。
- 不粘贴无关会话的标题、路径或内容；只保留回答所需的最小信息。
