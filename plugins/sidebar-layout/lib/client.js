window.__ModuleLoader__.load({
  id: "@local/dsh-sidebar-layout",
  factory: () => {
    // The native footer has no container extension API. This single CSS adapter
    // is pinned to the verified rc.3 SidebarRoot structure; never move another
    // plugin's nodes, rewrite its controls, or read its state.
    // The slot outlet itself defaults to display:contents. Style that outlet,
    // not its outer shell, so direct entry selectors address real grid items.
    const footer = '.kB3qhq_root:not(.kB3qhq_collapsed) [data-slot="sidebar.footer.action"]';
    const css = `
      ${footer}{
        display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));
        box-sizing:border-box;width:100%;
        align-items:center;gap:6px 10px;padding:10px 8px 8px;
        border-top:1px solid var(--dsw-alias-border-l2,#d8dbe2);
      }
      ${footer}>*{min-width:0;max-width:100%;justify-self:stretch}
      /* The billing card is a wide control, not one icon-sized grid cell. */
      ${footer}>:has([data-testid="billing-trigger"]),
      ${footer}>[data-testid="billing-trigger"],
      ${footer}>[data-testid="billing-rail-button"]{grid-column:1/-1}
      /* Compact billing variants still get a readable, full-width entry. The
         caption comes from the plugin's own title; no pricing state is read. */
      ${footer}>[data-testid="billing-rail-button"]{
        justify-content:flex-start;gap:10px;min-height:44px;padding:8px 12px;
        background:var(--dsw-alias-bg-layer-1,#ffffffa8);
        border-color:var(--dsw-alias-border-l2,#d8dbe2);
      }
      ${footer}>[data-testid="billing-rail-button"]::after{content:attr(title);font-size:12px}
      ${footer}>button,${footer}>div>button:first-child{
        display:flex;align-items:center;justify-content:center;gap:6px;
        box-sizing:border-box;width:100%;min-height:34px;max-width:100%;
        padding:7px 8px;border:1px solid transparent;border-radius:9px;
        color:var(--dsw-alias-label-secondary,#545b69);background:transparent;
        font:500 12px/1.25 system-ui;white-space:nowrap;word-break:normal;
        transition:background-color .14s ease,border-color .14s ease;
      }
      ${footer}>button:hover,${footer}>div>button:first-child:hover{
        color:var(--dsw-alias-label-primary,#20242c);
        background:var(--dsw-alias-bg-layer-1,#ffffffa8);
        border-color:var(--dsw-alias-border-l2,#d8dbe2);
      }
      ${footer}>button:focus-visible,${footer}>div>button:first-child:focus-visible{
        outline:2px solid var(--dsw-alias-brand-primary,#6754e8);outline-offset:2px;
      }
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]{
        display:flex!important;flex-direction:column;align-items:center;gap:4px;width:100%;
      }
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]>*{min-width:0;max-width:100%}
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]>button,
      .kB3qhq_collapsed [data-slot="sidebar.footer.action"]>div>button:first-child{
        box-sizing:border-box;width:100%;max-width:100%;min-height:30px;
        padding:6px 0;font-size:10px;line-height:1.3;white-space:nowrap;
      }
      @media(prefers-reduced-motion:reduce){${footer} button{transition:none}}
    `;
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.dshSidebarLayout = "rc3";
        style.textContent = css;
        document.head.append(style);
        return () => style.remove();
      });
    }
    return { apply };
  },
});
