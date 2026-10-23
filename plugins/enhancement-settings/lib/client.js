window.__ModuleLoader__.load({
  id: '@local/dsh-enhancement-settings',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const {Switch} = require('@deepseek-ai/dsh-client-ui-primitives');
    const inject = ['slots', 'configForms'];
    const PANEL = 'settings.enhancement.panel';
    const FEATURES = [
      ['team', '团队协作', 'Team 成员、共享任务与 spawn/send/wait 工具。'],
      ['worktree', 'Git worktree', 'create_worktree 工具。'],
      ['browser', '浏览器与桌面指引', '浏览器和 computer-use 的系统提示与 computer-use 技能。'],
      ['sessionBus', '会话总线', '跨会话 message_session 工具与 /session-bus 授权。'],
      ['claudeContext', 'Claude 上下文', '注入 ~/.claude 与项目 .claude 指令、规则。'],
      ['usageReport', '用量报告', 'usage_report 用量查询工具。'],
    ];
    function Row({label, description, checked, disabled, onChange}) {
      return h('div', {style:{display:'flex',gap:16,alignItems:'flex-start',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid #8883'}},
        h('div', {style:{minWidth:0}},
          h('div', {style:{fontWeight:600}}, label),
          h('div', {style:{fontSize:13,opacity:0.72,lineHeight:1.6}}, description)),
        h(Switch, {label, checked, disabled, onChange}));
    }
    function apply(ctx) {
      const form = ctx.configForms.get('enhancement-settings');
      let tabsVersion = -1;
      let tabs = [];
      const sectionInjected = () => ({
        hooks: {
          tabs: {
            getSnapshot: () => {
              const version = ctx.slots.getVersion(PANEL);
              if (version !== tabsVersion) {
                tabsVersion = version;
                tabs = ctx.slots.entries(PANEL)
                  .map(entry => ({
                    id: entry.options.id ?? '',
                    order: entry.options.order ?? 0,
                    label: typeof entry.options.label === 'string' ? entry.options.label : '',
                  }))
                  .sort((a, b) => a.order - b.order);
              }
              return tabs;
            },
            subscribe: listener => ctx.slots.subscribe(PANEL, listener),
          },
        },
      });
      function Section({close, renderSlot, useTabs}) {
        const snap = React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot());
        const rows = useTabs(value => value);
        const [activeId, setActiveId] = React.useState();
        const [visited, setVisited] = React.useState(() => new Set());
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState('');
        const alive = React.useRef(true);
        React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
        const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id;
        React.useEffect(() => {
          if (active === undefined) return;
          setVisited(previous => previous.has(active) ? previous : new Set([...previous, active]));
        }, [active]);
        const disabled = snap.status !== 'ready' || !snap.writable || busy;
        const value = key => snap.value?.[key] ?? snap.base?.[key] ?? key !== 'ultracodeDefault';
        const change = async (key, next) => {
          setBusy(true); setError('');
          try {
            const accepted = await form.set(key, next);
            if (alive.current && !accepted) setError('保存未成功，请重试。');
          } catch (failure) {
            if (alive.current) setError(failure.message || '保存失败。');
          } finally { if (alive.current) setBusy(false); }
        };
        return h('section', {style:{maxWidth:680,padding:24,lineHeight:1.7}},
          h('h2', {style:{margin:'0 0 6px'}}, 'Harness增强'),
          h('p', {style:{fontSize:13,opacity:0.72,margin:'0 0 14px'}}, '集中管理本地插件的功能开关与设置页。'),
          h('h3', {style:{fontSize:16,margin:'18px 0 4px'}}, '功能开关'),
          ...FEATURES.map(([key, label, description]) =>
            h(Row, {key, label, description, checked:value(key) === true, disabled, onChange:next => change(key, next)})),
          h(Row, {
            label:'新会话默认开启 ultracode',
            description:'没有显式 /ultracode 记录的会话跟随此默认值；会话内可用 /ultracode on|off 覆盖。',
            checked:value('ultracodeDefault') === true,
            disabled,
            onChange:next => change('ultracodeDefault', next),
          }),
          h('p', {style:{fontSize:13,opacity:0.72}}, '工具类开关在新会话或重启后生效；系统提示类开关立即生效。'),
          snap.status === 'unavailable' && h('p', {role:'status'}, '当前部署未提供Harness增强设置。'),
          error && h('p', {role:'alert'}, error),
          h('h3', {style:{fontSize:16,margin:'22px 0 8px'}}, '设置页'),
          rows.length === 0
            ? h('p', {style:{fontSize:13,opacity:0.72}}, '当前没有可用的Harness增强页面。')
            : h('div', null,
              h('div', {role:'tablist', 'aria-label':'Harness增强设置页', style:{display:'flex',gap:6,flexWrap:'wrap',borderBottom:'1px solid #8883',marginBottom:12}},
                ...rows.map(row => h('button', {
                  key:row.id,
                  type:'button',
                  role:'tab',
                  'aria-selected':row.id === active,
                  tabIndex:row.id === active ? 0 : -1,
                  onClick:() => setActiveId(row.id),
                  style:{
                    font:'inherit',fontSize:13,padding:'7px 11px',border:'1px solid transparent',
                    borderBottomColor:row.id === active ? '#326ce5' : 'transparent',
                    background:'transparent',color:'inherit',cursor:'pointer',
                    fontWeight:row.id === active ? 600 : 400,
                  },
                }, row.label))),
              ...rows.filter(row => row.id === active || visited.has(row.id)).map(row =>
                h('div', {key:row.id, role:'tabpanel', hidden:row.id !== active},
                  renderSlot(PANEL, {close}, {only:row.id})))));
      }
      ctx.slots.inject('settings.section', () => {
        ctx.effect(() => ctx.configForms.whileServed(['enhancement-settings'], () =>
          ctx.slots.register({
            name:'settings.section',
            id:'enhancement-settings',
            order:25,
            label:'Harness增强',
            inject:sectionInjected,
            children:{[PANEL]:{kind:'list',scope:'root'}},
          }, Section)));
      });
    }
    return {inject, apply};
  },
});
