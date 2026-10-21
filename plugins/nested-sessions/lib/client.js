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
    function rootFor(parents, id) {
      const seen = new Set();
      while (parents.has(id) && !seen.has(id)) {
        seen.add(id);
        id = parents.get(id);
      }
      return id;
    }
    const labels = {
      idle: "尚未开始",
      queued: "排队中",
      running: "处理中",
      completed: "已完成",
      error: "需要处理",
      blocked: "等待输入",
      paused: "等待继续",
      stopped: "已停止",
    };
    const css = `
.dsh-nested{font:14px/1.6 system-ui;color:var(--dsw-alias-label-primary,#222);text-align:left;box-sizing:border-box;min-width:0}
.dsh-nested *{box-sizing:border-box}
.dsh-nested button,.dsh-nested textarea{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);padding:7px 12px}
.dsh-nested button{cursor:pointer;transition:background .15s}
.dsh-nested button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f1f4f8)}
.dsh-nested button:focus-visible,.dsh-nested textarea:focus-visible{outline:2px solid #356ae6;outline-offset:2px}
.dsh-nested button:disabled{opacity:.45;cursor:default}
.dsh-nested p{margin:8px 0 16px;overflow-wrap:anywhere}
.dsh-nested small{font-size:12px;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested h2{font-size:24px;line-height:1.3;margin:0;letter-spacing:-.5px}
.dsh-nested h3{font-size:14px;margin:0}
.dsh-nested-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.dsh-nested-badge{font-size:12px;border-radius:20px;padding:4px 10px;background:var(--dsw-alias-bg-layer-2,#eff3fa);white-space:nowrap}
.dsh-nested-intro{max-width:600px;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested ul{list-style:none;padding:0;margin:0}
.dsh-nested ul ul{margin:0 0 0 18px;border-left:1px solid var(--dsw-alias-border-l2,#dce0e7);padding-left:18px}
.dsh-nested-card{border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:12px;padding:16px 18px;margin:12px 0;background:var(--dsw-alias-bg-layer-1,#fff)}
.dsh-nested-card p{font-size:13px;margin:8px 0;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested-row{display:flex;align-items:center;gap:8px}
.dsh-nested-title{border:0!important;background:transparent!important;text-align:left;min-width:0;flex:1;padding:0!important;font-weight:600!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-nested-status{font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested-status[data-status=completed]{color:#15803d}
.dsh-nested-status[data-status=running],.dsh-nested-status[data-status=queued]{color:#2563eb}
.dsh-nested-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0}
.dsh-nested-card .dsh-nested-actions{margin:12px 0 0}
.dsh-nested-card .dsh-nested-actions button{font-size:12px;padding:4px 10px}
.dsh-nested-primary{background:#356ae6!important;color:#fff!important;border-color:#356ae6!important}
.dsh-nested textarea{width:100%;min-height:92px;resize:vertical;display:block;margin-top:10px}
.dsh-nested-compose{margin:26px 0 20px;padding-top:22px;border-top:1px solid var(--dsw-alias-border-l2,#dce0e7)}
.dsh-nested-error{color:#b22;white-space:pre-wrap}
.dsh-nested details{font-size:12px;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested summary{cursor:pointer}
.dsh-nested-popup{position:absolute;top:calc(100% + 10px);left:0;width:min(470px,calc(100vw - 30px));max-height:75vh;overflow:auto;z-index:100;padding:22px;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 40px #0002}
.dsh-nested-popup h2{font-size:18px}
.dsh-nested-main{width:100%;min-width:0;flex:1;align-self:stretch;overflow:auto;height:100%;box-sizing:border-box;padding:36px clamp(20px,5vw,72px)}
.dsh-nested-main>.dsh-nested{width:100%;max-width:920px;margin:0 auto}
@media(max-width:620px){.dsh-nested-main{padding:24px 16px}.dsh-nested-heading{align-items:flex-start;flex-direction:column;gap:8px}.dsh-nested ul ul{margin-left:8px;padding-left:10px}.dsh-nested-card{padding:12px}}
`;

    async function call(ctx, method, request) {
      const result = await ctx.connection.rpc.call(
        "/api",
        "nestedSessions/" + method,
        { args: { request } },
        AbortSignal.timeout(30000),
      );
      if (!result.ok)
        throw new Error(result.error?.message ?? "操作未完成，请重试");
      return result.value;
    }

    function Progress({
      ctx,
      sessionId,
      useSessions,
      useSessionStatus,
      all = false,
    }) {
      const list = useSessions((state) => state),
        statuses = useSessionStatus((state) => state);
      const [links, setLinks] = React.useState([]),
        [automatic, setAutomatic] = React.useState(true),
        [requested, setRequested] = React.useState(false),
        [collapsed, setCollapsed] = React.useState(new Set());
      const [error, setError] = React.useState(""),
        [loadError, setLoadError] = React.useState(""),
        [busy, setBusy] = React.useState(false);
      const [task, setTask] = React.useState("");
      const current =
        sessionId ??
        Object.values(list.byId).find(
          (row) => (row.retainedBy?.mainView ?? 0) > 0,
        )?.id ??
        links[0]?.parentId;
      const tree = familyTree(
        links,
        Object.values(list.byId).filter((row) => row.origin !== "subagent"),
      );
      const root = rootFor(tree.parents, current),
        currentLinks = links.filter(
          (link) => rootFor(tree.parents, link.sessionId) === root,
        );
      const refresh = async () => {
        const value = await call(ctx, "list", {
          ...(current ? { sessionId: current } : {}),
          all,
        });
        setLinks(value.links);
        setAutomatic(value.automatic);
        setRequested(value.requested);
      };
      React.useEffect(() => {
        let disposed = false;
        const update = () =>
          call(ctx, "list", { ...(current ? { sessionId: current } : {}), all })
            .then((value) => {
              if (!disposed) {
                setLinks(value.links);
                setAutomatic(value.automatic);
                setRequested(value.requested);
                setLoadError("");
              }
            })
            .catch((e) => {
              if (!disposed) setLoadError(e.message);
            });
        update();
        const timer = setInterval(update, 2000);
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
      const running = currentLinks.filter((link) =>
        ["queued", "running"].includes(link.status),
      ).length;
      const cancelable = currentLinks.some((link) =>
        ["idle", "queued", "running", "paused", "blocked"].includes(
          link.status,
        ),
      );
      const toggle = (id) =>
        setCollapsed((old) => {
          const next = new Set(old);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      const showResult = (id) => ctx.uiWorkspace.openSession(id);
      const row = (id) => {
        const item = tree.byId.get(id);
        if (!item) return null;
        const childIds = tree.children.get(id) ?? [],
          link = links.find((link) => link.sessionId === id);
        const state = statuses[id] ?? statuses.byId?.[id] ?? {},
          status =
            link?.status ??
            (state.running || item.running ? "running" : "idle");
        return h(
          "li",
          { key: id },
          h(
            "div",
            { className: "dsh-nested-card" },
            h(
              "div",
              { className: "dsh-nested-row" },
              childIds.length
                ? h(
                    "button",
                    {
                      "aria-label":
                        (collapsed.has(id) ? "展开" : "折叠") +
                        (item.title || "任务"),
                      "aria-expanded": !collapsed.has(id),
                      onClick: () => toggle(id),
                    },
                    collapsed.has(id) ? "▸" : "▾",
                  )
                : null,
              h(
                "button",
                {
                  className: "dsh-nested-title",
                  onClick: () => ctx.uiWorkspace.openSession(id),
                  title: "打开对话",
                },
                item.title || "未命名任务",
              ),
              h(
                "span",
                { className: "dsh-nested-status", "data-status": status },
                link ? (labels[status] ?? status) : "主会话",
              ),
            ),
            link &&
              h(
                "small",
                null,
                "使用模型：" + (link.selection?.model ?? "继承当前模型"),
              ),
            link?.reason && h("p", null, link.reason),
            link &&
              h(
                "div",
                { className: "dsh-nested-actions" },
                h(
                  "button",
                  { disabled: busy, onClick: () => showResult(id) },
                  "查看结果",
                ),
                ["queued", "running", "paused", "blocked"].includes(status) &&
                  h(
                    "button",
                    {
                      disabled: busy,
                      onClick: () =>
                        run(() => call(ctx, "stop", { sessionId: id })),
                    },
                    "停止此任务",
                  ),
              ),
          ),
          childIds.length > 0 &&
            !collapsed.has(id) &&
            h("ul", null, childIds.map(row)),
        );
      };
      const roots = tree.roots.length ? tree.roots : root ? [root] : [];
      return h(
        "section",
        { className: "dsh-nested", "aria-label": "协作进度" },
        h(
          "div",
          { className: "dsh-nested-heading" },
          h("h2", null, "任务协作"),
          h(
            "span",
            { className: "dsh-nested-badge" },
            requested ? "本任务已开启" : automatic ? "按需协作" : "已暂停分工",
          ),
        ),
        h(
          "p",
          { className: "dsh-nested-intro" },
          "描述目标，Agent 决定分工、数量和模型。每个子任务都有独立对话，结果汇总回主会话。",
        ),
        root &&
          h(
            "p",
            null,
            h(
              "small",
              null,
              "当前主会话：" + (tree.byId.get(root)?.title ?? "原任务"),
            ),
          ),
        h(
          "div",
          { className: "dsh-nested-actions" },
          h(
            "button",
            {
              className: "dsh-nested-policy dsh-nested-primary",
              disabled: busy || !root,
              "aria-pressed": requested,
              onClick: () =>
                run(() =>
                  call(ctx, "policy", { sessionId: root, enabled: !requested }),
                ),
            },
            requested ? "暂停新分工" : "开启本任务协作",
          ),
          h(
            "button",
            {
              disabled: busy || !cancelable || !root,
              onClick: () =>
                run(() => call(ctx, "stopAll", { sessionId: root })),
            },
            "停止当前任务的全部子任务",
          ),
          current &&
            root !== current &&
            h(
              "button",
              { onClick: () => ctx.uiWorkspace.openSession(root) },
              "返回主会话",
            ),
        ),
        h(
          "p",
          { className: "dsh-nested-intro" },
          links.length
            ? (all ? "共展示 " + links.length + " 个子任务；" : "") +
                "当前任务 " +
                currentLinks.length +
                " 个子任务，" +
                running +
                " 个处理中。"
            : "还没有子任务。适合并行的任务会自动出现在这里，简单问题仍由主会话直接完成。",
        ),
        h("ul", { "aria-label": "父子任务进度" }, roots.map(row)),
        h(
          "form",
          {
            className: "dsh-nested-compose",
            onSubmit: (event) => {
              event.preventDefault();
              run(async () => {
                await call(ctx, "submit", {
                  sessionId: root,
                  message: task,
                  collaborate: true,
                });
                setTask("");
                ctx.uiWorkspace.openSession(root);
              });
            },
          },
          h(
            "p",
            null,
            h(
              "label",
              { htmlFor: "nested-task-" + (sessionId ?? "all") },
              "交给 Agent 的任务",
            ),
          ),
          h("textarea", {
            id: "nested-task-" + (sessionId ?? "all"),
            value: task,
            maxLength: 16000,
            required: true,
            placeholder: "描述目标即可，不需要填写人数、模型或子任务配置",
            onChange: (event) => setTask(event.target.value),
            disabled: busy || !root,
          }),
          h(
            "div",
            { className: "dsh-nested-actions" },
            h(
              "button",
              {
                type: "submit",
                className: "dsh-nested-primary",
                disabled: busy || !root || !task.trim(),
              },
              busy ? "正在提交…" : "交给 Agent 协作",
            ),
          ),
        ),
        (error || loadError) &&
          h(
            "p",
            { role: "alert", className: "dsh-nested-error" },
            error || loadError,
          ),
        h(
          "details",
          null,
          h("summary", null, "使用说明"),
          h(
            "p",
            null,
            "默认按需判断，较小任务可能直接完成。明确需要协作时输入 /collaborate 任务内容，或点击开启本任务协作；数量和模型仍由 Agent 自选。/collaborate off 暂停新分工，/collaborate auto 恢复按需模式。各子任务都能单独打开并补充要求。",
          ),
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
          [parentId, setParentId] = React.useState(),
          root = React.useRef();
        React.useEffect(() => {
          setOpen(false);
          setParentId(undefined);
          let disposed = false;
          if (props.sessionId)
            call(ctx, "list", { sessionId: props.sessionId })
              .then((value) => {
                if (disposed) return;
                const top = rootFor(
                  new Map(
                    value.links.map((link) => [link.sessionId, link.parentId]),
                  ),
                  props.sessionId,
                );
                if (top !== props.sessionId) setParentId(top);
              })
              .catch(() => {});
          return () => {
            disposed = true;
          };
        }, [props.sessionId]);
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
          parentId &&
            h(
              "button",
              {
                type: "button",
                onClick: () => ctx.uiWorkspace.openSession(parentId),
                style: {
                  border: 0,
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 12,
                },
              },
              "返回主会话",
            ),
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
            "任务协作",
          ),
          open &&
            h(
              "div",
              {
                className: "dsh-nested-popup",
                role: "dialog",
                "aria-label": "协作进度",
              },
              h(Progress, { ...props, ctx }),
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
                h(Progress, { ...props, ctx, all: true }),
              ),
          );
          yield ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: "nested-sessions",
              label: "协作进度",
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
