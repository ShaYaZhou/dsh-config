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
      "uiSession",
      "connection",
      "sidebarRight",
      "sidebarRightTabs",
    ];
    const splitPrefix = "dsh-resource://linked-session/";
    const notificationKey = "dsh.nested.completion-notifications";
    const notificationEvent = "dsh-nested-notification-preference";
    function useNotificationPreference() {
      const [enabled, setEnabled] = React.useState(
        () => localStorage.getItem(notificationKey) !== "off",
      );
      React.useEffect(() => {
        const update = () =>
          setEnabled(localStorage.getItem(notificationKey) !== "off");
        window.addEventListener("storage", update);
        window.addEventListener(notificationEvent, update);
        return () => {
          window.removeEventListener("storage", update);
          window.removeEventListener(notificationEvent, update);
        };
      }, []);
      return enabled;
    }
    function completionUpdates(seen, links, currentId) {
      const next = new Map(seen ?? []);
      for (const link of links)
        if (Number.isInteger(link.outcomeSeq))
          next.set(
            link.sessionId,
            Math.max(next.get(link.sessionId) ?? -1, link.outcomeSeq),
          );
      return {
        seen: next,
        notifications:
          seen === null
            ? []
            : links.filter(
                (link) =>
                  link.status === "completed" &&
                  link.notificationEligible &&
                  Number.isInteger(link.outcomeSeq) &&
                  (seen.get(link.sessionId) ?? -1) < link.outcomeSeq &&
                  link.sessionId !== currentId,
              ),
      };
    }
    function CompletionNotices({ ctx }) {
      const enabled = useNotificationPreference(),
        [notices, setNotices] = React.useState([]);
      const nativeNotices = React.useRef(new Map());
      const dismiss = (id) => {
        nativeNotices.current.get(id)?.close();
        nativeNotices.current.delete(id);
        setNotices((old) => old.filter((item) => item.id !== id));
      };
      React.useEffect(() => {
        setNotices([]);
        if (!enabled) return;
        let disposed = false,
          pending = false,
          dirty = false,
          seen = null;
        const native = nativeNotices.current;
        const close = (id) => {
          native.get(id)?.close();
          native.delete(id);
        };
        const update = async () => {
          if (pending) return;
          pending = true;
          dirty = false;
          try {
            const { completions: links = [] } = await call(ctx, "list", {
              all: true,
            });
            if (disposed || dirty) return;
            const current = Object.values(
              ctx.sessions.list.getSnapshot().byId,
            ).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
            const changes = completionUpdates(seen, links, current);
            seen = changes.seen;
            const eligible = new Set(
              links
                .filter(
                  (link) =>
                    link.notificationEligible && link.status === "completed",
                )
                .map((link) => link.sessionId + ":" + link.outcomeSeq),
            );
            for (const id of native.keys()) if (!eligible.has(id)) close(id);
            setNotices((old) =>
              [
                ...old.filter((item) => eligible.has(item.id)),
                ...changes.notifications.map((link) => ({
                  id: link.sessionId + ":" + link.outcomeSeq,
                  sessionId: link.sessionId,
                  title:
                    ctx.sessions.list.getSnapshot().byId[link.sessionId]
                      ?.title || "任务",
                })),
              ].slice(-3),
            );
            for (const link of changes.notifications.slice(-3)) {
              const id = link.sessionId + ":" + link.outcomeSeq;
              if (
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              ) {
                try {
                  const notice = new Notification("DeepSeek Harness", {
                    body: "一个后台任务已完成。点击查看结果。",
                    tag: id,
                  });
                  native.set(id, notice);
                  notice.onclick = () => {
                    window.focus();
                    ctx.uiWorkspace.openSession(link.sessionId);
                    dismiss(id);
                  };
                  notice.onclose = () => {
                    if (native.get(id) === notice) native.delete(id);
                  };
                } catch (error) {
                  console.warn("DSH completion notification:", error.message);
                }
              }
            }
          } catch (error) {
            if (!disposed)
              console.warn("DSH completion notices:", error.message);
          } finally {
            pending = false;
            if (!disposed && dirty) void update();
          }
        };
        update();
        const unsubscribe = ctx.sessions.list.subscribe(() => {
          dirty = true;
          void update();
        });
        const timer = setInterval(update, 2000);
        return () => {
          disposed = true;
          clearInterval(timer);
          unsubscribe();
          for (const id of native.keys()) close(id);
        };
      }, [ctx, enabled]);
      return h(
        "div",
        {
          "aria-label": "后台完成通知",
          "aria-live": "polite",
          style: {
            position: "fixed",
            right: 20,
            bottom: 20,
            width: "min(360px, calc(100vw - 40px))",
            display: "grid",
            gap: 8,
          },
        },
        notices.map((item) =>
          h(
            "div",
            {
              key: item.id,
              role: "status",
              className: "dsh-nested dsh-nested-card",
              style: {
                pointerEvents: "auto",
                margin: 0,
                boxShadow: "0 4px 24px #0002",
              },
            },
            h("strong", null, "后台任务已完成"),
            h("p", null, item.title),
            h(
              "button",
              {
                onClick: () => {
                  ctx.uiWorkspace.openSession(item.sessionId);
                  dismiss(item.id);
                },
              },
              "查看结果",
            ),
            h(
              "button",
              { "aria-label": "关闭完成通知", onClick: () => dismiss(item.id) },
              "关闭",
            ),
          ),
        ),
      );
    }
    const splitSessionId = (address) =>
      /^dsh-resource:\/\/linked-session\/([A-Za-z0-9_.-]{1,200})$/.exec(
        address,
      )?.[1];
    function installSplitView(ctx) {
      const key = "nested-session-chat";
      ctx.effect(() =>
        ctx.sidebarRightTabs.register({
          id: key,
          kind: key,
          patterns: [splitPrefix + "**"],
          canOpen: (address) => Boolean(splitSessionId(address)),
          title: (address) =>
            ctx.sessions.list.getSnapshot().byId[splitSessionId(address)]
              ?.title || "会话",
        }),
      );
      function FixedView({ renderSlot }) {
        return renderSlot("conversation.session", { view: "chat" });
      }
      function Content({ useSession, renderFactorySlot }) {
        const session = useSession((value) => value);
        return renderFactorySlot(
          "conversation.content",
          {
            variant: "embedded",
            phase: session.openState === "loading" ? "settling" : "active",
            hero: false,
          },
          { slots: { views: FixedView } },
        );
      }
      function Tab({ useTabInfo, SessionProvider, renderSlot }) {
        const { tab } = useTabInfo();
        const id = splitSessionId(tab.contentId);
        const [reference, setReference] = React.useState(null);
        React.useEffect(() => {
          if (!id) return;
          const held = ctx.sessions.retain(id, { source: "sidebarChat" });
          setReference(held);
          return () => held.release();
        }, [id]);
        return h(
          "div",
          {
            style: {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            },
            "aria-label": "并排会话",
          },
          reference?.sessionId === id &&
            h(
              SessionProvider,
              { session: reference },
              renderSlot("nested.split.conversation", {}),
            ),
        );
      }
      ctx.slots.inject("sidebar.right.pane.tab", () =>
        ctx.slots.register(
          {
            name: "sidebar.right.pane.tab",
            key,
            children: {
              "nested.split.conversation": { kind: "single", scope: "session" },
            },
          },
          Tab,
        ),
      );
      ctx.slots.inject("nested.split.conversation", () =>
        ctx.slots.register({ name: "nested.split.conversation" }, Content),
      );
    }
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

    function sidebarGroups(groups, links, list, unavailable) {
      const ids = list.ids.filter((id) => !unavailable.has(id)),
        tree = familyTree(
          links,
          ids.map((id) => ({ id })),
        ),
        visible = new Map(
          groups.flatMap(({ key, ids }) => ids.map((id) => [id, key])),
        ),
        owners = new Map();
      for (const id of ids) {
        const root = rootFor(tree.parents, id);
        if (root !== id && visible.has(root)) owners.set(id, visible.get(root));
      }
      return groups.map(({ key, ids: original }) => {
        const retained = original.filter(
            (id) => !owners.has(id) || owners.get(id) === key,
          ),
          aliases = ids.filter(
            (id) => owners.get(id) === key && !original.includes(id),
          );
        return {
          key,
          ids: [...retained, ...aliases],
          aliases,
          hidden: original.filter(
            (id) => owners.has(id) && owners.get(id) !== key,
          ),
        };
      });
    }

    // Native 0.2.1-rc.2 has no row-order slot; adapt only its semantic row markers, never move React-owned nodes.
    function installSidebarTree(ctx) {
      const selector = '[data-row-key^="session:"]',
        collapsed = new Set(),
        saved = new Map(),
        containers = new Map(),
        aliases = new Map();
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
        const catalog = ctx.sessions.list.getSnapshot(),
          available = catalog.ids.filter((id) => !unavailable.has(id)),
          family = familyTree(
            visibleLinks,
            available.map((id) => ({ id })),
          ),
          plans = sidebarGroups(
            [...groups].map(([key, rows]) => ({
              key,
              ids: rows.map((row) => row.id),
            })),
            visibleLinks,
            catalog,
            unavailable,
          ),
          activeAliases = new Set();
        for (const plan of plans) {
          const rows = groups.get(plan.key);
          for (const id of plan.hidden) {
            const { wrapper } = rows.find((item) => item.id === id);
            preserve(wrapper, ["order", "display"]);
            wrapper.style.display = "none";
            live.add(wrapper);
          }
          groups.set(
            plan.key,
            rows.filter((item) => !plan.hidden.includes(item.id)),
          );
          for (const id of plan.aliases) {
            let alias = aliases.get(id);
            if (!alias) {
              const wrapper = document.createElement("div"),
                row = document.createElement("div"),
                title = document.createElement("span"),
                status = document.createElement("span");
              row.dataset.dshFamilyAlias = id;
              row.className = "dsh-linked-alias";
              row.setAttribute("role", "treeitem");
              row.tabIndex = 0;
              title.style.cssText =
                "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0";
              status.style.cssText =
                "font-size:11px;color:var(--dsw-alias-label-tertiary);flex-shrink:0";
              row.append(title, status);
              row.onclick = () => ctx.uiWorkspace.openSession(id);
              row.onkeydown = (event) => {
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  ctx.uiWorkspace.openSession(id);
                }
              };
              wrapper.append(row);
              alias = { id, row, wrapper, title, status };
              aliases.set(id, alias);
            }
            const summary = catalog.byId[id],
              title = summary?.displayTitle ?? summary?.title ?? "子会话",
              link = visibleLinks.find((link) => link.sessionId === id),
              state =
                {
                  running: "进行中",
                  queued: "排队中",
                  completed: "已完成",
                  error: "出错",
                  blocked: "待处理",
                  stopped: "已停止",
                  question: "等你回答",
                  approval: "等你确认",
                  "plan-review": "等你审阅",
                  paused: "已暂停",
                  unread: "待查看",
                }[
                  progressStatus(
                    summary ?? { id },
                    link,
                    ctx.uiSession.sessionStatus.getSnapshot(),
                  )
                ] ?? "";
            if (alias.title.textContent !== title)
              alias.title.textContent = title;
            if (alias.status.textContent !== state)
              alias.status.textContent = state;
            alias.row.title = summary?.cwd ?? title;
            const active = String(selected === id);
            if (alias.row.getAttribute("aria-selected") !== active)
              alias.row.setAttribute("aria-selected", active);
            if (alias.wrapper.parentElement !== plan.key)
              plan.key.append(alias.wrapper);
            groups.get(plan.key).push(alias);
            activeAliases.add(id);
          }
        }
        for (const [id, alias] of aliases)
          if (!activeAliases.has(id)) {
            restore(alias.row);
            restore(alias.wrapper);
            alias.wrapper.remove();
            aliases.delete(id);
          }
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
              memberSet = new Set(members),
              eligible = new Set(
                available.filter((id) =>
                  memberSet.has(rootFor(family.parents, id)),
                ),
              );
            if (
              hasPartialFamily(
                [...groups.values()].flatMap((items) =>
                  items.map((item) => item.id),
                ),
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
        unsubscribeStatus = ctx.uiSession.sessionStatus.subscribe(schedule),
        timer = setInterval(refresh, 2000);
      refresh();
      return () => {
        disposed = true;
        observer.disconnect();
        unsubscribe();
        unsubscribeWorkspaces();
        unsubscribeStatus();
        clearInterval(timer);
        cancelAnimationFrame(frame);
        for (const element of [...saved.keys()]) restore(element);
        for (const alias of aliases.values()) alias.wrapper.remove();
        aliases.clear();
        for (const [container, [display, direction]] of containers) {
          container.style.display = display;
          container.style.flexDirection = direction;
        }
      };
    }
    function progressStatus(item, link, statuses) {
      if (link?.stoppedByUser || link?.status === "stopped") return "stopped";
      const state = statuses.get(item.id);
      if (
        ["approval", "plan-review", "question"].includes(
          state?.pendingInteraction?.kind,
        )
      )
        return state.pendingInteraction.kind;
      if (state?.running ?? item.running) return "running";
      if (link) return link.status;
      return state?.completionUnread ? "unread" : "idle";
    }
    function attentionGroup(status) {
      if (
        [
          "approval",
          "plan-review",
          "question",
          "error",
          "blocked",
          "paused",
        ].includes(status)
      )
        return "needs-input";
      if (["running", "queued"].includes(status)) return "working";
      if (status === "completed") return "completed";
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
      approval: "等待审批",
      "plan-review": "等待确认方案",
      question: "等待回答",
      unread: "有新进展",
      unavailable: "状态暂不可用",
    };
    function attentionRows(list, statuses, archived, cached = {}) {
      const hidden = new Set(archived);
      return list.ids.flatMap((id) => {
        const item = list.byId[id];
        if (!item || item.blank || item.origin === "subagent" || hidden.has(id))
          return [];
        const saved = cached[id],
          live = statuses.get(id),
          running = live?.running ?? item.running;
        const status =
          saved?.updatedAt === item.updatedAt && saved.running === running
            ? saved.status
            : "unavailable";
        const resolved = ["approval", "plan-review", "question"].includes(
          live?.pendingInteraction?.kind,
        )
          ? live.pendingInteraction.kind
          : running
            ? "running"
            : status;
        return [
          {
            id,
            title: item.title || item.displayTitle || "未命名会话",
            status: resolved,
            group: attentionGroup(resolved) ?? "other",
          },
        ];
      });
    }
    function GlobalAttention({
      ctx,
      useSessions,
      useSessionStatus,
      useWorkspaces,
      wide,
    }) {
      const list = useSessions((value) => value),
        statuses = useSessionStatus((value) => value);
      const workspaces = useWorkspaces((value) => value);
      const [open, setOpen] = React.useState(false),
        [cached, setCached] = React.useState({});
      const [error, setError] = React.useState(""),
        [loading, setLoading] = React.useState(false);
      const [revision, setRevision] = React.useState(0),
        [limits, setLimits] = React.useState({});
      const root = React.useRef(null),
        toggle = React.useRef(null);
      const latestStatuses = React.useRef(statuses);
      latestStatuses.current = statuses;
      const closePanel = () => {
        setOpen(false);
        setCached({});
      };
      const rows = attentionRows(
        list,
        statuses,
        workspaces.archivedSessionIds,
        cached,
      );
      const pending = rows.filter((row) => row.group === "needs-input").length;
      React.useEffect(() => {
        if (!open) return;
        const close = (event) => {
          if (event.key === "Escape") {
            closePanel();
            toggle.current?.focus();
          } else if (
            event.type === "pointerdown" &&
            !root.current?.contains(event.target)
          )
            closePanel();
        };
        document.addEventListener("keydown", close);
        document.addEventListener("pointerdown", close);
        return () => {
          document.removeEventListener("keydown", close);
          document.removeEventListener("pointerdown", close);
        };
      }, [open]);
      React.useEffect(() => {
        if (!open) return;
        let disposed = false;
        const controller = new AbortController();
        const hidden = new Set(workspaces.archivedSessionIds);
        const candidates = list.ids
          .map((id) => list.byId[id])
          .filter(
            (row) =>
              row &&
              !row.blank &&
              row.origin !== "subagent" &&
              !hidden.has(row.id) &&
              (cached[row.id]?.updatedAt !== row.updatedAt ||
                cached[row.id]?.running !==
                  (statuses.get(row.id)?.running ?? row.running) ||
                cached[row.id]?.revision !== revision),
          );
        setLoading(true);
        setError("");
        void (async () => {
          for (let offset = 0; offset < candidates.length; offset += 20) {
            const batch = candidates.slice(offset, offset + 20);
            const value = await call(
              ctx,
              "attention",
              { sessionIds: batch.map((row) => row.id) },
              controller.signal,
            );
            if (disposed) return;
            const stamps = new Map(
              batch.map((row) => [
                row.id,
                {
                  updatedAt: row.updatedAt,
                  running: statuses.get(row.id)?.running ?? row.running,
                },
              ]),
            );
            setCached((old) => {
              const next = { ...old },
                current = ctx.sessions.list.getSnapshot().byId;
              for (const row of value.rows)
                if (
                  stamps.has(row.sessionId) &&
                  current[row.sessionId]?.updatedAt ===
                    stamps.get(row.sessionId).updatedAt &&
                  (latestStatuses.current.get(row.sessionId)?.running ??
                    current[row.sessionId]?.running) ===
                    stamps.get(row.sessionId).running
                )
                  next[row.sessionId] = {
                    ...stamps.get(row.sessionId),
                    status: row.status,
                    revision,
                  };
              for (const id of Object.keys(next))
                if (!current[id] || hidden.has(id)) delete next[id];
              return next;
            });
          }
        })()
          .catch((issue) => {
            if (!disposed) setError(issue.message);
          })
          .finally(() => {
            if (!disposed) setLoading(false);
          });
        return () => {
          disposed = true;
          controller.abort();
        };
      }, [open, list.byId, statuses, workspaces.archivedSessionIds, revision]);
      const groups = [
        ["needs-input", "需要介入"],
        ["working", "进行中"],
        ["completed", "已完成"],
        ["other", "其他会话"],
      ];
      return h(
        "div",
        { ref: root, className: "dsh-nested dsh-global-attention" },
        h(
          "button",
          {
            ref: toggle,
            type: "button",
            "aria-label":
              "会话状态" + (pending ? `，${pending} 个需要介入` : ""),
            "aria-expanded": open,
            "aria-haspopup": "dialog",
            onClick: () => {
              if (open) closePanel();
              else {
                setCached({});
                setOpen(true);
              }
            },
          },
          wide ? "会话状态" : "◉",
          pending ? ` · ${pending}` : "",
        ),
        open &&
          h(
            "section",
            {
              role: "dialog",
              "aria-label": "全部会话状态",
              className: "dsh-attention-popover",
            },
            h(
              "div",
              { className: "dsh-nested-row" },
              h("h3", { style: { flex: 1 } }, "全部会话状态"),
              h(
                "button",
                {
                  type: "button",
                  onClick: () => setRevision((value) => value + 1),
                  disabled: loading,
                },
                "刷新",
              ),
              h(
                "button",
                {
                  type: "button",
                  "aria-label": "关闭会话状态",
                  onClick: () => {
                    closePanel();
                    toggle.current?.focus();
                  },
                },
                "×",
              ),
            ),
            h(
              "small",
              { role: "status" },
              loading
                ? "正在读取原生状态，不调用模型…"
                : "只查看状态；点击名称打开原会话。",
            ),
            error &&
              h("p", { role: "alert", className: "dsh-nested-error" }, error),
            ...groups.map(([key, label]) => {
              const items = rows.filter((row) => row.group === key),
                limit = limits[key] ?? 20;
              return h(
                "details",
                {
                  key,
                  open: key === "needs-input" || key === "working",
                  className: "dsh-attention-group",
                },
                h("summary", null, `${label} ${items.length}`),
                h(
                  "ul",
                  null,
                  ...items.slice(0, limit).map((row) =>
                    h(
                      "li",
                      { key: row.id },
                      h(
                        "button",
                        {
                          type: "button",
                          onClick: () => {
                            ctx.uiWorkspace.openSession(row.id);
                            closePanel();
                          },
                        },
                        h("span", null, row.title),
                        h("small", null, labels[row.status] ?? row.status),
                      ),
                    ),
                  ),
                ),
                items.length > limit &&
                  h(
                    "button",
                    {
                      type: "button",
                      onClick: () =>
                        setLimits((old) => ({ ...old, [key]: limit + 20 })),
                    },
                    "再显示 20 个",
                  ),
                !items.length && h("small", null, "暂无"),
              );
            }),
            h(
              "small",
              null,
              "停止、未开始或状态不可读的历史列入其他，不视为完成。",
            ),
          ),
      );
    }
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
.dsh-linked-alias{display:flex;align-items:center;gap:8px;min-height:32px;padding:6px 8px;box-sizing:border-box;border-radius:var(--dsw-radius-md);font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer;outline-offset:-2px}
.dsh-linked-alias:hover,.dsh-linked-alias[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-nested-status{font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested-status[data-status=completed]{color:#15803d}
.dsh-nested-status[data-status=running],.dsh-nested-status[data-status=queued]{color:#2563eb}
.dsh-nested-status[data-attention=needs-input]{color:var(--dsw-alias-label-primary,#222);font-weight:600}
.dsh-nested-attention{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:12px;margin:12px 0}
.dsh-nested-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0}
.dsh-nested-card .dsh-nested-actions{margin:12px 0 0}
.dsh-nested-card .dsh-nested-actions button{font-size:12px;padding:4px 10px}
.dsh-nested-primary{background:#356ae6!important;color:#fff!important;border-color:#356ae6!important}
.dsh-nested-error{color:#b22;white-space:pre-wrap}
.dsh-nested details{font-size:12px;color:var(--dsw-alias-label-secondary,#697386)}
.dsh-nested summary{cursor:pointer}
.dsh-nested-popup{position:absolute;top:calc(100% + 10px);left:0;width:min(470px,calc(100vw - 30px));max-height:75vh;overflow:auto;z-index:100;padding:22px;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 40px #0002}
.dsh-nested-popup h2{font-size:18px}
.dsh-global-attention>button{font-size:12px;padding:6px 10px}
.dsh-attention-popover{position:fixed;left:12px;bottom:82px;width:min(360px,calc(100vw - 24px));max-height:70vh;overflow:auto;z-index:150;padding:16px;border:1px solid var(--dsw-alias-border-l2,#dce0e7);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 40px #0002}
.dsh-attention-group{margin:12px 0;color:inherit!important}
.dsh-attention-group summary{font-size:13px;font-weight:600;padding:4px 0}
.dsh-attention-group li>button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;border:0;background:transparent;padding:7px 4px}
.dsh-attention-group li>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-attention-group li>button small{white-space:nowrap}
@media(max-width:620px){.dsh-nested-heading{align-items:flex-start;flex-direction:column;gap:8px}.dsh-nested ul ul{margin-left:8px;padding-left:10px}.dsh-nested-card{padding:12px}}
`;

    async function call(
      ctx,
      method,
      request,
      signal = AbortSignal.timeout(30000),
    ) {
      const result = await ctx.connection.rpc.call(
        "/api",
        "nestedSessions/" + method,
        { args: { request } },
        signal,
      );
      if (!result.ok)
        throw new Error(result.error?.message ?? "操作未完成，请重试");
      return result.value;
    }

    function TaskRecap({ ctx, sessionId }) {
      const [value, setValue] = React.useState(null),
        [error, setError] = React.useState("");
      React.useEffect(() => {
        let disposed = false,
          pending = false;
        const update = async () => {
          if (pending) return;
          pending = true;
          try {
            const next = await call(ctx, "progress", { sessionId });
            if (!disposed) {
              setValue(next);
              setError("");
            }
          } catch (e) {
            if (!disposed) setError(e.message);
          } finally {
            pending = false;
          }
        };
        update();
        const timer = setInterval(update, 2000);
        return () => {
          disposed = true;
          clearInterval(timer);
        };
      }, [ctx, sessionId]);
      if (error)
        return h("p", { className: "dsh-nested-error", role: "alert" }, error);
      if (!value) return h("p", { role: "status" }, "正在读取任务与回顾…");
      if (!value.available)
        return h("p", null, "暂时无法读取进展，请打开会话查看历史。");
      const taskLabels = {
        completed: "已完成",
        in_progress: "进行中",
        pending: "待处理",
      };
      return h(
        "div",
        { "aria-label": "任务与回顾" },
        h("h3", null, "任务清单"),
        value.tasks.length
          ? h(
              "ol",
              null,
              value.tasks.map((task, i) =>
                h(
                  "li",
                  { key: i },
                  h(
                    "span",
                    null,
                    (taskLabels[task.status] ?? task.status) +
                      " · " +
                      task.content,
                  ),
                ),
              ),
            )
          : h("p", null, "尚未建立任务清单"),
        value.taskCount > value.tasks.length &&
          h("p", null, "共 " + value.taskCount + " 项；打开会话查看完整清单。"),
        h("h3", null, "最近回合回顾"),
        value.recap.length
          ? value.recap.map((item) =>
              h(
                "p",
                { key: item.turn },
                "第 " + item.turn + " 回合 · " + item.response,
              ),
            )
          : h("p", null, "尚无已结束回合的回复摘要"),
        h("small", null, "回顾仅展示回复片段，不代表验收通过。"),
      );
    }
    function Progress({ ctx, sessionId, useSessions, useSessionStatus }) {
      const notificationsEnabled = useNotificationPreference();
      const list = useSessions((state) => state),
        statuses = useSessionStatus((state) => state);
      const [links, setLinks] = React.useState([]),
        [automatic, setAutomatic] = React.useState(true),
        [requested, setRequested] = React.useState(false),
        [localHistoryEnabled, setLocalHistoryEnabled] = React.useState(false),
        [collapsed, setCollapsed] = React.useState(new Set());
      const [error, setError] = React.useState(""),
        [loadError, setLoadError] = React.useState(""),
        [busy, setBusy] = React.useState(false),
        [expandedRecaps, setExpandedRecaps] = React.useState(new Set());
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
        setLocalHistoryEnabled(value.localHistoryEnabled === true);
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
                setLocalHistoryEnabled(value.localHistoryEnabled === true);
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
      const counts = { "needs-input": 0, working: 0, completed: 0 };
      for (const link of currentLinks) {
        const item = tree.byId.get(link.sessionId);
        if (!item) continue;
        const group = attentionGroup(progressStatus(item, link, statuses));
        if (group) counts[group]++;
      }
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
        const status = progressStatus(item, link, statuses);
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
                {
                  className: "dsh-nested-status",
                  "data-status": status,
                  "data-attention": attentionGroup(status),
                },
                link
                  ? (labels[status] ?? status)
                  : "主会话" +
                      (status !== "idle" ? " · " + labels[status] : ""),
              ),
            ),
            link &&
              h(
                "small",
                null,
                "使用模型：" + (link.selection?.model ?? "继承当前模型"),
              ),
            link?.reason && h("p", null, link.reason),
            h(
              "button",
              {
                disabled: id === current,
                onClick: () =>
                  ctx.sidebarRight.openResource(splitPrefix + id, {
                    kind: "nested-session-chat",
                    preferNewPane: true,
                  }),
              },
              "并排查看",
            ),
            h(
              "details",
              {
                open: expandedRecaps.has(id),
                onToggle: (event) => {
                  const open = event.currentTarget.open;
                  setExpandedRecaps((old) => {
                    const next = new Set(old);
                    if (open) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                },
              },
              h("summary", null, "任务与回顾"),
              expandedRecaps.has(id) &&
                h(TaskRecap, { key: id, ctx, sessionId: id }),
            ),
            link &&
              h(
                "div",
                { className: "dsh-nested-actions" },
                h(
                  "button",
                  { disabled: busy, onClick: () => showResult(id) },
                  "查看结果",
                ),
                [
                  "queued",
                  "running",
                  "paused",
                  "blocked",
                  "approval",
                  "plan-review",
                  "question",
                ].includes(status) &&
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
                counts.working +
                " 个处理中。"
            : "还没有子任务。适合并行的任务会自动出现在这里，简单问题仍由主会话直接完成。",
        ),
        currentLinks.length > 0 &&
          h(
            "div",
            {
              className: "dsh-nested-attention",
              "aria-label": "子任务状态分类",
              role: "status",
            },
            h("span", null, "需要介入 " + counts["needs-input"]),
            h("span", null, "进行中 " + counts.working),
            h("span", null, "已完成 " + counts.completed),
          ),
        h("ul", { "aria-label": "父子任务进度" }, roots.map(row)),
        h(
          "button",
          {
            disabled: busy || !current,
            "aria-pressed": localHistoryEnabled,
            onClick: () =>
              run(() =>
                call(ctx, "localAccess", {
                  sessionId: current,
                  enabled: !localHistoryEnabled,
                }),
              ),
          },
          "当前会话查阅本机历史：" + (localHistoryEnabled ? "开启" : "关闭"),
        ),
        h(
          "p",
          null,
          h(
            "small",
            null,
            "仅授权当前会话在本次运行中只读查阅其他工作区历史，不继承给子会话，不授予消息或控制权限。",
          ),
        ),
        h(
          "button",
          {
            "aria-pressed": notificationsEnabled,
            onClick: () =>
              run(async () => {
                localStorage.setItem(
                  notificationKey,
                  notificationsEnabled ? "off" : "on",
                );
                window.dispatchEvent(new Event(notificationEvent));
              }),
          },
          "后台完成通知：" + (notificationsEnabled ? "开启" : "关闭"),
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
            "主会话负责分工与最终汇总，子会话负责独立交付。/collaborate 任务内容 立即把任务交给主会话；在子会话输入也会送到所属主会话。/collaborate on 只开启模式；off 暂停新分工；auto 恢复按需判断。已有深层历史仍按真实关系展示，新分工只创建主会话的直接子任务。",
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: "nested-attention", order: 80 },
          (props) => h(GlobalAttention, { ...props, ctx }),
        ),
      );
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "nested-completion-notices", order: 80 },
          () => h(CompletionNotices, { ctx }),
        ),
      );
      installSplitView(ctx);
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
    return {
      inject,
      apply,
      familyTree,
      sidebarRows,
      hasPartialFamily,
      sidebarGroups,
      progressStatus,
      attentionGroup,
      attentionRows,
      splitSessionId,
      completionUpdates,
    };
  },
});
