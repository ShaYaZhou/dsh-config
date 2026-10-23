window.__ModuleLoader__.load({
  id: "@local/dsh-follow-ups",
  factory: (require) => {
    const React = require("react"),
      h = React.createElement;
    const { Switch } = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    const changed = createSnapshotStore({
      sessionId: "",
      revision: 0,
      promptSuggestions: null,
      preferenceRevision: -1,
    });
    const invalidate = (sessionId, fields = {}) =>
      changed.set({
        ...changed.getSnapshot(),
        sessionId,
        revision: changed.getSnapshot().revision + 1,
        ...fields,
      });
    const learnPreferences = (value) => {
      if (
        typeof value.promptSuggestions === "boolean" &&
        Number.isInteger(value.revision) &&
        value.revision > changed.getSnapshot().preferenceRevision
      )
        invalidate(null, {
          promptSuggestions: value.promptSuggestions,
          preferenceRevision: value.revision,
        });
    };
    const inject = [
      "slots",
      "connection",
      "sessions",
      "conversation",
      "uiWorkspace",
    ];
    const prefix = "dsh-followups";
    async function call(ctx, method, request, signal) {
      const result = await ctx.connection.rpc.call(
        "/api",
        "followUps/" + method,
        { args: { request } },
        AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      );
      if (!result.ok)
        throw new Error(result.error?.message ?? "后续建议操作未完成");
      return result.value;
    }
    function affectsOffer(change) {
      if (["replace", "prepend"].includes(change.kind)) return true;
      const entries =
        change.kind === "settle-assistant"
          ? [change.entry]
          : (change.entries ?? []);
      return entries.some(
        (entry) =>
          entry?.type === "event" &&
          (entry.event.type.startsWith("plugin:follow-ups/") ||
            [
              "tool/result",
              "user/message",
              "turn/end",
              "turn/start",
              "agent/inbox/spliced",
              "working-directory/change",
              "permission/preset",
              "sandbox/mode",
              "approval/policy",
              "agent-preset/selected",
            ].includes(entry.event.type)),
      );
    }
    function useOffer(ctx, sessionId, enabled = true) {
      const binding = ctx.sessions.binding(sessionId);
      const [value, setValue] = React.useState(null),
        [error, setError] = React.useState("");
      const updateRef = React.useRef(async () => {});
      React.useEffect(() => {
        setValue(null);
        setError("");
        if (!enabled) return;
        const controller = new AbortController();
        let pending = false,
          dirty = false;
        const update = async () => {
          if (pending) {
            dirty = true;
            return;
          }
          pending = true;
          try {
            do {
              dirty = false;
              try {
                const next = await call(
                  ctx,
                  "view",
                  { sessionId },
                  controller.signal,
                );
                if (controller.signal.aborted) return;
                learnPreferences({
                  promptSuggestions: next.promptSuggestionsEnabled,
                  revision: next.preferenceRevision,
                });
                if (controller.signal.aborted) return;
                setValue(next);
                setError("");
              } catch (failure) {
                if (!controller.signal.aborted) setError(failure.message);
              }
            } while (dirty && !controller.signal.aborted);
          } finally {
            pending = false;
          }
        };
        updateRef.current = update;
        void update();
        const off = binding?.eventSource.subscribe(() => {
          if (affectsOffer(binding.eventSource.getSnapshot().change))
            void update();
        });
        const offPreference = changed.subscribe(() => {
          if (
            changed.getSnapshot().sessionId === null ||
            changed.getSnapshot().sessionId === sessionId
          )
            void update();
        });
        return () => {
          controller.abort();
          off?.();
          offPreference();
          updateRef.current = async () => {};
        };
      }, [ctx, sessionId, binding, enabled]);
      return { value, error, refresh: () => updateRef.current() };
    }
    function facadeFor(ctx, sessionId) {
      const binding = ctx.sessions.binding(sessionId);
      return binding
        ? { binding, input: ctx.conversation.input.for(binding.ctx) }
        : null;
    }
    function emptyInput(input) {
      return (
        input?.phase === "plain" &&
        input.draft === "" &&
        !input.claim &&
        input.attachmentIds.length === 0 &&
        input.occurrences.length === 0 &&
        input.queue.length === 0
      );
    }
    function mountSuggestionKeys(anchor, sessionId, handlers) {
      const card = anchor.closest("[data-composer-card]");
      const scope = anchor.closest("[data-conversation-session]");
      if (
        !card ||
        scope?.getAttribute("data-conversation-session") !== sessionId
      )
        return () => {};
      const editor = card.querySelector("[data-composer-input]");
      if (!editor) return () => {};
      const onKey = (event) => {
        if (
          !anchor.isConnected ||
          !editor.isContentEditable ||
          !editor.contains(event.target) ||
          event.isComposing ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.shiftKey ||
          editor.hasAttribute("data-composer-composing") ||
          card.querySelector('[aria-expanded="true"]') ||
          !editor.getClientRects().length ||
          !handlers.eligible()
        )
          return;
        if (event.key === "Tab" || event.key === "ArrowRight") {
          if (!handlers.accept()) return;
        } else if (event.key === "Escape") handlers.dismiss();
        else return;
        event.preventDefault();
        event.stopPropagation();
      };
      card.addEventListener("keydown", onKey, true);
      return () => card.removeEventListener("keydown", onKey, true);
    }
    function Cards({ ctx, sessionId, useSessions }) {
      const { value, error: readError, refresh } = useOffer(ctx, sessionId);
      const rows = useSessions((state) => state.byId);
      const [busy, setBusy] = React.useState(false),
        [error, setError] = React.useState("");
      const lifetime = React.useRef(null),
        pending = React.useRef(null);
      React.useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        setBusy(false);
        setError("");
        pending.current = null;
        return () => controller.abort();
      }, [sessionId]);
      const offer = value?.offer;
      const run = async (method, request) => {
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted || pending.current) return;
        const token = {};
        pending.current = token;
        setBusy(true);
        setError("");
        try {
          const result = await call(
            ctx,
            method,
            { sessionId, offerId: offer.id, ...request },
            signal,
          );
          if (signal.aborted) return;
          invalidate(sessionId);
          const failure = result.results?.find((row) => row.error);
          if (failure) setError("有任务未启动或启动尚未确认：" + failure.error);
          else if (method === "accept")
            facadeFor(ctx, sessionId)?.input.notify(
              "info",
              request.mode === "here"
                ? "后续任务已加入本会话，原草稿保留。"
                : "已交给独立会话，原任务继续。可在会话树或任务协作中查看。",
            );
          await refresh();
        } catch (failure) {
          if (!signal.aborted) setError(failure.message);
        } finally {
          if (pending.current === token) {
            pending.current = null;
            if (!signal.aborted) setBusy(false);
          }
        }
      };
      if (!offer || !offer.tasks.some((task) => task.status !== "dismissed"))
        return readError
          ? h(
              "p",
              { className: prefix + "-notice", role: "status" },
              "后续建议暂不可用：" + readError,
            )
          : null;
      const tasks = offer.tasks.filter((task) => task.status !== "dismissed");
      const waiting = tasks.filter((task) => task.status === "pending");
      const uncertain = tasks.some(
        (task) => task.status === "uncertain" || task.status === "admitting",
      );
      const button = (label, click, disabled = false) =>
        h(
          "button",
          { type: "button", onClick: click, disabled: busy || disabled },
          label,
        );
      const taskCards = tasks.map((task) => {
        const unfinished =
          task.status === "admitting" && !value.activeTaskIds.includes(task.id);
        const status = {
          pending: "尚未执行",
          admitting: unfinished ? "启动结果未确认" : "准备工作区…",
          started: "已交给独立会话",
          here: "已加入本会话",
          uncertain: "启动结果未确认",
        }[task.status];
        return h(
          "article",
          { key: task.id, className: prefix + "-card" },
          h(
            "div",
            { className: prefix + "-heading" },
            h("strong", null, task.title),
            h("small", null, status),
            task.status === "pending" &&
              h(
                "button",
                {
                  type: "button",
                  className: prefix + "-dismiss",
                  disabled: busy,
                  "aria-label": "不再显示建议：" + task.title,
                  onClick: () => run("dismiss", { taskId: task.id }),
                },
                "×",
              ),
          ),
          h(
            "details",
            null,
            h("summary", null, "完整任务"),
            h("p", { className: prefix + "-brief" }, task.prompt),
          ),
          task.error &&
            h(
              "p",
              { role: "status", className: prefix + "-error" },
              task.error,
            ),
          h(
            "div",
            { className: prefix + "-actions" },
            task.status === "pending" &&
              h(
                React.Fragment,
                null,
                button(
                  "在这里执行",
                  () => run("accept", { taskIds: [task.id], mode: "here" }),
                  value.archived,
                ),
                button(
                  "独立启动",
                  () => run("accept", { taskIds: [task.id], mode: "isolated" }),
                  value.archived,
                ),
              ),
            task.childId &&
              button("查看会话", () =>
                ctx.uiWorkspace.openSession(task.childId),
              ),
            (task.status === "uncertain" || unfinished) &&
              !task.childId &&
              task.preparationSessionIds?.map((id, index) =>
                h(
                  "button",
                  {
                    key: id,
                    type: "button",
                    disabled: !rows[id],
                    onClick: () => ctx.uiWorkspace.openSession(id),
                  },
                  "查看保留工作区 " + (index + 1),
                ),
              ),
          ),
        );
      });
      return h(
        "section",
        { className: prefix, "aria-label": "可选后续任务" },
        h(
          "div",
          { className: prefix + "-heading" },
          h("strong", null, "可选后续任务"),
          waiting.length > 1 &&
            button(
              "全部启动",
              () =>
                run("accept", {
                  taskIds: waiting.map((task) => task.id),
                  mode: "isolated",
                }),
              value.archived,
            ),
          waiting.length > 0 &&
            button("关闭待处理建议", () => run("dismiss", {})),
        ),
        waiting.length > 0 &&
          h(
            "p",
            { className: prefix + "-hint" },
            "确认后才执行。独立启动使用新的 Git worktree，基于已提交内容，不复制原目录未提交改动；权限和模型继承当前会话。",
          ),
        (error || readError) &&
          h(
            "p",
            { role: "alert", className: prefix + "-error" },
            error || readError,
          ),
        !waiting.length && !uncertain
          ? h(
              "details",
              null,
              h("summary", null, "已确认的后续任务"),
              ...taskCards,
            )
          : taskCards,
      );
    }
    function Ghost({
      ctx,
      sessionId,
      useInput,
      inputActions,
      useSessionStatus,
    }) {
      const preference = React.useSyncExternalStore(
        (listener) => changed.subscribe(listener),
        () => changed.getSnapshot().promptSuggestions,
      );
      const { value, refresh } = useOffer(ctx, sessionId, preference !== false);
      const enabled = (preference ?? value?.promptSuggestionsEnabled) === true;
      const input = useInput((snapshot) => snapshot),
        status = useSessionStatus((states) => states.get(sessionId));
      const [hidden, setHidden] = React.useState(false);
      const anchor = React.useRef(null),
        lifetime = React.useRef(null);
      const offer = value?.offer;
      React.useEffect(() => {
        setHidden(false);
      }, [offer?.id]);
      React.useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => controller.abort();
      }, [sessionId]);
      const visible =
        enabled &&
        !hidden &&
        offer?.nextPrompt &&
        offer.promptReady &&
        !offer.promptDismissed &&
        !value.archived &&
        emptyInput(input) &&
        !status?.running &&
        !status?.pendingInteraction;
      const eligible = () => {
        const target = facadeFor(ctx, sessionId);
        const snapshot = target?.binding.session.getSnapshot();
        return (
          visible &&
          target &&
          snapshot.openState === "open" &&
          !snapshot.removed &&
          !snapshot.running &&
          snapshot.pendingSubmissions.length === 0 &&
          emptyInput(target.input.state.getSnapshot())
        );
      };
      const dismiss = () => {
        setHidden(true);
        const signal = lifetime.current.signal;
        void call(
          ctx,
          "dismiss",
          { sessionId, offerId: offer.id, promptOnly: true },
          signal,
        )
          .then(() => {
            invalidate(sessionId);
            return refresh();
          })
          .catch((failure) => {
            if (!signal.aborted)
              facadeFor(ctx, sessionId)?.input.notify(
                "error",
                "建议已暂时隐藏，保存选择失败：" + failure.message,
              );
          });
      };
      const accept = () => {
        if (!eligible()) return false;
        if (
          !inputActions.insertText(
            offer.nextPrompt,
            inputActions.captureInsertion(),
          )
        )
          return false;
        inputActions.persistDraft();
        facadeFor(ctx, sessionId)?.input.focus();
        dismiss();
        return true;
      };
      React.useEffect(() => {
        if (!visible || !anchor.current) return;
        return mountSuggestionKeys(anchor.current, sessionId, {
          eligible,
          accept,
          dismiss,
        });
      }, [sessionId, visible, offer?.id, offer?.nextPrompt]);
      if (!visible) return null;
      return h(
        "div",
        {
          ref: anchor,
          className: prefix + "-ghost",
          "data-follow-up-ghost": true,
        },
        h("span", { title: offer.nextPrompt }, offer.nextPrompt),
        h(
          "button",
          {
            type: "button",
            onClick: accept,
            title: "Tab 或右方向键采纳，不会自动发送",
            "aria-label": "采纳输入框建议",
          },
          "Tab 采纳",
        ),
        h(
          "button",
          {
            type: "button",
            onClick: dismiss,
            title: "Esc 隐藏",
            "aria-label": "隐藏输入框建议",
          },
          "×",
        ),
      );
    }
    function Settings({ ctx }) {
      const enabled = React.useSyncExternalStore(
        (listener) => changed.subscribe(listener),
        () => changed.getSnapshot().promptSuggestions,
      );
      const [loading, setLoading] = React.useState(true),
        [busy, setBusy] = React.useState(false),
        [error, setError] = React.useState("");
      const lifetime = React.useRef(null);
      React.useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        call(ctx, "preferences", {}, controller.signal)
          .then((value) => {
            if (!controller.signal.aborted) {
              learnPreferences(value);
              setLoading(false);
            }
          })
          .catch((failure) => {
            if (!controller.signal.aborted) {
              setError(failure.message);
              setLoading(false);
            }
          });
        return () => controller.abort();
      }, []);
      const change = async (enabled) => {
        setBusy(true);
        setError("");
        const signal = lifetime.current.signal;
        try {
          const value = await call(ctx, "preferences", { enabled }, signal);
          if (!signal.aborted) learnPreferences(value);
        } catch (failure) {
          if (!signal.aborted) setError(failure.message);
        } finally {
          if (!signal.aborted) setBusy(false);
        }
      };
      return h(
        "section",
        { className: prefix + "-settings" },
        h("h2", null, "后续建议"),
        h(
          "p",
          null,
          "可选后续任务只有在你确认后才执行；启动使用独立会话和 Git worktree，在这里执行则排入当前会话，不替换草稿。",
        ),
        h(
          "div",
          { className: prefix + "-heading" },
          h("span", null, "输入框建议"),
          h(Switch, {
            label: "输入框建议",
            checked: enabled === true,
            disabled: busy || loading || enabled === null,
            onChange: change,
          }),
        ),
        h(
          "p",
          null,
          "复用当前回合给出的下一步建议，不额外调用后台模型。空白且无附件时显示，Tab 或右方向键只采纳为草稿；未采纳时 Enter 不会发送。Esc 可隐藏。关闭后立即隐藏，并让后续回合停止生成输入框建议；任务卡片仍可按需提出。",
        ),
        error && h("p", { role: "alert", className: prefix + "-error" }, error),
      );
    }
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `
          .${prefix}{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,850px);margin:0 auto 10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#8884);border-radius:12px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,inherit)}
          .${prefix}-heading,.${prefix}-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.${prefix}-heading strong{flex:1;min-width:0;overflow-wrap:anywhere}.${prefix}-heading small{flex:none;color:var(--dsw-alias-label-secondary,#888)}
          .${prefix} button{font:inherit;white-space:nowrap;color:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#8885);background:transparent;border-radius:6px;padding:4px 8px}.${prefix} button:disabled{opacity:.45;cursor:default}
          .${prefix}-card{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2,#8883);margin-top:8px}.${prefix}-actions{margin-top:8px}.${prefix} summary{cursor:pointer;margin:6px 0;color:var(--dsw-alias-label-secondary,#888)}
          .${prefix}-brief{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}.${prefix}-hint,.${prefix}-notice{font-size:12px;color:var(--dsw-alias-label-secondary,#888);line-height:1.6}.${prefix}-hint{margin:6px 0 0}.${prefix}-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#c44);overflow-wrap:anywhere}
          .${prefix}-ghost{position:absolute;left:14px;right:14px;top:12px;display:flex;gap:8px;align-items:center;font:inherit;line-height:inherit;color:var(--dsw-alias-label-caption,#888);pointer-events:none;z-index:1}
          .${prefix}-ghost>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.${prefix}-ghost button{pointer-events:auto;font:inherit;font-size:11px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#8884);border-radius:5px;cursor:pointer;padding:2px 6px;white-space:nowrap}
          [data-composer-card]:has([data-follow-up-ghost]) [data-composer-placeholder]{visibility:hidden}
          .${prefix}-settings{max-width:640px;padding:24px;line-height:1.7}.${prefix}-settings p{font-size:13px;color:var(--dsw-alias-label-secondary,#888)}
        `;
        document.head.append(style);
        return () => style.remove();
      });
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register(
          { name: "conversation.input.dock", id: "follow-ups", order: 85 },
          (props) => h(Cards, { ...props, ctx }),
        ),
      );
      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register(
          {
            name: "conversation.input.overlay",
            id: "follow-ups-prompt",
            order: 85,
          },
          (props) => h(Ghost, { ...props, ctx }),
        ),
      );
      ctx.slots.inject("settings.enhancement.panel", () =>
        ctx.slots.register(
          {
            name: "settings.enhancement.panel",
            id: "follow-ups",
            order: 29,
            label: "后续建议",
          },
          () => h(Settings, { ctx }),
        ),
      );
    }
    return { inject, apply };
  },
});
