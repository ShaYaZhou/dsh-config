window.__ModuleLoader__.load({
  id: '@local/dsh-idle-settings',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const {Switch} = require('@deepseek-ai/dsh-client-ui-primitives');
    const inject = ['slots', 'configForms'];
    function apply(ctx) {
      const form = ctx.configForms.get('idle-compaction');
      function Settings() {
        const snapshot = React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot());
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        const alive = React.useRef(true);
        React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
        const change = async enabled => {
          setBusy(true); setError('');
          try {
            const accepted = await form.set('enabled', enabled);
            if (alive.current && !accepted) setError('保存未成功，请重试。');
          } catch (failure) {
            if (alive.current) setError(failure.message || '保存失败。');
          } finally { if (alive.current) setBusy(false); }
        };
        return h('section', {style:{maxWidth:560,padding:24}},
          h('h2', null, '上下文压缩'),
          h('p', null, '默认在会话空闲约 54 分钟、上下文达到 20 万 token 时生成摘要。'),
          h('div', {style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,margin:'20px 0'}},
            h('span', null, '空闲时压缩长会话'),
            h(Switch, {label:'空闲时压缩长会话',checked:snapshot.value?.enabled === true,disabled:busy || snapshot.status !== 'ready' || !snapshot.writable,onChange:change})),
          h('p', {style:{fontSize:13,opacity:0.75,lineHeight:1.7}}, '摘要会调用该会话的模型，原始记录保留。运行中、待答、排队、已停止或归档的会话不会自动开始压缩。代理的缓存期限可能不同，开启此功能不保证节省费用。'),
          snapshot.status === 'unavailable' && h('p', {role:'status'}, '当前部署未提供空闲压缩。'),
          error && h('p', {role:'alert'}, error));
      }
      ctx.slots.inject('settings.section', () => {
        ctx.effect(() => ctx.configForms.whileServed(['idle-compaction'], () =>
          ctx.slots.register({name:'settings.section',id:'idle-compaction',order:25,label:'上下文压缩'}, Settings)));
      });
    }
    return {inject, apply};
  }
});
