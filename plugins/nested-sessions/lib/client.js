window.__ModuleLoader__.load({
  id: "@local/dsh-nested-sessions",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const inject = [
      "slots",
      "sessions",
      "workspaces",
      "uiWorkspace",
      "connection",
    ];
    function familyTree(links, rows, focusedId) {
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
      if (byId.has(focusedId)) members.add(focusedId);
      for (const [id, parent] of parents) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
      }
      const sort = (ids) =>
        ids.sort(
          (a, b) => (byId.get(b).updatedAt ?? 0) - (byId.get(a).updatedAt ?? 0),
        );
      for (const ids of children.values()) sort(ids);
      const roots = sort([...members].filter((id) => !parents.has(id))),
        focusedRoot = rootFor(parents, focusedId);
      if (roots.includes(focusedRoot)) {
        roots.splice(roots.indexOf(focusedRoot), 1);
        roots.unshift(focusedRoot);
      }
      return {
        byId,
        parents,
        children,
        roots,
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
    function sidebarRows(ids, links, collapsed = new Set()) {
      const tree = familyTree(
          links,
          ids.map((id, index) => ({ id, updatedAt: ids.length - index })),
        ),
        earliest = new Map();
      ids.forEach((id, index) => {
        const root = rootFor(tree.parents, id);
        earliest.set(root, Math.min(earliest.get(root) ?? Infinity, index));
      });
      const roots = ids
          .filter((id) => !tree.parents.has(id))
          .sort((a, b) => earliest.get(a) - earliest.get(b)),
        result = [];
      const visit = (id, depth, hidden) => {
        const children = tree.children.get(id) ?? [];
        result.push({
          id,
          parentId: tree.parents.get(id),
          depth,
          hidden,
          children,
        });
        for (const child of children)
          visit(child, depth + 1, hidden || collapsed.has(id));
      };
      for (const root of roots) visit(root, 0, false);
      return result;
    }
    function hasPartialFamily(ids, links, eligible) {
      const visible = new Set(ids);
      return links.some(
        (link) =>
          eligible.has(link.sessionId) &&
          eligible.has(link.parentId) &&
          visible.has(link.sessionId) !== visible.has(link.parentId),
      );
    }

    // Native 0.2.1-rc.2 has no row-order slot; adapt only its semantic row markers, never move React-owned nodes.
    function installSidebarTree(ctx) {
      const selector = '[data-row-key^="session:"]',
        collapsed = new Set(),
        saved = new Map(),
        containers = new Map();
      let disposed = false,
        links = [],
        frame,
        lastSelected;
      const preserve = (element, properties, attributes = []) => {
        if (saved.has(element)) return;
        saved.set(element, {
          styles: properties.map((name) => [
            name,
            element.style.getPropertyValue(name),
            element.style.getPropertyPriority(name),
          ]),
          attrs: attributes.map((name) => [name, element.getAttribute(name)]),
        });
      };
      const restore = (element) => {
        const state = saved.get(element);
        if (!state) return;
        for (const [name, value, priority] of state.styles)
          value
            ? element.style.setProperty(name, value, priority)
            : element.style.removeProperty(name);
        for (const [name, value] of state.attrs)
          value === null
            ? element.removeAttribute(name)
            : element.setAttribute(name, value);
        element
          .querySelectorAll(":scope > [data-dsh-family-control]")
          .forEach((node) => node.remove());
        saved.delete(element);
      };
      const paint = () => {
        frame = undefined;
        if (disposed) return;
        const groups = new Map(),
          live = new Set();
        for (const row of document.querySelectorAll(selector)) {
          const wrapper = row.parentElement,
            container = wrapper?.parentElement;
          if (
            !container ||
            wrapper.children.length !== 1 ||
            !container.closest('[role="tree"]')
          )
            continue;
          if (!groups.has(container)) groups.set(container, []);
          groups
            .get(container)
            .push({ id: row.dataset.rowKey.slice(8), row, wrapper });
        }
        const selected = document
          .querySelector(selector + '[aria-selected="true"]')
          ?.dataset.rowKey.slice(8);
        if (selected !== lastSelected) {
          const parents = new Map(
              links.map((link) => [link.sessionId, link.parentId]),
            ),
            seen = new Set();
          let at = selected;
          while (at && !seen.has(at)) {
            seen.add(at);
            collapsed.delete(at);
            at = parents.get(at);
          }
          lastSelected = selected;
        }
        const workspaceState = ctx.workspaces.list.getSnapshot(),
          unavailable = new Set([
            ...workspaceState.pinnedSessionIds,
            ...workspaceState.archivedSessionIds,
          ]),
          visibleLinks = links.filter(
            (link) =>
              !unavailable.has(link.sessionId) &&
              !unavailable.has(link.parentId),
          );
        for (const [container, rows] of groups) {
          const overflow = Array.from(container.children).find((node) =>
            node.dataset.rowKey?.startsWith("overflow:"),
          );
          if (overflow && overflow.getAttribute("aria-expanded") !== "true") {
            const workspace = workspaceState.items.find(
                (item) => item.workspaceId === overflow.dataset.rowKey.slice(9),
              ),
              accounted = new Set(
                workspaceState.items.flatMap((item) => item.sessionIds),
              ),
              members =
                workspace?.sessionIds ??
                (overflow.dataset.rowKey === "overflow:"
                  ? ctx.sessions.list
                      .getSnapshot()
                      .ids.filter((id) => !accounted.has(id))
                  : []),
              eligible = new Set(members.filter((id) => !unavailable.has(id)));
            if (
              hasPartialFamily(
                rows.map((item) => item.id),
                visibleLinks,
                eligible,
              )
            ) {
              overflow.click();
              continue;
            }
          }
          const layout = sidebarRows(
            rows.map((item) => item.id),
            visibleLinks,
            collapsed,
          );
          if (!layout.some((item) => item.depth > 0)) continue;
          live.add(container);
          if (!containers.has(container))
            containers.set(container, [
              container.style.display,
              container.style.flexDirection,
            ]);
          container.style.display = "flex";
          container.style.flexDirection = "column";
          const byId = new Map(rows.map((item) => [item.id, item]));
          for (const child of container.children) {
            preserve(child, ["order", "display"]);
            live.add(child);
            child.style.order = child.dataset.rowKey?.startsWith("overflow:")
              ? "100000"
              : "0";
          }
          for (const [index, item] of layout.entries()) {
            const { row, wrapper } = byId.get(item.id);
            preserve(
              row,
              ["padding-inline-start", "position"],
              ["id", "aria-level", "aria-expanded"],
            );
            live.add(row);
            wrapper.style.order = String(index + 1);
            const original =
              saved
                .get(wrapper)
                ?.styles.find((entry) => entry[0] === "display")?.[1] ?? "";
            wrapper.style.display = item.hidden ? "none" : original;
            row.style.paddingInlineStart =
              8 +
              item.depth * 16 +
              (item.parentId || item.children.length ? 18 : 0) +
              "px";
            row.style.position = "relative";
            row.id = "dsh-linked-" + item.id;
            row.setAttribute("aria-level", String(item.depth + 2));
            let toggle = row.querySelector(
                ":scope > button[data-dsh-family-control]",
              ),
              group = row.querySelector(
                ':scope > [role="group"][data-dsh-family-control]',
              );
            if (item.children.length) {
              if (!toggle) {
                toggle = document.createElement("button");
                toggle.type = "button";
                toggle.dataset.dshFamilyControl = "true";
                toggle.style.cssText =
                  "position:absolute;left:7px;top:50%;transform:translateY(-50%);width:18px;height:22px;border:0;background:transparent;color:inherit;cursor:pointer;padding:0;font:13px system-ui";
                toggle.onpointerdown = (event) => event.stopPropagation();
                toggle.onkeydown = (event) => event.stopPropagation();
                toggle.onclick = (event) => {
                  event.stopPropagation();
                  collapsed.has(item.id)
                    ? collapsed.delete(item.id)
                    : collapsed.add(item.id);
                  schedule();
                };
                row.append(toggle);
              }
              toggle.style.left = 7 + item.depth * 16 + "px";
              const expanded = !collapsed.has(item.id),
                title =
                  ctx.sessions.list.getSnapshot().byId[item.id]?.title ??
                  "主会话";
              const text = expanded ? "▾" : "▸";
              if (toggle.textContent !== text) toggle.textContent = text;
              toggle.setAttribute(
                "aria-label",
                (expanded ? "折叠" : "展开") + "子会话：" + title,
              );
              toggle.setAttribute("aria-expanded", String(expanded));
              row.setAttribute("aria-expanded", String(expanded));
              if (!group) {
                group = document.createElement("span");
                group.dataset.dshFamilyControl = "true";
                group.setAttribute("role", "group");
                group.style.display = "contents";
                row.append(group);
              }
              group.setAttribute(
                "aria-owns",
                item.children.map((id) => "dsh-linked-" + id).join(" "),
              );
            } else {
              toggle?.remove();
              group?.remove();
              const old = saved
                .get(row)
                .attrs.find((entry) => entry[0] === "aria-expanded")[1];
              old === null
                ? row.removeAttribute("aria-expanded")
                : row.setAttribute("aria-expanded", old);
            }
          }
        }
        for (const element of [...saved.keys()])
          if (!live.has(element)) restore(element);
        for (const [container, [display, direction]] of containers)
          if (!live.has(container)) {
            container.style.display = display;
            container.style.flexDirection = direction;
            containers.delete(container);
          }
      };
      const schedule = () => {
        if (!disposed && frame === undefined)
          frame = requestAnimationFrame(paint);
      };
      const refresh = async () => {
        try {
          const result = await call(ctx, "list", { all: true });
          if (!disposed) {
            links = result.links;
            schedule();
          }
        } catch (error) {
          if (!disposed) console.warn("nested sidebar:", error.message);
        }
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-selected"],
      });
      const unsubscribe = ctx.sessions.list.subscribe(schedule),
        unsubscribeWorkspaces = ctx.workspaces.list.subscribe(schedule),
        timer = setInterval(refresh, 2000);
      refresh();
      return () => {
        disposed = true;
        observer.disconnect();
        unsubscribe();
        unsubscribeWorkspaces();
        clearInterval(timer);
        cancelAnimationFrame(frame);
        for (const element of [...saved.keys()]) restore(element);
        for (const [container, [display, direction]] of containers) {
          container.style.display = display;
          container.style.flexDirection = direction;
        }
      };
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
.dsh-nested button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);padding:7px 12px}
.dsh-nested button{cursor:pointer;transition:background .15s}
.dsh-nested button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f1f4f8)}
.dsh-nested button:focus-visible{outline:2px solid #356ae6;outline-offset:2px}
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
.dsh-nested-error{color:#b22;white-space:pre-wrap}
.dsh-nested details{font-size:12px;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested summary{cursor:pointer}
.dsh-nested-popup{position:absolute;top:calc(100% + 10px);left:0;width:min(470px,calc(100vw - 30px));max-height:75vh;overflow:auto;z-index:100;padding:22px;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 40px #0002}
.dsh-nested-popup h2{font-size:18px}
@media(max-width:620px){.dsh-nested-heading{align-items:flex-start;flex-direction:column;gap:8px}.dsh-nested ul ul{margin-left:8px;padding-left:10px}.dsh-nested-card{padding:12px}}
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

    function Progress({ ctx, sessionId, useSessions, useSessionStatus }) {
      const list = useSessions((state) => state),
        statuses = useSessionStatus((state) => state);
      const [links, setLinks] = React.useState([]),
        [automatic, setAutomatic] = React.useState(true),
        [requested, setRequested] = React.useState(false),
        [collapsed, setCollapsed] = React.useState(new Set());
      const [error, setError] = React.useState(""),
        [loadError, setLoadError] = React.useState(""),
        [busy, setBusy] = React.useState(false);
      const current =
        sessionId ??
        Object.values(list.byId).find(
          (row) => (row.retainedBy?.mainView ?? 0) > 0,
        )?.id ??
        links[0]?.parentId;
      const tree = familyTree(
        links,
        Object.values(list.byId).filter((row) => row.origin !== "subagent"),
        current,
      );
      const root = rootFor(tree.parents, current),
        currentLinks = links.filter(
          (link) => rootFor(tree.parents, link.sessionId) === root,
        );
      const refresh = async () => {
        const value = await call(ctx, "list", {
          ...(current ? { sessionId: current } : {}),
        });
        setLinks(value.links);
        setAutomatic(value.automatic);
        setRequested(value.requested);
      };
      React.useEffect(() => {
        let disposed = false;
        const update = () =>
          call(ctx, "list", { ...(current ? { sessionId: current } : {}) })
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
      }, [current, list.byId]);
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
          "在任意对话输入 /collaborate 任务内容 即可发起，无需先来这里开启。主会话决定分工、数量和模型；这里查看进度和结果。",
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
                run(async () => {
                  await call(ctx, "policy", {
                    sessionId: root,
                    enabled: !requested,
                  });
                  if (!requested) ctx.uiWorkspace.openSession(root);
                }),
            },
            requested ? "暂停新分工" : "开启协作并回主会话",
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
          "开启按钮只切换模式，不会提交任务。回主会话描述任务即可；子会话需要更多人手时请求主会话创建同级任务，不再逐层分派。",
        ),
        h(
          "p",
          { className: "dsh-nested-intro" },
          links.length
            ? "当前任务 " +
                currentLinks.length +
                " 个子任务，" +
                running +
                " 个处理中。"
            : "还没有子任务。适合并行的任务会自动出现在这里，简单问题仍由主会话直接完成。",
        ),
        h("ul", { "aria-label": "父子任务进度" }, roots.map(row)),
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
            "主会话负责分工与最终汇总，子会话负责独立交付。/collaborate 任务内容 立即把任务交给主会话；在子会话输入也会送到所属主会话。/collaborate on 只开启模式；off 暂停新分工；auto 恢复按需判断。已有深层历史仍按真实关系展示，新分工只创建主会话的直接子任务。",
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => installSidebarTree(ctx));
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
      // Existing windows may restore the retired panel key; return them to a conversation.
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          { name: "main", key: "nested-sessions" },
          ({ useSessions }) => {
            const list = useSessions((state) => state),
              archived = ctx.workspaces.list.getSnapshot().archivedSessionIds;
            const id =
              Object.values(list.byId).find(
                (row) => (row.retainedBy?.mainView ?? 0) > 0,
              )?.id ?? list.ids.find((id) => !archived.includes(id));
            React.useEffect(() => {
              if (id) ctx.uiWorkspace.openSession(id);
            }, [id]);
            return id ? null : h("p", null, "请从左侧选择会话。");
          },
        ),
      );
    }
    return { inject, apply, familyTree, sidebarRows, hasPartialFamily };
  },
});
