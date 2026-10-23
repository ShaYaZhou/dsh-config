window.__ModuleLoader__.load({
  id: "@local/dsh-team-view",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const inject = ["slots", "sessions", "uiWorkspace", "sidebarRight"];
    const prefix = "dsh-team-view";
    // getSnapshot must return a stable reference while no Team is selected.
    const EMPTY_TEAM = { members: [], tasks: [], plans: [] };
    // Public right-panel resource registered by the native subagent UI.
    const CHAT_ADDRESS = "dsh-resource://subagentchat/session/";

    /**
     * Pick the Team projection that belongs to the selected Session: the nearest
     * Session in its parent chain whose Team projection is a real Team.
     * @param {object} list - sessions list snapshot.
     * @param {string} [sessionId] - selected Session identity.
     * @returns {{members: object[], tasks: object[], plans: object[]}} Team wire view.
     */
    function teamOf(list, sessionId) {
      const own =
        sessionId === undefined ? undefined : list?.byId?.[sessionId];
      const ownTeam = own?.projectionValues?.agentTeam;
      const seen = new Set();
      for (
        let row = own;
        row !== undefined && !seen.has(row);
        row =
          row.parentId === undefined ? undefined : list?.byId?.[row.parentId]
      ) {
        seen.add(row);
        const team = row.projectionValues?.agentTeam;
        if (team !== undefined && team.members.length > 1) return team;
      }
      return ownTeam ?? EMPTY_TEAM;
    }

    /**
     * Derive one row per teammate with its work and pending-plan counts.
     * @param {{members: object[], tasks: object[], plans: object[]}} team - Team wire view.
     * @returns {object[]} teammate rows in roster order.
     */
    function memberRows(team) {
      const counts = new Map();
      const bump = (name, key) => {
        if (name === undefined) return;
        const count = counts.get(name) ?? { working: 0, pendingPlans: 0 };
        count[key] += 1;
        counts.set(name, count);
      };
      for (const task of team.tasks)
        if (task.status === "in_progress") bump(task.ownerName, "working");
      for (const plan of team.plans)
        if (plan.status === "pending") bump(plan.authorName, "pendingPlans");
      return team.members
        .filter((member) => member.role === "teammate")
        .map((member) => {
          const count = counts.get(member.name);
          return {
            id: member.id,
            name: member.name,
            phase: member.phase,
            error: member.error,
            working: count?.working ?? 0,
            pendingPlans: count?.pendingPlans ?? 0,
          };
        });
    }

    /**
     * Address one member Session for the native right-panel chat resource.
     * @param {{parentSessionId: string, childSessionId: string, mode: string}} address - subagent address.
     * @returns {string} canonical resource address.
     */
    function chatAddress(address) {
      return (
        CHAT_ADDRESS +
        encodeURIComponent(address.childSessionId) +
        "?parent=" +
        encodeURIComponent(address.parentSessionId) +
        "&mode=" +
        address.mode
      );
    }

    /**
     * Open one member beside the current conversation, without replacing it.
     * @returns whether a side pane was opened.
     */
    function openAside(ctx, id) {
      const address = ctx.sessions.subagentAddress(id);
      if (address === undefined || !ctx.sidebarRight) return false;
      ctx.sidebarRight.openResource(chatAddress(address), {
        kind: "subagentchat",
        preferNewPane: true,
      });
      return true;
    }

    function Board({ ctx, sessionId }) {
      const [notice, setNotice] = React.useState("");
      const team = React.useSyncExternalStore(
        (listener) => ctx.sessions.list.subscribe(listener),
        () => teamOf(ctx.sessions.list.getSnapshot(), sessionId),
      );
      const rows = memberRows(team);
      const pending = team.plans.filter((plan) => plan.status === "pending");
      const button = (label, action, primary = false) =>
        h(
          "button",
          {
            type: "button",
            onClick: action,
            className: primary ? prefix + "-primary" : undefined,
          },
          label,
        );
      const openAll = () => {
        const failed = rows.filter((row) => !openAside(ctx, row.id));
        setNotice(
          failed.length === 0
            ? `已并排打开 ${rows.length} 个成员。`
            : `已并排打开 ${rows.length - failed.length} 个成员；${failed
                .map((row) => row.name)
                .join("、")} 还没有可并排打开的子会话。`,
        );
      };
      return h(
        "section",
        { className: prefix, "aria-label": "Team 成员" },
        h(
          "header",
          { className: prefix + "-intro" },
          h("h2", null, "Team 成员"),
          h(
            "p",
            null,
            "一个 Team 的成员在同一个工作目录里协作。可把任一成员并排打开在当前会话旁，查看它的对话与进展。",
          ),
        ),
        !rows.length &&
          h(
            "p",
            { className: prefix + "-muted" },
            "当前会话还没有 Team 成员。由 Lead 用 spawn_teammate 创建后，成员会出现在这里。",
          ),
        rows.length > 0 &&
          h(
            "div",
            { className: prefix + "-toolbar" },
            button("全部并排", openAll, true),
            button("回到 Lead 视图", () =>
              ctx.uiWorkspace.openSession(
                team.members.find((member) => member.role === "lead")?.id ??
                  sessionId,
              ),
            ),
          ),
        notice && h("p", { role: "status" }, notice),
        ...rows.map((row) =>
          h(
            "article",
            { key: row.id, className: prefix + "-card" },
            h(
              "div",
              { className: prefix + "-head" },
              h("strong", null, row.name),
              h(
                "span",
                { className: prefix + "-badge" },
                row.phase === "active"
                  ? "就绪"
                  : row.phase === "provisioning"
                    ? "创建中"
                    : "创建失败",
              ),
              row.pendingPlans > 0 &&
                h(
                  "span",
                  { className: prefix + "-badge " + prefix + "-warn" },
                  row.pendingPlans + " 个计划待审批",
                ),
            ),
            h(
              "p",
              { className: prefix + "-muted" },
              row.working > 0
                ? `进行中的任务 ${row.working} 个`
                : "当前没有进行中的任务",
              row.error === undefined ? "" : " · " + row.error,
            ),
            h(
              "div",
              { className: prefix + "-actions" },
              button(
                "并排打开",
                () => {
                  if (!openAside(ctx, row.id))
                    setNotice(
                      `${row.name} 还没有可并排打开的子会话；先让它在主视图里拥有一次会话记录。`,
                    );
                },
                true,
              ),
              button("在主视图打开", () => ctx.uiWorkspace.openSession(row.id)),
            ),
          ),
        ),
        pending.length > 0 &&
          h(
            "div",
            null,
            h("h3", null, "待审批计划"),
            ...pending.map((plan) =>
              h(
                "article",
                { key: plan.id, className: prefix + "-card" },
                h(
                  "div",
                  { className: prefix + "-head" },
                  h("strong", null, plan.authorName ?? plan.id),
                  h("span", { className: prefix + "-badge" }, "待审批"),
                ),
                h(
                  "pre",
                  { className: prefix + "-plan" },
                  plan.content.length > 600
                    ? plan.content.slice(0, 600) + "…"
                    : plan.content,
                ),
              ),
            ),
          ),
      );
    }

    function Launcher({ ctx }) {
      const [open, setOpen] = React.useState(false),
        dialog = React.useRef(null);
      const sessionId = React.useSyncExternalStore(
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
            title: "Team 成员与并排视图",
            "aria-label": "Team 成员与并排视图",
            onClick: () => setOpen(true),
          },
          "Team",
        ),
        h(
          "dialog",
          {
            ref: dialog,
            className: prefix + "-dialog",
            "aria-label": "Team 成员与并排视图",
            onClose: () => setOpen(false),
          },
          h(
            "button",
            {
              type: "button",
              className: prefix + "-close",
              "aria-label": "关闭 Team 成员视图",
              onClick: () => setOpen(false),
            },
            "关闭",
          ),
          open &&
            h(Board, {
              ctx,
              sessionId,
            }),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `
          .${prefix}{font:inherit;color:inherit;padding:24px;line-height:1.6;min-width:0}
          .${prefix} h2{font-size:22px;margin:0 0 6px}.${prefix} h3{font-size:16px}
          .${prefix}-intro p,.${prefix}-muted{font-size:13px;opacity:.72;margin:6px 0 14px}
          .${prefix}-toolbar,.${prefix}-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
          .${prefix} button,.${prefix}-close{font:inherit;font-size:13px;padding:6px 11px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
          .${prefix} button:focus-visible{outline:2px solid #4179ed;outline-offset:2px}
          .${prefix} button.${prefix}-primary{background:#326ce5;border-color:#326ce5;color:white}
          .${prefix}-card{border:1px solid #8884;border-radius:10px;padding:14px;margin:10px 0}
          .${prefix}-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
          .${prefix}-badge{font-size:12px;padding:1px 8px;border:1px solid #8886;border-radius:999px;opacity:.85}
          .${prefix}-warn{border-color:#c9861f;color:#a8690f}
          .${prefix}-plan{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#8881;border-radius:8px;padding:10px;margin:10px 0 0;max-height:240px;overflow:auto}
          .${prefix}-dialog{box-sizing:border-box;width:min(860px,94vw);max-height:88vh;border:1px solid #8885;border-radius:14px;padding:0;background:Canvas;color:CanvasText;box-shadow:0 20px 70px #0003;overflow:auto}
          .${prefix}-dialog::backdrop{background:#0005}.${prefix}-close{float:right;margin:14px 18px 0}
          .${prefix}-launcher{font:inherit;color:inherit;background:transparent;border:0;padding:6px 8px;cursor:pointer;border-radius:6px}
        `;
        document.head.append(style);
        return () => style.remove();
      });
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "team-view",
            order: 72,
          },
          (props) => h(Launcher, { ...props, ctx }),
        ),
      );
    }
    return { inject, apply };
  },
});
