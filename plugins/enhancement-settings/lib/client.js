window.__ModuleLoader__.load({
  id: '@local/dsh-enhancement-settings',
  factory: require => {
    const React = require('react'), h = React.createElement;
    const {Switch} = require('@deepseek-ai/dsh-client-ui-primitives');
    const inject = ['slots', 'configForms', 'remote', 'remote.pluginManager'];
    const PANEL = 'settings.enhancement.panel';
    const OVERVIEW = 'enhancement';
    const ULTRACODE = 'ultracode';
    const CATALOG = 'capabilities';
    const CAPABILITIES = [
      ['内联动态卡片','@local/dsh-dynamic-ui-view','在会话输入 /dynamic-ui，或要求绘制紧凑交互卡片。'],
      ['插件市场','dshmarket','侧栏“插件市场”或设置中的同名入口。'],
      ['回退与文件还原','dsh-rewind-plugin','会话顶部 Rewind；/rewind 可预览回退目标。'],
      ['内置浏览器截图与批注','@local/dsh-browser-review','右侧内置浏览器工具栏的“截图”“批注”。'],
      ['普通路径预览','@local/dsh-file-links','点击助手回复中的文件路径，在侧栏打开预览。'],
      ['桌面快捷命令','@local/dsh-desktop-commands','输入 /agents、/resume、/fork、/clear 或 /help。'],
      ['会话删除','@local/dsh-delete-session','会话菜单中的删除入口；先停止归档，再移入可恢复目录。'],
      ['旁问（BTW）','@michengai/dsh-btw','完整增强中的 /btw 及旁问快捷键。'],
      ['扩展文件侧栏','dsh-better-sidebar','完整增强中的文件树、编辑器、变更和侧聊面板。'],
      ['代码审查','@michengai/dsh-code-review','完整增强中的代码审查入口；普通原生子代理仍可按任务审查。'],
      ['技能管理','@michengai/dsh-skills-manager','完整增强中的技能浏览与管理；原生技能发现和 skill 工具始终可用。'],
      ['架构图技能','@tt-a1i/archify-dsh','完整增强中的 Archify；日常紧凑图解仍可使用 dynamic-ui。'],
      ['自动记忆','@dsh-external/dsh-memory','完整增强中的记忆工具与设置；旧记忆文件保留。'],
      ['本地环境','@local/dsh-local-environments','完整增强的“本地环境”设置页。'],
      ['后续建议','@local/dsh-follow-ups','完整增强的“后续建议”设置页与确认卡片。'],
      ['上下文维护设置','@local/dsh-idle-settings','完整增强的压缩阈值与空闲维护设置；日常仍保留原生上下文压缩。'],
      ['Team 管理视图','@local/dsh-team-view','完整增强中的 Team 成员与计划面板；与团队执行开关分别管理。'],
      ['工作区子代理管理','dsh-subagent-workspace-ui','完整增强的工作区子代理管理；日常嵌套会话与原生子代理入口保留。'],
      ['原生桌面控制驱动','@deepseek-ai/dsh-experimental-computer-use-cua-driver-native','完整增强中的桌面控制；浏览器与桌面“指引”开关不安装驱动。'],
    ];
    // 每个功能对应 profile 里真实的插件条目：开关走原生 pluginManager，
    // 关闭后该条目不再加载，模块内部的运行时判断随之消失。
    const FEATURES = [
      ['团队协作', 'Team 成员、共享任务与 spawn/send/wait 工具。', ['agent-team-local', 'tool-agent-team-local']],
      ['Git worktree', 'create_worktree 工具。', ['tool-worktree']],
      ['浏览器与桌面指引', '浏览器和 computer-use 的系统提示与 computer-use 技能。', ['browser-guidance']],
      ['会话总线', '跨会话 message_session 工具与 /session-bus 授权。', ['session-bus']],
      ['Claude 上下文', '注入 ~/.claude 与项目 .claude 指令、规则。', ['claude-context']],
      ['用量报告', 'usage_report 用量查询工具。', ['usage-report']],
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
        const pages = useTabs(value => value);
        // 「Harness增强」是第一个页签，「Ultracode」是内建的第二个页签，其余是各插件的分页。
        const rows = [
          {id:OVERVIEW, order:-1, label:'Harness增强'},
          {id:ULTRACODE, order:0, label:'Ultracode'},
          {id:CATALOG, order:1, label:'功能清单'},
          ...pages.filter(row => ![OVERVIEW,ULTRACODE,CATALOG].includes(row.id)),
        ];
        const [activeId, setActiveId] = React.useState();
        const [visited, setVisited] = React.useState(() => new Set([OVERVIEW]));
        const [plugins, setPlugins] = React.useState();
        const [bundles, setBundles] = React.useState();
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState('');
        const alive = React.useRef(true);
        React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
        const active = rows.find(row => row.id === activeId)?.id ?? OVERVIEW;
        React.useEffect(() => {
          if (active === undefined) return;
          setVisited(previous => previous.has(active) ? previous : new Set([...previous, active]));
        }, [active]);
        const load = async () => {
          try {
            const [listed,catalogue]=await Promise.allSettled([
              ctx.remote.pluginManager.listPlugins(),ctx.remote.pluginManager.listBundles()]);
            if(listed.status!=='fulfilled')throw listed.reason;
            const answer = listed.value;
            if (!answer?.ok) throw new Error(answer?.error?.message || '读取插件状态失败。');
            if (alive.current) {
              setPlugins(new Map(answer.value.map(row => [row.entryId, row])));
              setBundles(catalogue.status==='fulfilled'&&catalogue.value?.ok
                ?new Map(catalogue.value.value.map(row=>[row.name,row])):null);
            }
          } catch (failure) {
            if (alive.current) setError(failure.message || '读取插件状态失败。');
          }
        };
        React.useEffect(() => { void load(); }, []);
        const change = async (write, retry) => {
          setBusy(true); setError('');
          try {
            const accepted = await write();
            if (alive.current && !accepted) setError(retry);
          } catch (failure) {
            if (alive.current) setError(failure.message || '保存失败。');
          } finally { if (alive.current) setBusy(false); }
        };
        // 加载器条目的 entryId 带层前缀（实际是 `include:<patch id>`），而 FEATURES 写的是 patch id。
        const find = id => plugins && [...plugins.values()].find(row => row.entryId === id || row.entryId.endsWith(`:${id}`));
        const changePlugins = (ids, next) => change(async () => {
          if(next&&ids.includes('agent-team-local')&&['agent-team','tool-agent-team'].some(id=>find(id)?.enabled))
            throw new Error('原生“智能体团队”已开启，请先在插件页关闭它，再开启本地团队协作。两套实现不能同时启用。');
          for (const id of ids) {
            const row = find(id);
            if (!row) throw new Error('插件条目未就绪，请重试。');
            const result = await ctx.remote.pluginManager.setPluginEnabled(row.entryId, next);
            if (!result?.ok) throw new Error(result?.error?.message || '保存失败。');
          }
          await load();
          return true;
        }, '保存未成功，请重试。');
        const stateOf = ids => {
          const rows = ids.map(find);
          return {
            checked: plugins !== undefined && rows.every(row => row?.enabled === true),
            // 条目缺失、被原生标记只读或状态未就绪时不允许切换。
            disabled: plugins === undefined || busy || rows.some(row => row === undefined || row.readOnlyReason !== undefined),
          };
        };
        const setting = key => (snap.value?.[key] ?? snap.base?.[key]) === true;
        const ultracode = setting('ultracodeDefault');
        const coordinatorLock = setting('ultracodeCoordinatorLock');
        const linkedWorkers = setting('ultracodeLinkedWorkerDefault');
        const policyLoaded = Boolean(find('ultracode'));
        const settingDisabled = snap.status !== 'ready' || !snap.writable || busy || !policyLoaded;
        const setSetting = key => next =>
          void change(() => form.set(key, next), '保存未成功，请重试。');
        const overview = h('div', {role:'tabpanel', hidden:active !== OVERVIEW},
          h('p', {style:{fontSize:13,opacity:0.72,margin:'0 0 14px'}}, '管理入口始终保留；开关仅控制当前配置中已有的功能。未加载的功能保持关闭，不会因打开此页而启用。'),
          ...FEATURES.map(([label, description, ids]) =>
            h(Row, {key:label, label, description: description + (plugins && ids.some(id => !find(id)) ? '（当前配置未加载；完整增强配置提供。）' : '')
              + (ids.includes('agent-team-local')&&['agent-team','tool-agent-team'].some(id=>find(id)?.enabled)?'（原生智能体团队已启用，请不要同时启用本地团队协作。）':''), ...stateOf(ids), onChange:next => void changePlugins(ids, next)})),
          h('p', {style:{fontSize:13,opacity:0.72}}, '需要未加载的本地能力时，使用完整增强配置：dsh --profile enhanced。已有功能的开关会触发重载；系统提示改动对新会话生效。'),
          error && h('p', {role:'alert'}, error));
        const ultracodePanel = h('div', {role:'tabpanel', hidden:active !== ULTRACODE},
          !policyLoaded && h('p', {role:'status'}, '当前为精简配置，未加载 Ultracode 执行策略，以下开关不可用。需要完整增强时使用 dsh --profile enhanced。'),
          h('p', {style:{fontSize:13,opacity:0.72,margin:'0 0 14px'}}, '这里的开关只影响 Ultracode 编排，默认全部关闭；会话内仍可用 /ultracode on|off 单独覆盖第一条。当前模式没有 workflow 工具（如 minimal）时，这些开关不生效。'),
          h(Row, {
            label:'强制工作流编排',
            description:'实质性任务必须进入 Workflow；关闭后按普通标准模式处理，简单问答不受影响。',
            checked:policyLoaded && ultracode,
            disabled:settingDisabled,
            onChange:setSetting('ultracodeDefault'),
          }),
          h(Row, {
            label:'协调者只读与工具白名单',
            description:'Ultracode 开启时，主会话只能读取、准备 worktree、控制工作流；写入与浏览器交给执行者。关闭后主会话仍可自己改文件。',
            checked:policyLoaded && coordinatorLock,
            disabled:settingDisabled || !ultracode,
            onChange:setSetting('ultracodeCoordinatorLock'),
          }),
          h(Row, {
            label:'默认使用关联执行者',
            description:'Workflow 子执行者默认创建可追问的关联会话，而不是临时子代理；每个关联会话有自己的上下文与模型，开销更高。',
            checked:policyLoaded && linkedWorkers,
            disabled:settingDisabled || !ultracode,
            onChange:setSetting('ultracodeLinkedWorkerDefault'),
          }),
          h('p', {style:{fontSize:13,opacity:0.72}}, '执行边界（浏览器不能运行服务端代码、evaluate 必须有界等待、沙箱准入后不可漂移）不属于开关，始终生效。'),
          error && h('p', {role:'alert'}, error));
        const catalogue=h('div',{role:'tabpanel',hidden:active!==CATALOG},
          h('p',{},'这里区分当前已加载、已停用和完整增强提供的能力；查看清单不会启动或安装任何能力。'),
          ...CAPABILITIES.map(([label,moduleName,entry])=>{
            const row=plugins&&[...plugins.values()].find(p=>p.moduleName===moduleName);
            const bundle=bundles?.get(moduleName);
            const status=!plugins?'读取中':row?(!row.enabled?'已停用':row.fiberPhase==='active'?'已加载':'等待依赖或加载异常')
              :bundles===null?'包状态读取失败':bundle?.error?'加载异常':bundle?.enabled?'已启用':bundle?.installed?'已安装，未启用':'完整增强提供';
            return h('div',{key:moduleName,style:{padding:'10px 0',borderBottom:'1px solid #8883'}},
              h('div',{style:{fontWeight:600}},label+' · '+status),
              h('div',{style:{fontSize:13,opacity:0.72}},entry));
          }),
          h('p',{},'完整增强入口：dsh --profile enhanced。不要在两个入口同时执行同一会话。Ponytail、think、OpenSpec 等整套受管技能也在完整增强中提供。'));
        return h('section', {style:{maxWidth:680,padding:24,lineHeight:1.7}},
          h('h2', {style:{margin:'0 0 6px'}}, 'Harness增强'),
          h('p', {style:{fontSize:13,opacity:0.72,margin:'0 0 14px'}}, '集中管理本地插件的功能开关与设置页。'),
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
            row.id === OVERVIEW
              ? h('div', {key:OVERVIEW}, overview)
              : row.id === ULTRACODE
                ? h('div', {key:ULTRACODE}, ultracodePanel)
                : row.id === CATALOG
                  ? h('div',{key:CATALOG},catalogue)
                : h('div', {key:row.id, role:'tabpanel', hidden:row.id !== active},
                    renderSlot(PANEL, {close}, {only:row.id}))));
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
