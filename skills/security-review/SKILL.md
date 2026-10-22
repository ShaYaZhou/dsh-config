---
name: security-review
description: Read-only security review of a diff, directory, or PR, including a local static scan for likely secrets and risky patterns. Use when the user asks for a security audit or before shipping code that touches untrusted input, credentials, permissions, subprocesses, or the filesystem.
---

# 安全审查

默认只读。目标是把风险讲清楚并给出可验证的修复方向，不是演示利用。

## 第一步：静态扫描

脚本与本 `SKILL.md` 同目录（部署后位于 `<DSH_HOME>/profiles/desktop/agent-capabilities/skills/security-review/scan.mjs`）。优先用当前 skill 目录的相对路径；`DSH_HOME` 未设置时不要猜。

PowerShell：

```powershell
node .\scan.mjs <目标路径> --json
```

Bash：

```bash
node ./scan.mjs <目标路径> --json
```

- 只读扫描，跳过 `.git`、`node_modules`、`build`、`dist`、`.local`、符号链接和二进制/超大文件；默认最多 20000 个文件。
- 输出里的密钥一律为 `[redacted]`。不要把扫描结果中的任何原值复制到回复、日志或新文件。
- 每条命中只是**审查线索**，不是确认漏洞。必须回到源码确认可达性和影响，再决定是否报告。
- 可选 `--fail-on high|medium|low` 用于门禁：本仓库接成 `npm run scan:security`（`--fail-on high`，只有 high 命中返回 1），`npm run check` = `npm test` + 该扫描。缺值或非法值返回 2，不会静默放行。

## 第二步：人工审查

按信任边界走，不要只按文件清单走：

1. **入口**：用户输入、网络请求、文件路径、环境变量、IPC/消息、MCP 工具参数、子代理输出。确认验证发生在使用之前，且失败时拒绝而不是降级放行。
2. **授权**：每个敏感操作是否检查了“谁可以对谁做什么”。跨会话、跨插件、跨项目时要确认没有读取对方私有状态或绕过权限。
3. **注入**：shell 命令拼接、SQL、模板、路径拼接、`eval`/`new Function`、HTML 注入。确认参数化或转义，而不是靠黑名单。
4. **文件与进程**：路径穿越、符号链接、TOCTOU、临时文件权限、子进程继承的环境变量、工作目录。
5. **凭据**：密钥是否进入源码、日志、错误信息、备份或会话记录；是否从环境/密钥库读取；轮换和最小权限是否可行。
6. **网络**：SSRF、重定向跟随、TLS 校验关闭、把用户可控 URL 传给服务端请求。
7. **依赖与供应链**：新增依赖是否必要、版本是否固定、锁文件是否同步、安装脚本是否可信。
8. **失败模式**：异常是否被吞掉导致保护失效；超时/取消后是否留下半完成状态；回滚是否可用。
9. **数据**：日志和报告是否包含个人信息、会话内容或记忆；保留期限和访问范围是否明确。

## 报告

按严重度排序：

```text
[严重度] 一句话结论
位置：path/to/file.ext:123
入口/前提：攻击者需要什么条件
影响：能读到/改到什么，是否需要用户交互
证据：最小代码路径或扫描命中（已脱敏）
修复：具体改法；无法立即修复时给出缓解措施
```

- 严重度按“可达性 × 影响”判断，不按模式名称判断。无法确认可达性的写“待确认”，并说明还缺什么。
- 不报告纯风格问题；不把测试夹具里的假密钥当泄露，除非它看起来像真实凭据。
- 需要实际验证时只做无害复现（例如本地只读调用），不执行破坏性命令、不横向移动、不外传数据。
- 没有发现时说明扫描范围、跳过的目录和未覆盖项；静态扫描不能替代依赖审计、模糊测试或真实渗透。

## 本仓库边界

- 不提交凭据、个人绝对路径、实际会话/记忆、`node_modules`、`build` 或 `.local` 内容。
- 修改配置或源码后运行 `rtk proxy node --test test/portable.test.mjs`；完整回归用 `rtk npm test`。
- 安装验证在隔离 `DSH_HOME` 中进行；桌面功能要验证真实沙箱设置，不能用宽松设置代替。
- 插件只能通过公开接口协作，不读取另一插件的私有状态、不操作其 DOM、不直接改其存储。
