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
        const [expanded, setExpanded] = React.useState({});
        const [editing, setEditing] = React.useState(null);
        const toggle = (id) =>
          setExpanded((value) => ({ ...value, [id]: !value[id] }));
        const reveal = (id) =>
          setExpanded((value) => ({ ...value, [id]: true }));
        const chevron = (open) =>
          h(
            "svg",
            {
              viewBox: "0 0 16 16",
              width: 16,
              height: 16,
              "aria-hidden": true,
              className: open ? "chevron open" : "chevron",
            },
            h("path", {
              d: "m4 6 4 4 4-4",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 1.5,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }),
          );
        function row(id, title, description, body, switchProps) {
          return h(
            "div",
            { className: "hook-item", key: id },
            h(
              "div",
              { className: "hook-row" },
              h(
                "button",
                {
                  className: "disclosure",
                  "aria-label": (expanded[id] ? "收起 " : "展开 ") + title,
                  "aria-expanded": !!expanded[id],
                  "aria-controls": "hook-detail-" + id,
                  onClick: () => toggle(id),
                },
                h("span", { className: "hook-name" }, title),
                chevron(expanded[id]),
              ),
              switchProps && h(Switch, switchProps),
            ),
            h(
              "div",
              {
                id: "hook-detail-" + id,
                className: "hook-detail",
                hidden: !expanded[id],
              },
              description && h("p", { className: "muted" }, description),
              body,
            ),
          );
        }
        const examples = {
          git: "git status",
          logs: 'cat "server.log"',
          search: "rg -n ERROR .",
          tests: "npm test",
        };
        const tryCommand = (value) => {
          setProbe(value);
          setAnswer(null);
          reveal("preview");
        };
        const editor = h(
          "div",
          null,
          h(
            "p",
            { className: "muted" },
            "精确匹配单条外部命令。只包装输出，不运行额外脚本；复杂语法保持原样。",
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
          ),
          h(
            "div",
            { className: "actions" },
            h(
              "button",
              {
                disabled: disabled || !command.trim(),
                onClick: () =>
                  act(async (signal) => {
                    if (
                      editing !== null &&
                      !settings.customRules.some((r) => r.command === editing)
                    )
                      throw Error("规则已变化，请取消后重新编辑");
                    const rule = {
                      command: command.trim(),
                      filter,
                      enabled:
                        editing === null
                          ? true
                          : settings.customRules.find(
                              (r) => r.command === editing,
                            )?.enabled,
                    };
                    const rules =
                      editing === null
                        ? [...settings.customRules, rule]
                        : settings.customRules.map((r) =>
                            r.command === editing ? rule : r,
                          );
                    await save("customRules", rules, signal);
                    if (!signal.aborted) {
                      setCommand("");
                      setEditing(null);
                      setExpanded((value) => ({ ...value, editor: false }));
                    }
                  }),
              },
              editing === null ? "添加 Hook" : "保存修改",
            ),
            h(
              "button",
              {
                disabled,
                onClick: () => {
                  setEditing(null);
                  setCommand("");
                  setExpanded((value) => ({ ...value, editor: false }));
                },
              },
              "取消",
            ),
          ),
        );
        const exclusions = h(
          "div",
          null,
          ...settings.excludedCommands.map((item, index) =>
            h(
              "div",
              { className: "exclusion", key: item },
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
        );
        const previewForm = h(
          "div",
          null,
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
        );
        return h(
          "section",
          { className: "dsh-rtk-settings" },
          h(
            "header",
            { className: "page-heading" },
            h(
              "div",
              null,
              h("h2", null, "Hooks"),
              h("p", { className: "muted" }, "用户配置 · 所有项目"),
            ),
            h(
              "div",
              { className: "master-toggle" },
              h("span", null, settings.enabled ? "已启用" : "已暂停"),
              h(Switch, {
                label: "自动改写",
                checked: settings.enabled,
                disabled,
                onChange: (value) => set("enabled", value),
              }),
            ),
          ),
          h(
            "div",
            { className: "hook-group" },
            h(
              "div",
              { className: "event-heading" },
              h(
                "svg",
                {
                  width: 22,
                  height: 22,
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 1.6,
                  "aria-hidden": true,
                },
                h("circle", { cx: 12, cy: 5, r: 2 }),
                h("path", {
                  d: "M12 7v11m-6-7H3v4a5 5 0 0 0 9 3 5 5 0 0 0 9-3v-4h-3",
                }),
              ),
              h(
                "div",
                null,
                h("h3", null, "Shell 执行前"),
                h(
                  "p",
                  { className: "muted" },
                  "Bash / PowerShell · 原生执行链",
                ),
              ),
            ),
            ...groups.map(([key, label, description]) =>
              row(
                key,
                "RTK · " + label,
                description,
                h(
                  "div",
                  { className: "detail-meta" },
                  h("span", { className: "badge" }, "内置"),
                  h("code", null, examples[key]),
                  h(
                    "button",
                    {
                      className: "quiet-button",
                      onClick: () => tryCommand(examples[key]),
                    },
                    "预览此 Hook",
                  ),
                ),
                {
                  label,
                  checked: settings[key],
                  disabled,
                  onChange: (value) => set(key, value),
                },
              ),
            ),
            ...settings.customRules.map((rule, index) =>
              row(
                "custom-" + index,
                rule.command,
                "精确匹配 · " +
                  (rule.filter === "err" ? "错误过滤" : "输出汇总"),
                h(
                  "div",
                  { className: "actions" },
                  h(
                    "button",
                    { onClick: () => tryCommand(rule.command) },
                    "预览此 Hook",
                  ),
                  h(
                    "button",
                    {
                      disabled: disabled || editing !== null,
                      onClick: () => {
                        setEditing(rule.command);
                        setCommand(rule.command);
                        setFilter(rule.filter);
                        reveal("editor");
                      },
                    },
                    "编辑",
                  ),
                  h(
                    "button",
                    {
                      disabled: disabled || editing !== null,
                      onClick: () =>
                        set(
                          "customRules",
                          settings.customRules.filter((_, i) => i !== index),
                        ),
                    },
                    "删除",
                  ),
                ),
                {
                  label: "启用规则 " + rule.command,
                  checked: rule.enabled,
                  disabled: disabled || editing !== null,
                  onChange: (value) =>
                    set(
                      "customRules",
                      settings.customRules.map((r, i) =>
                        i === index ? { ...r, enabled: value } : r,
                      ),
                    ),
                },
              ),
            ),
            h(
              "div",
              { className: "group-footer" },
              h(
                "button",
                {
                  className: "add-hook",
                  disabled: disabled || editing !== null,
                  onClick: () => {
                    setEditing(null);
                    reveal("editor");
                  },
                },
                "＋ 添加 Hook",
              ),
            ),
          ),
          h(
            "div",
            { className: "support-group" },
            expanded.editor &&
              row(
                "editor",
                editing === null ? "新建 Hook" : "编辑 Hook",
                null,
                editor,
              ),
            row(
              "exclusions",
              "排除命令",
              "精确排除优先于内置与自定义 Hook。",
              exclusions,
            ),
            row(
              "preview",
              "预览",
              "只展示将执行的命令，不运行命令或读取文件。",
              previewForm,
            ),
          ),
          h(
            "p",
            { className: "footer-note" },
            "当前接入 Shell 执行前。运行中任务不重启，失败不回退重跑；其他生命周期事件尚未接入。",
          ),
          error && h("p", { role: "alert", className: "error" }, error),
        );
      }

      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `
.dsh-rtk-settings{--hook-line:var(--dsw-alias-border-l2,#e5e5e7);--hook-soft:var(--dsw-alias-bg-layer-1,#f7f7f8);max-width:800px;padding:24px;line-height:1.5;color:var(--dsw-alias-label-primary,inherit)}
.dsh-rtk-settings .page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}
.dsh-rtk-settings h2{font-size:22px;margin:0 0 4px;font-weight:600}.dsh-rtk-settings h3{font-size:15px;margin:0;font-weight:600}
.dsh-rtk-settings .muted{font-size:13px;opacity:.65;margin:3px 0 0}.dsh-rtk-settings .master-toggle{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-rtk-settings .hook-group,.dsh-rtk-settings .support-group{border:1px solid var(--hook-line);border-radius:14px;overflow:hidden;margin-bottom:16px}
.dsh-rtk-settings .event-heading{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--hook-line)}
.dsh-rtk-settings .event-heading>svg{flex-shrink:0;opacity:.7}.dsh-rtk-settings .hook-item+.hook-item{border-top:1px solid var(--hook-line)}
.dsh-rtk-settings .hook-row{display:flex;align-items:center;gap:14px;min-height:50px;padding:0 18px 0 20px}
.dsh-rtk-settings .disclosure{display:flex;flex:1;align-items:center;justify-content:space-between;gap:16px;min-width:0;min-height:50px;padding:10px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-rtk-settings .hook-name{font-size:14px;overflow-wrap:anywhere}.dsh-rtk-settings .chevron{flex-shrink:0;opacity:.55;transition:transform .15s}.dsh-rtk-settings .chevron.open{transform:rotate(180deg)}
.dsh-rtk-settings .hook-row:hover{background:var(--hook-soft)}.dsh-rtk-settings .hook-detail{padding:0 20px 18px;background:var(--hook-soft);border-top:1px solid var(--hook-line)}.dsh-rtk-settings .hook-detail[hidden]{display:none}
.dsh-rtk-settings .hook-detail>.muted{padding-top:14px}.dsh-rtk-settings .detail-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:14px;font-size:12px}
.dsh-rtk-settings .badge{font-size:11px;border:1px solid var(--hook-line);border-radius:5px;padding:2px 6px;opacity:.65}.dsh-rtk-settings code{overflow-wrap:anywhere}
.dsh-rtk-settings .group-footer{padding:10px 20px;border-top:1px solid var(--hook-line)}
.dsh-rtk-settings .editor,.dsh-rtk-settings .actions,.dsh-rtk-settings .exclusion{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px}.dsh-rtk-settings .exclusion code{flex:1}
.dsh-rtk-settings input{flex:1;min-width:150px}.dsh-rtk-settings input,.dsh-rtk-settings select,.dsh-rtk-settings button:not([role="switch"]):not(.disclosure){box-sizing:border-box;font:inherit;font-size:13px;padding:7px 10px;border:1px solid var(--hook-line);border-radius:7px;color:inherit;background:transparent}
.dsh-rtk-settings button:not([role="switch"]){cursor:pointer}.dsh-rtk-settings button:disabled{opacity:.45;cursor:default}.dsh-rtk-settings button.add-hook{border:0!important;padding:4px 0!important;font-size:13px}.dsh-rtk-settings button.quiet-button{margin-left:auto}
.dsh-rtk-settings :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#625bd2);outline-offset:2px}.dsh-rtk-settings .preview{margin-top:12px;padding:12px;border:1px solid var(--hook-line);border-radius:8px;font-size:13px}.dsh-rtk-settings pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
.dsh-rtk-settings .footer-note{font-size:12px;line-height:1.6;opacity:.55;margin:12px 0}.dsh-rtk-settings .error{color:#bd4343;font-size:13px}
@media(prefers-reduced-motion:reduce){.dsh-rtk-settings .chevron{transition:none}}
`;
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
                label: "Hooks",
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
