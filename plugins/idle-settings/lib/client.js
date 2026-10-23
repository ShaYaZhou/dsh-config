window.__ModuleLoader__.load({
  id: '@local/dsh-idle-settings',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const {Switch, Button} = require('@deepseek-ai/dsh-client-ui-primitives');
    const inject = ['slots', 'configForms'];
    const DEFAULT_THRESHOLD_PERCENT = 80;
    const MIN_THRESHOLD_PERCENT = 20;
    const MAX_THRESHOLD_PERCENT = 100;
    function apply(ctx) {
      const idleForm = ctx.configForms.get('idle-compaction');
      const thresholdForm = ctx.configForms.get('idle-settings');
      function Settings() {
        const idle = React.useSyncExternalStore(listener => idleForm.subscribe(listener), () => idleForm.getSnapshot());
        const threshold = React.useSyncExternalStore(listener => thresholdForm.subscribe(listener), () => thresholdForm.getSnapshot());
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        const alive = React.useRef(true);
        React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
        const shown = threshold.value?.thresholdPercent ?? threshold.base?.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
        const fallback = threshold.base?.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
        const overridden = threshold.user?.thresholdPercent !== undefined;
        const [draft, setDraft] = React.useState(String(shown));
        React.useEffect(() => { setDraft(String(shown)); }, [shown]);
        const persist = async (run, refusedText, failedText) => {
          setBusy(true); setError('');
          try {
            const accepted = await run();
            if (alive.current && !accepted) setError(refusedText);
          } catch (failure) {
            if (alive.current) setError(failure.message || failedText);
          } finally { if (alive.current) setBusy(false); }
        };
        const change = enabled =>
          persist(() => idleForm.set('enabled', enabled), '保存未成功，请重试。', '保存失败。');
        const commitPercent = async text => {
          const percent = Number(text.trim());
          if (!Number.isInteger(percent) || percent < MIN_THRESHOLD_PERCENT || percent > MAX_THRESHOLD_PERCENT) {
            setError(`请输入 ${MIN_THRESHOLD_PERCENT}–${MAX_THRESHOLD_PERCENT} 之间的整数百分比。`);
            setDraft(String(shown));
            return;
          }
          if (percent === shown) return;
          await persist(() => thresholdForm.set('thresholdPercent', percent), '保存未成功，请重试。', '保存失败。');
        };
        const resetPercent = () =>
          persist(() => thresholdForm.unset('thresholdPercent'), '还原未成功，请重试。', '还原失败。');
        const thresholdDisabled = busy || threshold.status !== 'ready' || !threshold.writable;
        return h('section', {style:{maxWidth:560,padding:24}},
          h('h2', null, '上下文压缩'),
          h('p', null, '默认在会话空闲约 54 分钟、上下文达到 20 万 token 时生成摘要。'),
          h('div', {style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,margin:'20px 0'}},
            h('span', null, '空闲时压缩长会话'),
            h(Switch, {label:'空闲时压缩长会话',checked:idle.value?.enabled === true,disabled:busy || idle.status !== 'ready' || !idle.writable,onChange:change})),
          h('div', {style:{margin:'20px 0'}},
            h('label', {htmlFor:'dsh-compaction-threshold', style:{display:'block',marginBottom:8}}, '自动压缩阈值'),
            h('div', {style:{display:'flex',alignItems:'center',gap:8}},
              h('input', {
                id:'dsh-compaction-threshold',
                type:'number', min:MIN_THRESHOLD_PERCENT, max:MAX_THRESHOLD_PERCENT, step:1,
                value:draft, disabled:thresholdDisabled,
                style:{width:88,padding:'4px 8px'},
                onChange:event => setDraft(event.target.value),
                onBlur:event => commitPercent(event.target.value),
                onKeyDown:event => { if (event.key === 'Enter') event.currentTarget.blur(); }
              }),
              h('span', null, '%'),
              h(Button, {variant:'outline', disabled:thresholdDisabled || !overridden, onClick:resetPercent}, '还原默认')),
            h('p', {style:{fontSize:13,opacity:0.75,lineHeight:1.7}},
              `上下文达到模型窗口的 ${shown}% 时自动压缩；默认 ${fallback}%，可设置 ${MIN_THRESHOLD_PERCENT}–${MAX_THRESHOLD_PERCENT}%。`)),
          h('p', {style:{fontSize:13,opacity:0.75,lineHeight:1.7}}, '摘要会调用该会话的模型，原始记录保留。运行中、待答、排队、已停止或归档的会话不会自动开始压缩。代理的缓存期限可能不同，开启此功能不保证节省费用。'),
          idle.status === 'unavailable' && h('p', {role:'status'}, '当前部署未提供空闲压缩。'),
          threshold.status === 'unavailable' && h('p', {role:'status'}, '当前部署未提供压缩阈值设置。'),
          error && h('p', {role:'alert'}, error));
      }
      ctx.slots.inject('settings.enhancement.panel', () => {
        ctx.effect(() => ctx.configForms.whileServed(['idle-compaction', 'idle-settings'], () =>
          ctx.slots.register({name:'settings.enhancement.panel',id:'idle-compaction',order:25,label:'上下文压缩'}, Settings)));
      });
    }
    return {inject, apply};
  }
});
