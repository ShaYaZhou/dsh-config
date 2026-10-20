window.__ModuleLoader__.load({
  id: "@local/dsh-nested-sessions",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const inject = ["slots", "sessions", "uiWorkspace", "connection"];
    function familyTree(links, rows) {
      const byId = new Map(rows.map((row) => [row.id, row])),
        parents = new Map();
      for (const link of links)
        if (byId.has(link.sessionId) && byId.has(link.parentId))
          parents.set(link.sessionId, link.parentId);
      // Corrupt relationships must not hide history or recurse forever.
      for (const id of parents.keys()) {
        const seen = new Set([id]);
        let at = parents.get(id);
        while (at) {
          if (seen.has(at)) {
            parents.delete(id);
            break;
          }
          seen.add(at);
          at = parents.get(at);
        }
      }
      const members = new Set([...parents.keys(), ...parents.values()]),
        children = new Map();
      for (const [id, parent] of parents) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
      }
      const sort = (ids) =>
        ids.sort(
          (a, b) => (byId.get(b).updatedAt ?? 0) - (byId.get(a).updatedAt ?? 0),
        );
      for (const ids of children.values()) sort(ids);
      return {
        byId,
        parents,
        children,
        roots: sort([...members].filter((id) => !parents.has(id))),
      };
    }
    const css = `.dsh-nested{font:13px system-ui;color:var(--dsw-alias-label-primary,#222);text-align:left}.dsh-nested button,.dsh-nested input,.dsh-nested textarea,.dsh-nested select{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#ccd);border-radius:5px;padding:5px 7px}.dsh-nested button{cursor:pointer}.dsh-nested button:disabled{opacity:.5;cursor:default}.dsh-nested summary{cursor:pointer}.dsh-nested ul{list-style:none;padding:0;margin:0}.dsh-nested ul ul{margin-left:14px;border-left:1px solid var(--dsw-alias-border-l2,#ccd);padding-left:5px}.dsh-nested-row{display:flex;align-items:center;gap:4px;min-height:32px}.dsh-nested-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}.dsh-nested-row[aria-current=true]{background:var(--dsw-alias-interactive-bg-hover,#edf3ff);border-radius:5px}.dsh-nested-tools{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.dsh-nested form{display:grid;gap:7px;margin:10px 0}.dsh-nested label{display:flex;align-items:center;gap:6px}.dsh-nested textarea{min-height:60px;resize:vertical}.dsh-nested small{color:var(--dsw-alias-label-secondary,#657)}.dsh-nested-popup{position:absolute;top:100%;left:0;width:min(440px,calc(100vw - 30px));max-height:75vh;overflow:auto;z-index:100;padding:12px;border:1px solid var(--dsw-alias-border-l2,#ccd);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 28px #0002}.dsh-nested-main{max-width:900px;margin:auto;padding:24px;overflow:auto;height:100%;box-sizing:border-box}.dsh-nested-status{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.dsh-nested-alert{color:var(--dsw-alias-state-error-primary,#b22)}`;
    function Tree({
      ctx,
      sessionId,
      useSessions,
      useSessionStatus,
      all = false,
    }) {
      const list = useSessions((state) => state),
        statuses = useSessionStatus((state) => state);
      const [links, setLinks] = React.useState([]),
        [selected, setSelected] = React.useState(sessionId),
        [collapsed, setCollapsed] = React.useState(new Set()),
        [error, setError] = React.useState(""),
        [loadError, setLoadError] = React.useState(""),
        [busy, setBusy] = React.useState(false),
        [mode, setMode] = React.useState(null),
        [title, setTitle] = React.useState(""),
        [prompt, setPrompt] = React.useState(""),
        [wake, setWake] = React.useState(false),
        [preview, setPreview] = React.useState("");
      React.useEffect(() => {
        setSelected(sessionId);
        setMode(null);
        setPreview("");
      }, [sessionId]);
      const current =
        sessionId ??
        Object.values(list.byId).find(
          (row) => (row.retainedBy?.mainView ?? 0) > 0,
        )?.id;
      const call = async (method, request) => {
        const result = await ctx.connection.rpc.call(
          "/api",
          "nestedSessions/" + method,
          { args: { request } },
          AbortSignal.timeout(30000),
        );
        if (!result.ok)
          throw new Error(result.error?.message ?? "会话操作失败");
        return result.value;
      };
      const refresh = async () => {
        const value = await call("list", all ? {} : { sessionId: current });
        setLinks(value.links);
      };
      React.useEffect(() => {
        let disposed = false;
        const update = () =>
          call("list", all ? {} : { sessionId: current })
            .then((value) => {
              if (!disposed) {
                setLinks(value.links);
                setLoadError("");
              }
            })
            .catch((e) => {
              if (!disposed) setLoadError(e.message);
            });
        update();
        const timer = setInterval(update, 3000);
        return () => {
          disposed = true;
          clearInterval(timer);
        };
      }, [current, all, list.byId]);
      const run = async (action) => {
        setBusy(true);
        setError("");
        try {
          await action();
          await refresh();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      };
      const rows = Object.values(list.byId).filter(
          (row) => row.origin !== "subagent",
        ),
        tree = familyTree(links, rows),
        picked = selected && tree.byId.has(selected) ? selected : current;
      const roots = tree.roots.length ? tree.roots : current ? [current] : [];
      const toggle = (id) =>
        setCollapsed((old) => {
          const next = new Set(old);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      const row = (id) => {
        const item = tree.byId.get(id);
        if (!item) return null;
        const childIds = tree.children.get(id) ?? [],
          state = statuses[id] ?? statuses.byId?.[id] ?? {},
          running = state.running ?? item.running,
          link = links.find((link) => link.sessionId === id);
        return h(
          "li",
          { key: id },
          h(
            "div",
            { className: "dsh-nested-row", "aria-current": picked === id },
            childIds.length
              ? h(
                  "button",
                  {
                    "aria-label":
                      (collapsed.has(id) ? "展开" : "折叠") + item.title,
                    "aria-expanded": !collapsed.has(id),
                    onClick: () => toggle(id),
                  },
                  collapsed.has(id) ? "▸" : "▾",
                )
              : h("span", { "aria-hidden": true, style: { width: 24 } }, "·"),
            h(
              "button",
              {
                className: "dsh-nested-title",
                title: id,
                onClick: () => {
                  setSelected(id);
                  setMode(null);
                  setPreview("");
                },
              },
              item.title || "新会话",
            ),
            h(
              "small",
              null,
              running
                ? "运行中"
                : link?.stoppedByUser
                  ? "已停止"
                  : state.pendingInteraction
                    ? "等待输入"
                    : link?.lastOutcome === "error"
                      ? "失败"
                      : link?.lastOutcome === "blocked"
                        ? "等待处理"
                        : link?.lastOutcome === "completed" ||
                            state.completionUnread
                          ? "已完成"
                          : "",
            ),
          ),
          childIds.length > 0 &&
            !collapsed.has(id) &&
            h("ul", null, childIds.map(row)),
        );
      };
      const selectedRow = tree.byId.get(picked);
      return h(
        "div",
        { className: "dsh-nested" },
        h(
          "div",
          null,
          h("strong", null, "嵌套会话"),
          h("small", null, " · 独立上下文与历史"),
        ),
        h("ul", { "aria-label": "父子会话树" }, roots.map(row)),
        !roots.length && h("p", null, "打开一个会话后创建子会话。"),
        h(
          "div",
          { className: "dsh-nested-tools" },
          h(
            "button",
            {
              disabled: busy || !picked,
              onClick: () => ctx.uiWorkspace.openSession(picked),
            },
            "打开会话",
          ),
          h(
            "button",
            {
              disabled: busy || !picked,
              onClick: () => {
                setMode("fresh");
                setPrompt("");
                setTitle("");
              },
            },
            "新建子会话",
          ),
          h(
            "button",
            {
              disabled: busy || !picked,
              onClick: () => {
                setMode("fork");
                setPrompt("");
                setTitle("");
              },
            },
            "继承上下文",
          ),
          h(
            "button",
            {
              disabled: busy || !picked || !current || picked === current,
              onClick: () => {
                setMode("message");
                setPrompt("");
              },
            },
            "发消息",
          ),
          h(
            "button",
            {
              disabled: busy || !picked,
              onClick: () =>
                run(async () => {
                  const result = await call("read", {
                    sessionId: picked,
                    limit: 8,
                  });
                  setPreview(
                    (result.outcome
                      ? "状态：" +
                        ({
                          completed: "已完成",
                          error: "失败",
                          blocked: "等待处理",
                          aborted: "已停止",
                        }[result.outcome.kind] ?? result.outcome.kind) +
                        (result.outcome.message
                          ? " · " + result.outcome.message
                          : "") +
                        "\n\n"
                      : "") + result.content,
                  );
                }),
            },
            "查看近况",
          ),
          h(
            "button",
            {
              disabled: busy || !picked,
              onClick: () => run(() => call("stop", { sessionId: picked })),
            },
            "停止",
          ),
          tree.parents.has(picked) &&
            h(
              "button",
              {
                disabled: busy,
                onClick: () => run(() => call("detach", { sessionId: picked })),
              },
              "移到顶层",
            ),
        ),
        selectedRow &&
          h("small", null, "操作目标：" + (selectedRow.title || picked)),
        mode &&
          h(
            "form",
            {
              onSubmit: (event) => {
                event.preventDefault();
                run(async () => {
                  if (mode === "message")
                    await call("send", {
                      sessionId: current,
                      targetSessionId: picked,
                      message: prompt,
                    });
                  else {
                    const child = await call("start", {
                      sessionId: picked,
                      title,
                      prompt: prompt.trim() || undefined,
                      context: mode,
                      wakeParent: wake,
                    });
                    setSelected(child.sessionId);
                    ctx.uiWorkspace.openSession(child.sessionId);
                  }
                  setMode(null);
                  setPrompt("");
                });
              },
            },
            h(
              "strong",
              null,
              mode === "message"
                ? "向选中会话发消息"
                : mode === "fork"
                  ? "从最近已完成轮次创建分支"
                  : "创建独立子会话",
            ),
            mode !== "message" &&
              h("input", {
                required: true,
                maxLength: 160,
                placeholder: "子会话标题",
                "aria-label": "子会话标题",
                value: title,
                onChange: (e) => setTitle(e.target.value),
              }),
            h("textarea", {
              required: mode === "message",
              maxLength: 16000,
              placeholder:
                mode === "message"
                  ? "发送的消息"
                  : "交给子会话的任务（可稍后输入）",
              "aria-label": mode === "message" ? "会话消息" : "子会话任务",
              value: prompt,
              onChange: (e) => setPrompt(e.target.value),
            }),
            mode !== "message" &&
              h(
                "label",
                null,
                h("input", {
                  type: "checkbox",
                  checked: wake,
                  onChange: (e) => setWake(e.target.checked),
                }),
                "完成后通知并唤醒父会话",
              ),
            h(
              "div",
              null,
              h(
                "button",
                { type: "submit", disabled: busy },
                busy ? "处理中…" : mode === "message" ? "发送" : "创建",
              ),
              h(
                "button",
                { type: "button", onClick: () => setMode(null) },
                "取消",
              ),
            ),
          ),
        (error || loadError) &&
          h(
            "div",
            { role: "alert", className: "dsh-nested-status dsh-nested-alert" },
            error || loadError,
          ),
        preview &&
          h(
            "pre",
            {
              className: "dsh-nested-status",
              style: { whiteSpace: "pre-wrap" },
            },
            preview,
          ),
      );
    }
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        return () => style.remove();
      });
      function Header(props) {
        const [open, setOpen] = React.useState(false),
          root = React.useRef();
        React.useEffect(() => {
          if (!open) return;
          const close = (event) => {
            if (event.key === "Escape") {
              setOpen(false);
              root.current?.querySelector("button")?.focus();
            } else if (
              event.type === "pointerdown" &&
              !root.current?.contains(event.target)
            )
              setOpen(false);
          };
          document.addEventListener("keydown", close);
          document.addEventListener("pointerdown", close);
          return () => {
            document.removeEventListener("keydown", close);
            document.removeEventListener("pointerdown", close);
          };
        }, [open]);
        return h(
          "div",
          { ref: root, style: { position: "relative" } },
          h(
            "button",
            {
              type: "button",
              "aria-expanded": open,
              "aria-haspopup": "dialog",
              onClick: () => setOpen(!open),
              style: {
                border: 0,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                fontSize: 12,
              },
            },
            "嵌套会话",
          ),
          open &&
            h(
              "div",
              {
                className: "dsh-nested-popup",
                role: "dialog",
                "aria-label": "嵌套会话管理",
              },
              h(Tree, { ...props, ctx }),
            ),
        );
      }
      ctx.slots.inject("conversation.session.header.actions", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.actions",
            id: "nested-sessions",
            order: 80,
          },
          Header,
        ),
      );
      ctx.slots.inject("main", () =>
        ctx.slots.inject("sidebar.panellist", function* () {
          yield ctx.slots.register(
            { name: "main", key: "nested-sessions" },
            (props) =>
              h(
                "div",
                { className: "dsh-nested-main" },
                h(Tree, { ...props, ctx, all: true }),
              ),
          );
          yield ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: "nested-sessions",
              label: "嵌套会话",
              order: 25,
            },
            () => h("span", { "aria-hidden": true }, "⑂"),
          );
        }),
      );
    }
    return { inject, apply, familyTree };
  },
});
