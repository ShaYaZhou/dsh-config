window.__ModuleLoader__.load({
  id: "@local/dsh-delete-session",
  factory: (require) => {
    const React = require("react"),
      {
        MenuItemButton,
        Modal,
        Button,
        IconTrashOutlineRegular,
      } = require("@deepseek-ai/dsh-client-ui-primitives"),
      { createSnapshotStore } = require("@deepseek-ai/dsh-client-store"),
      h = React.createElement;
    const inject = ["slots", "uiWorkspace", "workspaces", "connection"];
    const deleteRequest = createSnapshotStore(null);

    function DeleteSessionMenuItem({
      sessionId,
      displayTitle,
      useMenuOpenState,
      requestDelete,
    }) {
      const [, setMenuOpen] = useMenuOpenState();
      return h(
        MenuItemButton,
        {
          icon: h(IconTrashOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false);
            requestDelete({ sessionId, displayTitle });
          },
        },
        "删除会话",
      );
    }

    function DeleteConfirmDialog({ useDeleteRequest, settleDelete, confirmDelete }) {
      const request = useDeleteRequest((pending) => pending);
      if (request === null) return null;
      return h(DeleteConfirmForm, {
        key: request.sessionId,
        request,
        onSettle: settleDelete,
        onConfirm: confirmDelete,
      });
    }

    function DeleteConfirmForm({ request, onSettle, onConfirm }) {
      const [deleting, setDeleting] = React.useState(false),
        [error, setError] = React.useState(null);
      const close = () => {
        if (deleting) return;
        onSettle();
      };
      const confirm = () => {
        setDeleting(true);
        setError(null);
        onConfirm(request.sessionId).then(onSettle, (reason) => {
          setDeleting(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      };
      return h(Modal, {
        open: true,
        onClose: close,
        closeLabel: "关闭",
        title: "删除会话？",
        description: `“${request.displayTitle}”将停止运行并移入回收站，可在 DSH 主目录的 dsh-delete-session-trash 中恢复。`,
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { variant: "outline", disabled: deleting, onClick: close },
            "取消",
          ),
          h(
            Button,
            { variant: "outline", disabled: deleting, onClick: confirm },
            deleting ? "正在删除…" : "删除",
          ),
        ),
        children: error === null ? null : h("div", { role: "alert" }, error),
      });
    }

    function apply(ctx) {
      async function confirmDelete(sessionId) {
        const archived = new Set(
          ctx.workspaces.list.getSnapshot().archivedSessionIds,
        );
        if (!archived.has(sessionId))
          await ctx.uiWorkspace.archiveSession(sessionId, {
            stopActivity: true,
          });
        const result = await ctx.connection.rpc.call(
          "/api",
          "deleteSession/delete",
          { args: { request: { sessionId } } },
          AbortSignal.timeout(60000),
        );
        if (!result.ok) throw new Error(result.error?.message ?? "删除会话失败");
      }

      ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
        ctx.slots.register(
          {
            name: "sidebar.workspaces.session.menu.item",
            id: "delete-session",
            order: 500,
            inject: () => ({
              hooks: { deleteRequest },
              requestDelete: (payload) => deleteRequest.set(payload),
            }),
          },
          DeleteSessionMenuItem,
        ),
      );
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "delete-session",
            inject: () => ({
              hooks: { deleteRequest },
              settleDelete: () => deleteRequest.set(null),
              confirmDelete,
            }),
          },
          DeleteConfirmDialog,
        ),
      );
    }

    return { inject, apply };
  },
});
