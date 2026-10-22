window.__ModuleLoader__.load({
  id: "@local/dsh-file-links",
  factory: () => {
    // 原生 chatFileMentions 只识别本回合产出或交付的文件；这里包装它的
    // forClosing，让消息里出现的普通路径也走同一套侧边栏预览。
    // 该接缝固定宿主 0.2.1-rc.2 的接口，升级后需重新验收。
    const inject = ["chatFileMentions"];
    const originals = new WeakMap();
    // 无扩展名时只有这些顶层目录开头的路径才算文件路径，避免把
    // "and/or" 之类的普通文本变成链接。
    const TOP_LEVEL =
      /^(?:apps|assets|build|components|config|configs|dist|docs|lib|modules|node_modules|packages|plugins|private|public|scripts|services|skills|src|test|tests|tools|utils)$/;
    const FILE_NAME = /^(.+)\.([A-Za-z][A-Za-z0-9]{0,9})$/;
    const HIDDEN_FILE = /^\.[A-Za-z][A-Za-z0-9._-]*$/;
    const LINE_SUFFIX = /^(.+?)(?:[:#]L?(\d+)(?:-L?(\d+))?)$/;

    function isPathLike(path) {
      if (/^[A-Za-z]:[\\/]/.test(path)) return true;
      if (
        path.startsWith("/") ||
        path.startsWith("./") ||
        path.startsWith("../") ||
        path.startsWith(".\\") ||
        path.startsWith("..\\")
      )
        return true;
      if (HIDDEN_FILE.test(path)) return true;
      const name = FILE_NAME.exec(path);
      if (name !== null) {
        const [, stem, extension] = name;
        if (/[\\/]/.test(path) || stem.length >= 2 || extension.length >= 2)
          return true;
      }
      const [first] = path.split(/[\\/]/);
      return (
        (path.includes("/") || path.includes("\\")) &&
        TOP_LEVEL.test(first.toLowerCase())
      );
    }

    // 只凭语法判断，不访问磁盘：返回 { path, line } 或 undefined。
    function parsePathRef(raw) {
      if (typeof raw !== "string") return undefined;
      if (raw === "" || /\s/.test(raw)) return undefined;
      if (
        raw.startsWith("//") ||
        raw.startsWith("\\\\") ||
        raw.includes("://")
      )
        return undefined;
      if (/["'`<>|]/.test(raw)) return undefined;
      let path = raw;
      let line;
      const suffix = LINE_SUFFIX.exec(raw);
      if (suffix !== null) {
        path = suffix[1];
        line = Number(suffix[2]);
      }
      path = path.replace(/[\\/]+$/, "");
      if (path === "" || path === "." || path === "..") return undefined;
      if (!isPathLike(path)) return undefined;
      return { path, line };
    }

    function install(service) {
      const original = service.forClosing;
      if (typeof original !== "function" || originals.has(service))
        return () => {};
      originals.set(service, original);
      service.forClosing = function forClosingWithPaths(owner, sessionId) {
        const base = original.call(this, owner, sessionId);
        return {
          resolve(value) {
            const hit = base === undefined ? undefined : base.resolve(value);
            if (hit !== undefined) return hit;
            const ref = parsePathRef(value);
            if (
              ref === undefined ||
              owner === undefined ||
              typeof owner.openFile !== "function"
            )
              return undefined;
            return {
              open: () => {
                owner.openFile(
                  ref.path,
                  ref.line === undefined ? undefined : { line: ref.line },
                );
              },
              label: ref.path,
              title: ref.path,
            };
          },
        };
      };
      return () => {
        if (originals.get(service) !== original) return;
        service.forClosing = original;
        originals.delete(service);
      };
    }

    function apply(ctx) {
      const service = ctx.get("chatFileMentions");
      ctx.effect(() => install(service));
    }

    return { inject, apply };
  },
});
