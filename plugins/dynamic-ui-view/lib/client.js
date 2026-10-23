// render_widget 的会话内卡片：模型产出的 HTML 片段放进沙箱 iframe。
// sandbox 不给 allow-same-origin，所以片段拿不到父文档；CSP 再禁掉全部网络。
window.__ModuleLoader__.load({
  id: '@local/dsh-dynamic-ui-view',
  factory: (require) => {
    const React = require('react'),
      { createPortal } = require('react-dom'),
      h = React.createElement;
    const inject = ['slots'];
    const MIN_HEIGHT = 200,
      MAX_HEIGHT = 900,
      DEFAULT_HEIGHT = 420,
      AUTO_MAX_HEIGHT = 2400;
    const POLICY =
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
    const SHELL =
      '<!doctype html><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<meta http-equiv="Content-Security-Policy" content="${POLICY}">` +
      '<style>' +
      ':root{color-scheme:light dark}' +
      // 留出固定滚动条槽：内容一变高就冒出滚动条会挤掉宽度、让文字再换行，高度来回抖。
      'html{background:#fff;color:#1b1b1b;scrollbar-gutter:stable}' +
      'body{margin:0;padding:12px;font:13px/1.55 ui-sans-serif,system-ui,sans-serif}' +
      '@media (prefers-color-scheme:dark){html{background:#1b1b1b;color:#ececec}}' +
      '</style>';
    // 片段在无同源沙箱里，父文档读不到它的高度，只能由片段侧量好再 postMessage 报上来。
    // 只量 body.scrollHeight：documentElement.scrollHeight 在内容比帧矮时会等于视口高，
    // 高度就会被锁在初始值上再也缩不回去。结构固定 DSH 0.2.1-rc.2，升级需重验。
    const REPORT =
      '<script>(function(){' +
      'var last=0;' +
      'function report(){' +
      'var b=document.body;' +
      'var h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height));' +
      'if(h===last)return;' +
      'last=h;' +
      'parent.postMessage({type:"dsh-widget-height",height:h},"*")}' +
      'if(window.ResizeObserver)new ResizeObserver(report).observe(document.body);' +
      'addEventListener("load",report);' +
      'report();' +
      // 首帧可能量在样式和字体落地之前，而此后高度未必再触发 ResizeObserver，补报几次。
      'setTimeout(report,300);setTimeout(report,1200);setTimeout(report,3000);' +
      // 折叠期间 content-visibility 会让量到的高度偏小；父端展开后主动来要一次新值。
      'addEventListener("message",function(e){' +
      'if(e.data&&e.data.type==="dsh-widget-measure"){last=0;report()}})' +
      '})()</script>';
    // 片段只做字符串拼接，不解析：解析发生在这个沙箱文档自己的渲染器里。
    function documentFor(html) {
      return SHELL + (typeof html === 'string' ? html : '') + REPORT;
    }
    function clampHeight(value) {
      const height = Number(value);
      return Number.isFinite(height)
        ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)))
        : DEFAULT_HEIGHT;
    }
    // 内容自报的高度：短内容保持最小可读高度，超长内容仍有上限，超出部分交给外层滚动。
    function clampReportedHeight(value) {
      const height = Number(value);
      return Number.isFinite(height)
        ? Math.min(AUTO_MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)))
        : DEFAULT_HEIGHT;
    }
    // 折叠状态下的高度不可信，展开或缩放后让帧内重新量一次再报上来。
    function requestMeasure(frame) {
      frame?.contentWindow?.postMessage({ type: 'dsh-widget-measure' }, '*');
    }
    // 宿主把完成的工具调用折进 hidden="until-found" 分组，卡片挂在里面必然跟着折叠。
    // 取最外层折叠祖先前面的位置，把卡片搬出去放在该分组之后：分组照常折叠，卡片独立显示。
    // 结构固定 DSH 0.2.1-rc.2，升级需重验。
    function outerHidden(node) {
      let outer = null;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (el.getAttribute('hidden') === 'until-found') outer = el;
      }
      return outer;
    }
    function resultText(block) {
      const parts = Array.isArray(block?.content) ? block.content : [];
      const text = parts
        .map((part) => (part && part.type === 'text' ? part.text : ''))
        .join('\n')
        .trim();
      return (
        text || block?.error?.reason || block?.error?.code || '可视化渲染失败'
      );
    }
    const STYLE = `
.dyn-widget{display:block;margin:6px 0}
.dyn-widget-host{display:block;margin:6px 0}
.dyn-widget-title{margin:0 0 6px;font-size:12px;opacity:.72}
.dyn-widget-frame{display:block;width:100%;border:1px solid #8883;border-radius:12px;background:transparent}
.dyn-widget-note{margin:0;padding:10px 12px;border:1px dashed #8885;border-radius:12px;font-size:12px;opacity:.72}
.dyn-widget-error{margin:0;padding:10px 12px;border:1px solid #e8463a55;border-radius:12px;font-size:12px;color:#e8463a;white-space:pre-wrap}
`;
    function WidgetView({ phase, block }) {
      const args = block?.args;
      const html = phase === 'preparing' ? undefined : args?.text('html');
      const title = phase === 'preparing' ? undefined : args?.text('title');
      const height = clampHeight(args?.value('height'));
      const srcDoc = React.useMemo(() => documentFor(html), [html]);
      const anchorRef = React.useRef(null);
      const frameRef = React.useRef(null);
      const [reportedHeight, setReportedHeight] = React.useState(null);
      const [host, setHost] = React.useState(null);
      // 换一份片段就等新文档重新上报，别拿上一条的高度垫着。
      React.useEffect(() => setReportedHeight(null), [html]);
      // 沙箱无同源，父文档不能直接读片段高度，只接受自己这帧上报的数字。
      // 依赖 html 与 host：preparing 阶段还没有 iframe；搬到折叠区外时 iframe 会重新挂载，
      // contentWindow 换了，不重建监听就会把新帧的上报全部当成外来消息丢掉。
      React.useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        const onMessage = (event) => {
          if (event.source !== frame.contentWindow) return;
          const message = event.data;
          if (!message || message.type !== 'dsh-widget-height') return;
          setReportedHeight(clampReportedHeight(message.height));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, [html, host]);
      // 回合结束时宿主才折叠，时间点不固定；每次发现折叠就把卡片搬到该分组之后。
      // 轮询同时覆盖「宿主重建节点导致容器脱落」的情况：容器不在原位就再插一次。
      // 依赖 html：preparing 阶段还没有锚点。
      React.useEffect(() => {
        const node = anchorRef.current;
        if (!node) return undefined;
        const doc = node.ownerDocument;
        let container = null;
        const tick = () => {
          const fold = outerHidden(node);
          if (!fold) {
            if (container) {
              container.remove();
              container = null;
              setHost(null);
            }
            return;
          }
          if (!container) {
            container = doc.createElement('div');
            container.className = 'dyn-widget-host';
            setHost(container);
          }
          if (container.previousSibling !== fold) fold.after(container);
        };
        tick();
        const timer = setInterval(tick, 250);
        const onResize = () => requestMeasure(frameRef.current);
        doc.defaultView?.addEventListener('resize', onResize);
        return () => {
          clearInterval(timer);
          doc.defaultView?.removeEventListener('resize', onResize);
          container?.remove();
        };
      }, [html]);
      if (phase === 'result' && block.isError === true)
        return h(
          'p',
          { className: 'dyn-widget-error', role: 'alert' },
          resultText(block),
        );
      if (typeof html !== 'string' || html === '')
        return h(
          'p',
          { className: 'dyn-widget-note' },
          phase === 'preparing'
            ? '正在准备可视化…'
            : '无法读取可视化参数（调用已离开加载窗口）',
        );
      const card = h(
        'div',
        { className: 'dyn-widget' },
        h('style', null, STYLE),
        title ? h('p', { className: 'dyn-widget-title' }, title) : null,
        h('iframe', {
          className: 'dyn-widget-frame',
          ref: frameRef,
          title: title || '可视化',
          srcDoc,
          sandbox: 'allow-scripts allow-forms',
          referrerPolicy: 'no-referrer',
          onLoad: () => requestMeasure(frameRef.current),
          style: { height: `${reportedHeight ?? height}px` },
        }),
      );
      return h(
        React.Fragment,
        null,
        h('div', { ref: anchorRef, style: { display: 'none' } }),
        host ? createPortal(card, host) : card,
      );
    }
    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          { name: 'tool.call.toolview', key: 'render_widget' },
          WidgetView,
        ),
      );
    }
    return { inject, apply };
  },
});
