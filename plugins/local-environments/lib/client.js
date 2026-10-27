window.__ModuleLoader__.load({
  id: "@local/dsh-local-environments",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const inject = ["slots", "connection", "uiWorkspace", "sessions"];
    const prefix = "dsh-local-env";
    async function call(ctx, method, request, signal) {
      const result = await ctx.connection.rpc.call(
        "/api",
        "localEnvironmentCatalog/" + method,
        { args: { request } },
        AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      );
      if (!result.ok)
        throw new Error(result.error?.message ?? "操作未完成，请重试");
      return result.value;
    }
    function variableEntries(text) {
      const entries = [],
        seen = new Set();
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const equals = line.indexOf("="),
          key = line.slice(0, equals).trim();
        if (equals < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
          throw new Error("变量格式应为 KEY=value，每行一个，不支持表达式");
        if (seen.has(key.toUpperCase())) throw new Error("变量名重复：" + key);
        seen.add(key.toUpperCase());
        entries.push([key, line.slice(equals + 1)]);
      }
      return Object.fromEntries(entries);
    }
    function createNavigation(ctx) {
      // shortcut: pinned native selection store; replace when a public current-session observer exists.
      let previous;
      return {
        get previous() {
          return previous?.sessionId;
        },
        open(sessionId) {
          const current = ctx.uiWorkspace.selection.getSnapshot().sessionId;
          const retained =
            current && current !== sessionId
              ? ctx.sessions.retain(current, {
                  source: "localEnvironmentReturn",
                })
              : undefined;
          const before = previous;
          previous = retained;
          try {
            ctx.uiWorkspace.openSession(sessionId);
          } catch (error) {
            previous = before;
            retained?.release();
            throw error;
          }
          before?.release();
        },
        back() {
          if (!previous) return;
          const target = previous;
          ctx.uiWorkspace.openSession(target.sessionId);
          previous = undefined;
          target.release();
        },
        dispose() {
          previous?.release();
          previous = undefined;
        },
      };
    }
    function blankEnvironment() {
      return {
        id: "env-" + crypto.randomUUID(),
        name: "",
        repositories: [{ key: "repo", mode: "checkout", localPath: "" }],
        requiredText: "",
      };
    }
    function Manager({ ctx, onNavigate }) {
      const [catalog, setCatalog] = React.useState({
        definitions: [],
        bindings: {},
      });
      const [recent, setRecent] = React.useState([]);
      const [editor, setEditor] = React.useState(null);
      const [variables, setVariables] = React.useState("");
      const [busy, setBusy] = React.useState(false),
        [ready, setReady] = React.useState(false);
      const [error, setError] = React.useState(""),
        [notice, setNotice] = React.useState("");
      const lifetime = React.useRef(null),
        pending = React.useRef(false),
        importInput = React.useRef(null);
      const refresh = async (signal) => {
        const [next, folders] = await Promise.all([
          call(ctx, "list", {}, signal),
          call(ctx, "recent", {}, signal),
        ]);
        signal.throwIfAborted();
        setCatalog(next);
        setRecent(folders);
        setReady(true);
      };
      React.useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        refresh(controller.signal).catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
        return () => controller.abort();
      }, []);
      const run = async (operation) => {
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted || pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          await operation(signal);
        } catch (failure) {
          if (!signal.aborted) setError(failure.message || "操作失败");
        } finally {
          pending.current = false;
          if (!signal.aborted) setBusy(false);
        }
      };
      const openSession = (result) => {
        lifetime.current.signal.throwIfAborted();
        onNavigate(result.sessionId);
      };
      const choose = async () => {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
        return desktop ? desktop.pick() : ctx.uiWorkspace.pickDirectory();
      };
      const edit = (row) => {
        setVariables("");
        setError("");
        setNotice("");
        setEditor({
          ...row,
          requiredText: row.requiredVariables.join(", "),
          repositories: row.repositories.map((repo) => ({
            ...repo,
            localPath: catalog.bindings[row.id]?.[repo.key] ?? "",
          })),
        });
      };
      const patchRepo = (index, values) =>
        setEditor((old) => ({
          ...old,
          repositories: old.repositories.map((repo, i) =>
            i === index ? { ...repo, ...values } : repo,
          ),
        }));
      const button = (label, action, disabled = false, primary = false) =>
        h(
          "button",
          {
            type: "button",
            disabled: busy || disabled,
            onClick: action,
            className: primary ? prefix + "-primary" : undefined,
          },
          label,
        );
      const save = () =>
        run(async (signal) => {
          const definition = {
            id: editor.id,
            name: editor.name,
            requiredVariables: editor.requiredText
              .split(/[,\s]+/)
              .filter(Boolean),
            repositories: editor.repositories.map((repo) => ({
              key: repo.key,
              mode: repo.mode,
              ...(repo.mode === "worktree"
                ? { baseRef: repo.baseRef || "HEAD" }
                : {}),
            })),
          };
          await call(ctx, "save", definition, signal);
          for (const repo of editor.repositories)
            await call(
              ctx,
              "bind",
              {
                id: editor.id,
                key: repo.key,
                path: repo.localPath.trim() || null,
              },
              signal,
            );
          await refresh(signal);
          setNotice("已保存。目录与变量只保留在本机。");
        });
      const launch = (id) =>
        run(async (signal) =>
          openSession(await call(ctx, "launch", { id }, signal)),
        );
      return h(
        "section",
        { className: prefix, "aria-label": "本地环境管理" },
        h(
          "header",
          { className: prefix + "-intro" },
          h("h2", null, "本地环境"),
          h(
            "p",
            null,
            "把常用文件夹、仓库和执行环境放在一起。每次使用都打开独立的新会话。",
          ),
        ),
        error && h("p", { role: "alert", className: prefix + "-error" }, error),
        notice && h("p", { role: "status" }, notice),
        !ready && !error && h("p", { role: "status" }, "正在读取本机环境…"),
        h(
          "div",
          { className: prefix + "-toolbar" },
          button(
            "打开文件夹",
            () =>
              run(async (signal) => {
                const folder = await choose();
                signal.throwIfAborted();
                if (folder)
                  openSession(
                    await call(ctx, "openFolder", { path: folder }, signal),
                  );
              }),
            !ready,
            true,
          ),
          button(
            "新建环境",
            () => {
              setEditor(blankEnvironment());
              setVariables("");
              setError("");
              setNotice("");
            },
            !ready,
          ),
          button(
            "导出定义",
            () =>
              run(async (signal) => {
                const data = await call(ctx, "export", {}, signal);
                signal.throwIfAborted();
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "dsh-local-environments.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }),
            !ready,
          ),
          button("导入定义", () => importInput.current.click(), !ready),
          h("input", {
            ref: importInput,
            type: "file",
            accept: ".json,application/json",
            hidden: true,
            onChange: (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              run(async (signal) => {
                if (file.size > 262144)
                  throw new Error("定义文件不能超过 256 KiB");
                const text = await file.text();
                signal.throwIfAborted();
                await call(ctx, "import", JSON.parse(text), signal);
                await refresh(signal);
                setEditor(null);
                setVariables("");
                setNotice(
                  "定义已导入；相同标识的定义已更新，本机绑定与变量保留。新电脑需重新绑定目录、配置变量。",
                );
              });
            },
          }),
        ),
        h(
          "div",
          { className: prefix + "-columns" },
          h(
            "div",
            null,
            h("h3", null, "已保存环境"),
            !catalog.definitions.length &&
              ready &&
              h(
                "p",
                { className: prefix + "-muted" },
                "暂无环境。一个普通文件夹可以直接打开；多个仓库可保存成环境。",
              ),
            ...catalog.definitions.map((row) =>
              h(
                "article",
                { key: row.id, className: prefix + "-card" },
                h("strong", null, row.name),
                h(
                  "p",
                  { className: prefix + "-muted" },
                  row.repositories.length +
                    " 个目录 · " +
                    row.repositories.filter((repo) => repo.mode === "worktree")
                      .length +
                    " 个独立 worktree",
                ),
                h(
                  "div",
                  { className: prefix + "-actions" },
                  button("在新会话中使用", () => launch(row.id), !ready, true),
                  button("编辑", () => edit(row)),
                ),
              ),
            ),
            h("h3", null, "最近文件夹"),
            !recent.length &&
              ready &&
              h("p", { className: prefix + "-muted" }, "还没有最近文件夹。"),
            ...recent.map((row) =>
              h(
                "article",
                { key: row.path, className: prefix + "-folder" },
                h(
                  "div",
                  null,
                  h("strong", null, row.title),
                  h("small", { title: row.path }, row.path),
                  !row.available &&
                    h("small", null, "目录已移动或不存在，请重新选择"),
                ),
                button(
                  "新会话",
                  () =>
                    run(async (signal) =>
                      openSession(
                        await call(
                          ctx,
                          "openFolder",
                          { path: row.path },
                          signal,
                        ),
                      ),
                    ),
                  !row.available,
                ),
              ),
            ),
          ),
          editor &&
            h(
              "div",
              { className: prefix + "-editor" },
              h("h3", null, "编辑环境"),
              h(
                "label",
                null,
                "名称",
                h("input", {
                  value: editor.name,
                  disabled: busy,
                  maxLength: 160,
                  autoComplete: "off",
                  onChange: (event) =>
                    setEditor({ ...editor, name: event.target.value }),
                }),
              ),
              h(
                "p",
                { className: prefix + "-muted" },
                "当前目录模式保留原分支；worktree 从本地 ref 创建新分支，不带入源目录未提交改动。",
              ),
              ...editor.repositories.map((repo, index) =>
                h(
                  "fieldset",
                  { key: index, disabled: busy },
                  h("legend", null, "目录 " + (index + 1)),
                  h(
                    "label",
                    null,
                    "仓库标识",
                    h("input", {
                      value: repo.key,
                      maxLength: 64,
                      onChange: (event) =>
                        patchRepo(index, { key: event.target.value }),
                    }),
                  ),
                  h(
                    "label",
                    null,
                    "本机目录",
                    h("input", {
                      value: repo.localPath,
                      placeholder: "选择本机目录后保存",
                      onChange: (event) =>
                        patchRepo(index, { localPath: event.target.value }),
                    }),
                  ),
                  button("选择目录", () =>
                    run(async (signal) => {
                      const value = await choose();
                      signal.throwIfAborted();
                      if (value) patchRepo(index, { localPath: value });
                    }),
                  ),
                  h(
                    "label",
                    null,
                    "工作方式",
                    h(
                      "select",
                      {
                        value: repo.mode,
                        onChange: (event) =>
                          patchRepo(index, { mode: event.target.value }),
                      },
                      h("option", { value: "checkout" }, "使用当前目录"),
                      h(
                        "option",
                        { value: "worktree" },
                        "创建独立 Git worktree",
                      ),
                    ),
                  ),
                  repo.mode === "worktree" &&
                    h(
                      "label",
                      null,
                      "本地分支、标签或提交",
                      h("input", {
                        value: repo.baseRef ?? "HEAD",
                        onChange: (event) =>
                          patchRepo(index, { baseRef: event.target.value }),
                      }),
                    ),
                  button(
                    "移除目录",
                    () =>
                      setEditor({
                        ...editor,
                        repositories: editor.repositories.filter(
                          (_, i) => i !== index,
                        ),
                      }),
                    editor.repositories.length === 1,
                  ),
                ),
              ),
              button(
                "添加目录",
                () =>
                  setEditor({
                    ...editor,
                    repositories: [
                      ...editor.repositories,
                      {
                        key: "repo-" + (editor.repositories.length + 1),
                        mode: "checkout",
                        localPath: "",
                      },
                    ],
                  }),
                editor.repositories.length >= 8,
              ),
              h(
                "label",
                null,
                "必需变量名（逗号或空格分隔）",
                h("input", {
                  value: editor.requiredText,
                  disabled: busy,
                  onChange: (event) =>
                    setEditor({ ...editor, requiredText: event.target.value }),
                }),
              ),
              h(
                "div",
                { className: prefix + "-actions" },
                button("保存环境", save, !editor.name.trim(), true),
                button("关闭编辑", () => {
                  setEditor(null);
                  setVariables("");
                }),
              ),
              catalog.definitions.some((row) => row.id === editor.id) &&
                h(
                  React.Fragment,
                  null,
                  h(
                    "details",
                    null,
                    h("summary", null, "本机变量"),
                    h(
                      "p",
                      { className: prefix + "-muted" },
                      "已有值不回显。每行 KEY=value；替换会影响此环境所有会话的后续工具调用。留空提交会清空变量。值不会随定义导出。",
                    ),
                    h("textarea", {
                      value: variables,
                      disabled: busy,
                      rows: 5,
                      autoComplete: "off",
                      spellCheck: false,
                      "aria-label": "本机环境变量",
                      onChange: (event) => setVariables(event.target.value),
                    }),
                    button("替换环境变量", () =>
                      run(async (signal) => {
                        await call(
                          ctx,
                          "variables",
                          { id: editor.id, values: variableEntries(variables) },
                          signal,
                        );
                        signal.throwIfAborted();
                        setVariables("");
                        setNotice("本机变量已更新，已有值不回显。");
                      }),
                    ),
                  ),
                  h(
                    "details",
                    null,
                    h("summary", null, "移除环境定义"),
                    h(
                      "p",
                      { className: prefix + "-muted" },
                      "仅移除定义；保留既有会话、worktree、本机绑定及变量记录。",
                    ),
                    button("移除这份定义", () =>
                      run(async (signal) => {
                        await call(ctx, "remove", { id: editor.id }, signal);
                        await refresh(signal);
                        setEditor(null);
                        setVariables("");
                      }),
                    ),
                  ),
                ),
            ),
        ),
      );
    }
    function Launcher({ ctx, wide, navigation }) {
      const [open, setOpen] = React.useState(false),
        dialog = React.useRef(null);
      const current = React.useSyncExternalStore(
        (listener) => ctx.uiWorkspace.selection.subscribe(listener),
        () => ctx.uiWorkspace.selection.getSnapshot().sessionId,
      );
      React.useEffect(() => {
        if (open) dialog.current.showModal();
        else dialog.current.close();
      }, [open]);
      return h(
        React.Fragment,
        null,
        h(
          "button",
          {
            type: "button",
            className: prefix + "-launcher",
            title: "本地环境与最近文件夹",
            "aria-label": "本地环境与最近文件夹",
            onClick: () => setOpen(true),
          },
          wide ? "本地环境" : "环境",
        ),
        navigation.previous &&
          navigation.previous !== current &&
          h(
            "button",
            {
              type: "button",
              className: prefix + "-launcher",
              onClick: () => navigation.back(),
              "aria-label": "返回环境启动前的原会话",
              title: "返回原会话，继续此前的草稿",
            },
            wide ? "返回原会话" : "返回",
          ),
        h(
          "dialog",
          {
            ref: dialog,
            className: prefix + "-dialog",
            "aria-label": "本地环境与最近文件夹",
            onClose: () => setOpen(false),
          },
          h(
            "button",
            {
              type: "button",
              className: prefix + "-close",
              "aria-label": "关闭本地环境",
              onClick: () => setOpen(false),
            },
            "关闭",
          ),
          open &&
            h(Manager, {
              ctx,
              onNavigate: (sessionId) => {
                navigation.open(sessionId);
                setOpen(false);
              },
            }),
        ),
      );
    }
    function apply(ctx) {
      const navigation = createNavigation(ctx);
      ctx.effect(() => () => navigation.dispose());
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `
          .${prefix}{font:inherit;color:inherit;padding:24px;line-height:1.6;min-width:0;container-type:inline-size}
          .${prefix} h2{font-size:22px;margin:0 0 6px}.${prefix} h3{font-size:16px}
          .${prefix}-intro p,.${prefix}-muted{font-size:13px;opacity:.72;margin:6px 0 14px}
          .${prefix}-toolbar,.${prefix}-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
          .${prefix} button,.${prefix}-close{font:inherit;font-size:13px;padding:6px 11px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
          .${prefix} button:disabled{opacity:.45;cursor:default}.${prefix} button:focus-visible,.${prefix} input:focus-visible,.${prefix} textarea:focus-visible,.${prefix} select:focus-visible{outline:2px solid #4179ed;outline-offset:2px}
          .${prefix} button.${prefix}-primary{background:#326ce5;border-color:#326ce5;color:white}
          .${prefix}-columns{display:grid;grid-template-columns:minmax(0,1fr);gap:24px}
          .${prefix}-columns:has(.${prefix}-editor){grid-template-columns:minmax(220px,1fr) minmax(280px,1fr)}
          .${prefix}-card{border:1px solid #8884;border-radius:10px;padding:14px;margin:10px 0}
          .${prefix}-folder{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #8883}
          .${prefix}-folder div{min-width:0}.${prefix}-folder button{flex-shrink:0;white-space:nowrap}.${prefix}-folder small{display:block;font-size:12px;opacity:.7;overflow-wrap:anywhere}
          .${prefix}-editor{border-left:1px solid #8883;padding-left:24px;min-width:0}
          .${prefix} label{display:grid;gap:4px;font-size:13px;margin:12px 0}
          .${prefix} input,.${prefix} select,.${prefix} textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px;padding:7px 9px;min-width:0}
          .${prefix} fieldset{border:1px solid #8884;border-radius:8px;padding:0 12px 12px;margin:16px 0}.${prefix} legend{font-size:13px;padding:0 5px}
          .${prefix} details{margin:18px 0}.${prefix} summary{cursor:pointer;font-size:13px}.${prefix}-error{color:#c83838;overflow-wrap:anywhere}
          .${prefix}-dialog{box-sizing:border-box;width:min(1000px,94vw);max-height:88vh;border:1px solid #8885;border-radius:14px;padding:0;background:Canvas;color:CanvasText;box-shadow:0 20px 70px #0003;overflow:auto}
          .${prefix}-dialog::backdrop{background:#0005}.${prefix}-close{float:right;margin:14px 18px 0}
          .${prefix}-launcher{font:inherit;color:inherit;background:transparent;border:0;padding:6px 8px;cursor:pointer;border-radius:6px}
          @container(max-width:700px){.${prefix}-columns:has(.${prefix}-editor){grid-template-columns:minmax(0,1fr)}.${prefix}-editor{border-left:0;padding-left:0;border-top:1px solid #8883}}
        `;
        document.head.append(style);
        return () => style.remove();
      });
      ctx.slots.inject("settings.enhancement.panel", () =>
        ctx.slots.register(
          {
            name: "settings.enhancement.panel",
            id: "local-environments",
            order: 28,
            label: "本地环境",
          },
          ({ close }) =>
            h(Manager, {
              ctx,
              onNavigate: (sessionId) => {
                navigation.open(sessionId);
                close();
              },
            }),
        ),
      );
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "local-environments",
            order: 70,
          },
          (props) => h(Launcher, { ...props, ctx, navigation }),
        ),
      );
    }
    return { inject, apply };
  },
});
