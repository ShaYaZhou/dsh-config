// render_widget 的会话内卡片：模型产出的 HTML 片段放进沙箱 iframe。
// sandbox 不给 allow-same-origin，所以片段拿不到父文档；CSP 再禁掉全部网络。
window.__ModuleLoader__.load({
  id: '@local/dsh-dynamic-ui-view',
  factory: (require) => {
    const React = require('react'),
      h = React.createElement;
    const inject = ['slots', 'uiConversation'];
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
.dyn-widget-title{margin:0 0 6px;font-size:12px;opacity:.72}
.dyn-widget-frame{display:block;width:100%;border:1px solid #8883;border-radius:12px;background:transparent}
.dyn-widget-note{margin:0;padding:10px 12px;border:1px dashed #8885;border-radius:12px;font-size:12px;opacity:.72}
.dyn-widget-error{margin:0;padding:10px 12px;border:1px solid #e8463a55;border-radius:12px;font-size:12px;color:#e8463a;white-space:pre-wrap}
`;

    // Project the existing durable calls into native turn-level rows. No DOM
    // reparenting or extra session records; ordinary and PTC history both work.
    const widgetDefinition = {
      kind: 'dynamic-ui-widget', target: 'chat',
      match(event) {
        const data=event.data;
        if(event.type==='tool/call'&&data.name==='render_widget')return {id:String(data.callId),role:'start'};
        if(event.type==='tool/ptc-dispatch'&&data.name==='render_widget')return {id:String(data.subCallId),role:'start'};
        if(event.type==='tool/result'&&data.message?.source?.callId)return {id:String(data.message.source.callId),role:'update'};
        return null;
      },
      start(_context,match) {
        const event=match.event,data=event.data;
        let args;
        try { args=typeof data.arguments==='string'?JSON.parse(data.arguments):data.arguments; } catch { return null; }
        if(!args||typeof args.html!=='string'||args.html.length>200000)return null;
        return {args,seq:event.seq,ready:event.type==='tool/ptc-dispatch',error:data.isError===true};
      },
      update(context,match) {
        if(!context.state)return null;
        return match.event.type==='tool/result'?{...context.state,ready:true,error:match.event.data.message.isError===true,seq:match.event.seq}:context.state;
      },
      buildViewNode(context) {
        const state=context.state;
        if(!state?.ready||state.error)return null;
        return {key:context.key,id:context.id,kind:'dynamic-ui-widget',target:'chat',anchorSeq:state.seq,
          location:context.start?.location??context.matches[0]?.location??{kind:'unresolved'},
          visibility:'visible',groupTree:'turn',data:state.args};
      },
    };
    function WidgetFrame({node}) {
      const {html,title,height}=node.data;
      const srcDoc=React.useMemo(()=>documentFor(html),[html]);
      const frameRef=React.useRef(null);
      const [reportedHeight,setReportedHeight]=React.useState(null);
      React.useEffect(()=>setReportedHeight(null),[html]);
      React.useEffect(()=>{
        const frame=frameRef.current;
        if(!frame)return undefined;
        const onMessage=event=>{
          if(event.source===frame.contentWindow&&event.data?.type==='dsh-widget-height')setReportedHeight(clampReportedHeight(event.data.height));
        };
        const measure=()=>requestMeasure(frame);
        window.addEventListener('message',onMessage);
        window.addEventListener('resize',measure);
        return ()=>{window.removeEventListener('message',onMessage);window.removeEventListener('resize',measure);};
      },[html]);
      return h('div',{className:'dyn-widget'},h('style',null,STYLE),
        h('p',{className:'dyn-widget-title'},title||'可视化'),
        h('iframe',{className:'dyn-widget-frame',ref:frameRef,title:title||'可视化',srcDoc,
          sandbox:'allow-scripts allow-forms',referrerPolicy:'no-referrer',
          onLoad:()=>requestMeasure(frameRef.current),style:{height:`${reportedHeight??clampHeight(height)}px`}}));
    }
    function ToolNote({phase,block}) {
      return h('p',{className:block?.isError?'dyn-widget-error':'dyn-widget-note'},block?.isError?resultText(block):phase==='preparing'?'正在准备可视化…':'可视化显示在会话正文中。');
    }
    function apply(ctx) {
      ctx.effect(()=>ctx.uiConversation.events.register(widgetDefinition));
      ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'dynamic-ui-widget'},WidgetFrame));
      ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'render_widget'},ToolNote));
    }
    return { inject, apply };
  },
});
