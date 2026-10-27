window.__ModuleLoader__.load({
  id: "@local/dsh-sidebar-layout",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    // rc.3 has no footer container API. Keep structural CSS in this adapter;
    // controls use the public slot, without moving nodes or reading plugin state.
    const footer = '.kB3qhq_root:not(.kB3qhq_collapsed) [data-slot="sidebar.footer.action"]';
    const billing = ':is([data-testid="billing-trigger"],[data-testid="billing-rail-button"],:has([data-testid="billing-trigger"]))';
    const tools = `:not(dialog):not(.dsh-footer-heading):not(${billing})`;
    function Heading({ section, label }) {
      const key = `dsh-sidebar-layout:${section}:collapsed`;
      const [collapsed, setCollapsed] = React.useState(() => {
        try { return localStorage.getItem(key) === "true"; } catch { return false; }
      });
      return h("button", {
        type: "button", className: "dsh-footer-heading",
        "data-section": section, "data-collapsed": String(collapsed),
        "aria-expanded": !collapsed, "aria-label": `${collapsed ? "展开" : "收起"}${label}`,
        onClick: () => {
          const next = !collapsed;
          setCollapsed(next);
          try { localStorage.setItem(key, String(next)); } catch { /* In-memory toggle still works. */ }
        },
      }, h("span", null, label), h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true },
        h("path", { d: "m4 6 4 4 4-4", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })));
    }
    const css = `
      ${footer}{
        display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));
        box-sizing:border-box;width:100%;align-items:stretch;
        gap:6px;padding:8px 10px 10px;
        border-top:1px solid var(--dsw-alias-border-l2,#d8dbe2);
      }
      ${footer}>*:not(dialog){min-width:0;max-width:100%;justify-self:stretch;box-sizing:border-box}
      ${footer}>${tools}{
        order:1;display:flex;align-items:center;justify-content:center;
        min-height:36px;border-radius:8px;
        background:var(--dsw-alias-bg-layer-1,#ffffff70);
        border:1px solid var(--dsw-alias-border-l2,#d8dbe2);
      }
      ${footer}>${tools}:is(button),${footer}>${tools}>button{
        display:flex;align-items:center;justify-content:center;gap:6px;
        min-height:34px;margin:0;padding:6px 10px;box-sizing:border-box;
        color:var(--dsw-alias-label-secondary,#545b69);
        font:500 12px/1.3 system-ui;white-space:nowrap;word-break:normal;
        border-radius:7px;cursor:pointer;
      }
      ${footer}>${tools}>button{flex:1;border:0;background:transparent}
      ${footer}>${tools}:hover{background:var(--dsw-alias-bg-layer-1,#ffffffb0)}
      ${footer}>${billing}{order:3;grid-column:1/-1;width:100%;margin:0}
      ${footer}>.dsh-footer-heading{
        grid-column:1/-1;order:0;display:flex;align-items:center;justify-content:space-between;
        width:100%;height:28px;padding:0 3px;margin:0;border:0;border-radius:5px;
        font:500 11px/1 system-ui;letter-spacing:.04em;
        color:var(--dsw-alias-label-secondary,#666e7b);background:transparent;cursor:pointer;
      }
      ${footer}>.dsh-footer-heading[data-section="billing"]{order:2;margin-top:4px}
      ${footer}>.dsh-footer-heading:hover{color:var(--dsw-alias-label-primary,#20242c);background:#8881}
      ${footer}>.dsh-footer-heading[data-collapsed="true"] svg{transform:rotate(-90deg)}
      ${footer}:has(>.dsh-footer-heading[data-section="tools"][data-collapsed="true"])>${tools}{display:none!important}
      ${footer}:has(>.dsh-footer-heading[data-section="billing"][data-collapsed="true"])>${billing}{display:none!important}
      ${footer} button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6754e8);outline-offset:2px}
      .kB3qhq_collapsed .dsh-footer-heading{display:none}
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]{
        display:flex!important;flex-direction:column;align-items:center;gap:4px;width:100%;
      }
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]>*{min-width:0;max-width:100%}
    `;
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.dshSidebarLayout = "rc3";
        style.textContent = css;
        document.head.append(style);
        return () => style.remove();
      });
      for (const [section, label, order] of [["tools", "快捷工具", -100], ["billing", "今日用量", 100]]) {
        ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
          name: "sidebar.footer.action", id: `sidebar-layout-${section}`, order,
        }, () => h(Heading, { section, label })));
      }
    }
    return { inject: ["slots"], apply };
  },
});
