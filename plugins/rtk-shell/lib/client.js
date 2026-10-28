window.__ModuleLoader__.load({
  id: "@local/dsh-rtk-shell",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const { Switch } = require("@deepseek-ai/dsh-client-ui-primitives");
    const inject = ["slots", "configForms", "connection"];
    const defaults = {
      enabled: true,
      git: true,
      logs: true,
      search: true,
      tests: true,
      excludedCommands: [],
      customRules: [],
    };
    const groups = [
      ["git", "Git 查询", "状态、差异、提交记录；机器格式保持原样"],
      ["logs", "日志读取", "单文件 cat / Get-Content，.log 与 .txt 去重汇总"],
      ["search", "文件搜索", "保留 rg / find 的原参数与范围，汇总高输出"],
      [
        "tests",
        "运行测试",
        "npm / pnpm / Node / pytest / cargo / go 的安全子集",
      ],
    ];
    function apply(ctx) {
      const form = ctx.configForms.get("rtk-rules");
      async function preview(command, dialect, settings, signal) {
        const result = await ctx.connection.rpc.call(
          "/api",
          "rtkRules/preview",
          { args: { request: { command, dialect, settings } } },
          signal,
        );
        if (!result.ok) throw Error(result.error?.message ?? "预览失败");
        return result.value;
      }
      function Page() {
        const snap = React.useSyncExternalStore(
          (fn) => form.subscribe(fn),
          () => form.getSnapshot(),
        );
        const settings = { ...defaults, ...snap.value };
        const [busy, setBusy] = React.useState(false),
          [error, setError] = React.useState("");
        const [command, setCommand] = React.useState(""),
          [filter, setFilter] = React.useState("summary");
        const [excluded, setExcluded] = React.useState("");
        const [probe, setProbe] = React.useState("git status"),
          [dialect, setDialect] = React.useState("bash"),
          [answer, setAnswer] = React.useState(null);
        const lifetime = React.useRef(null);
        React.useEffect(() => {
          const controller = new AbortController();
          lifetime.current = controller;
          return () => controller.abort();
        }, []);
        const disabled = busy || snap.status !== "ready" || !snap.writable;
        async function act(operation) {
          const signal = lifetime.current.signal;
          setBusy(true);
          setError("");
          try {
            await operation(signal);
          } catch (e) {
            if (!signal.aborted) setError(e.message ?? String(e));
          } finally {
            if (!signal.aborted) setBusy(false);
          }
        }
        async function save(key, value, signal) {
          await preview("", dialect, { ...settings, [key]: value }, signal);
          signal.throwIfAborted();
          if (!(await form.set(key, value))) throw Error("保存未成功");
          if (!signal.aborted) setAnswer(null);
        }
        const set = (key, value) => act((signal) => save(key, value, signal));
        return h(
          "section",
          { className: "dsh-rtk-settings" },
          h("h2", null, "命令规则"),
          h(
            "p",
            { className: "muted" },
            "在原生 Shell 执行前应用输出过滤。只执行一次；失败、停止和超时不回退重跑。",
          ),
          h(
            "div",
            { className: "row master" },
            h(
              "div",
              null,
              h("strong", null, "自动改写"),
              h(
                "p",
                { className: "muted" },
                "关闭后保留原生 Shell 与本地环境变量。",
              ),
            ),
            h(Switch, {
              label: "自动改写",
              checked: settings.enabled,
              disabled,
              onChange: (value) => set("enabled", value),
            }),
          ),
          h("h3", null, "内置规则"),
          ...groups.map(([key, label, description]) =>
            h(
              "div",
              { className: "row", key },
              h(
                "div",
                null,
                h("strong", null, label),
                h("p", { className: "muted" }, description),
              ),
              h(Switch, {
                label,
                checked: settings[key],
                disabled,
                onChange: (value) => set(key, value),
              }),
            ),
          ),
          h("h3", null, "自定义精确规则"),
          h(
            "p",
            { className: "muted" },
            "只匹配完整命令。可选常用外部程序；不接受管道、重定向或变量。输出汇总为启发式，不用于通过数量统计或结构化解析。",
          ),
          ...settings.customRules.map((rule, index) =>
            h(
              "div",
              { className: "rule", key: index },
              h("code", null, rule.command),
              h(
                "span",
                { className: "badge" },
                rule.filter === "err" ? "错误过滤" : "输出汇总",
              ),
              h(Switch, {
                label: "启用规则 " + rule.command,
                checked: rule.enabled,
                disabled,
                onChange: (value) =>
                  set(
                    "customRules",
                    settings.customRules.map((r, i) =>
                      i === index ? { ...r, enabled: value } : r,
                    ),
                  ),
              }),
              h(
                "button",
                {
                  disabled,
                  onClick: () =>
                    set(
                      "customRules",
                      settings.customRules.filter((_, i) => i !== index),
                    ),
                },
                "删除",
              ),
            ),
          ),
          h(
            "div",
            { className: "editor" },
            h("input", {
              "aria-label": "自定义命令",
              placeholder: "例如 cargo check",
              value: command,
              onChange: (e) => setCommand(e.target.value),
              disabled,
            }),
            h(
              "select",
              {
                "aria-label": "过滤方式",
                value: filter,
                onChange: (e) => setFilter(e.target.value),
                disabled,
              },
              h("option", { value: "summary" }, "输出汇总"),
              h("option", { value: "err" }, "错误 / 警告过滤"),
            ),
            h(
              "button",
              {
                disabled: disabled || !command.trim(),
                onClick: () =>
                  act(async (signal) => {
                    await save(
                      "customRules",
                      [
                        ...settings.customRules,
                        { command: command.trim(), filter, enabled: true },
                      ],
                      signal,
                    );
                    if (!signal.aborted) setCommand("");
                  }),
              },
              "添加规则",
            ),
          ),
          h("h3", null, "精确排除"),
          ...settings.excludedCommands.map((item, index) =>
            h(
              "div",
              { className: "rule", key: index },
              h("code", null, item),
              h(
                "button",
                {
                  disabled,
                  onClick: () =>
                    set(
                      "excludedCommands",
                      settings.excludedCommands.filter((_, i) => i !== index),
                    ),
                },
                "移除",
              ),
            ),
          ),
          h(
            "div",
            { className: "editor" },
            h("input", {
              "aria-label": "排除命令",
              placeholder: "完整命令，例如 git status",
              value: excluded,
              onChange: (e) => setExcluded(e.target.value),
              disabled,
            }),
            h(
              "button",
              {
                disabled: disabled || !excluded.trim(),
                onClick: () =>
                  act(async (signal) => {
                    await save(
                      "excludedCommands",
                      [
                        ...new Set([
                          ...settings.excludedCommands,
                          excluded.trim(),
                        ]),
                      ],
                      signal,
                    );
                    if (!signal.aborted) setExcluded("");
                  }),
              },
              "添加排除",
            ),
          ),
          h("h3", null, "改写预览"),
          h(
            "p",
            { className: "muted" },
            "只计算规则，不运行命令，不访问输入的文件。使用当前已保存的规则。",
          ),
          h(
            "div",
            { className: "editor" },
            h(
              "select",
              {
                "aria-label": "命令语言",
                disabled: busy,
                value: dialect,
                onChange: (e) => {
                  setDialect(e.target.value);
                  setAnswer(null);
                },
              },
              h("option", { value: "bash" }, "Bash · macOS / Linux"),
              h("option", { value: "pwsh" }, "PowerShell · Windows"),
            ),
            h("input", {
              "aria-label": "预览命令",
              disabled: busy,
              value: probe,
              onChange: (e) => {
                setProbe(e.target.value);
                setAnswer(null);
              },
            }),
            h(
              "button",
              {
                disabled: busy,
                onClick: () =>
                  act(async (signal) => {
                    const value = await preview(
                      probe,
                      dialect,
                      settings,
                      signal,
                    );
                    if (!signal.aborted) setAnswer(value);
                  }),
              },
              "预览改写",
            ),
          ),
          answer &&
            h(
              "div",
              { className: "preview", role: "status" },
              h("strong", null, answer.changed ? "将自动改写" : "保持原样"),
              h("pre", null, answer.rewritten || "（空命令）"),
              h("p", { className: "muted" }, answer.reason),
            ),
          h(
            "p",
            { className: "muted" },
            "需要完整原始输出时使用 rtk proxy。配置由原生设置保存，重新部署保留；Windows 实机执行仍需验证，预览通过不等于实际执行通过。",
          ),
          error && h("p", { role: "alert", className: "error" }, error),
        );
      }
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `.dsh-rtk-settings{max-width:840px;padding:24px;line-height:1.55;color:var(--dsw-alias-label-primary,inherit)}.dsh-rtk-settings h2{margin:0 0 8px}.dsh-rtk-settings h3{margin:28px 0 10px;font-size:15px}.dsh-rtk-settings .muted{font-size:13px;opacity:.7;margin:4px 0 10px}.dsh-rtk-settings .row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid #8883}.dsh-rtk-settings .master{padding:16px;border:1px solid #8883;border-radius:12px;margin:18px 0}.dsh-rtk-settings .editor,.dsh-rtk-settings .rule{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0}.dsh-rtk-settings input{flex:1;min-width:150px}.dsh-rtk-settings input,.dsh-rtk-settings select,.dsh-rtk-settings button:not([role="switch"]){font:inherit;font-size:13px;padding:8px 10px;border:1px solid #8885;border-radius:7px;color:inherit;background:transparent}.dsh-rtk-settings button:not([role="switch"]){cursor:pointer}.dsh-rtk-settings button:not([role="switch"]):disabled{opacity:.45;cursor:default}.dsh-rtk-settings :focus-visible{outline:2px solid #7361cf;outline-offset:2px}.dsh-rtk-settings .rule{padding:10px;border:1px solid #8883;border-radius:8px}.dsh-rtk-settings code{flex:1;overflow-wrap:anywhere}.dsh-rtk-settings .badge{font-size:11px;opacity:.65}.dsh-rtk-settings .preview{padding:14px;background:#8881;border:1px solid #8883;border-radius:10px}.dsh-rtk-settings pre{white-space:pre-wrap;overflow-wrap:anywhere}.dsh-rtk-settings .error{color:#bd4343}`;
        document.head.append(style);
        return () => style.remove();
      });
      ctx.slots.inject("settings.section", () =>
        ctx.effect(() =>
          ctx.configForms.whileServed(["rtk-rules"], () =>
            ctx.slots.register(
              {
                name: "settings.section",
                id: "rtk-rules",
                order: 26,
                label: "命令规则",
              },
              Page,
            ),
          ),
        ),
      );
    }
    return { inject, apply };
  },
});
