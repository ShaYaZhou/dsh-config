/**
 * dsh-today-todo — Client 半边：侧栏入口 + 独立「今日待办」面板。
 *
 * 数据全走 Host 注册的三个路由，本模块不落任何业务状态；
 * 唯一的本地状态是「当前在看哪一天」「展开编辑的是哪条」和一份共享快照缓存。
 *
 * 待办是时间轴：行上显示区间与「第 x/y 天」，逾期单独标红；
 * 展开后能改起止、写备注、贴图/传视频（附件落本地 media，有 Notion 页面时同步过去）。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-today-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'today-todo'
    const PANEL_ID = 'today-todo'
    const API = '/dsh-today-todo-api'
    const UPLOAD = '/dsh-today-todo-upload'
    const MEDIA = '/dsh-today-todo-media'

    let CTX = null

    // ── 文案 ────────────────────────────────────────────────────────────────
    const DICT_ZH = {
      panel: '今日待办',
      title: '今日待办',
      addPlaceholder: '加一条待办，回车确认（只记今天，之后可改成多天）',
      add: '添加',
      undoneSection: '未完成',
      doneSection: '已完成',
      nothing: '这一天没有待办 —— 清爽。',
      nothingDone: '这一天还没有完成的事。',
      today: '今天',
      refresh: '刷新',
      sync: '同步 Notion',
      prevDay: '前一天',
      nextDay: '后一天',
      overdue: '逾期',
      notion: 'Notion',
      notConfigured: 'Notion 未配置：当前只记在本地。把 notionToken 与 notionDatabaseId 写进 ~/.dsh/today-todo/config.json（或到「插件」页配置）即可双向联动。',
      openPlugins: '去配置',
      lastSync: '上次同步',
      neverSynced: '从未同步',
      move: '顺延一天',
      remove: '删除',
      loading: '读取中…',
      redo: '取消完成',
      syncWarn: 'Notion 回写失败',
      upcoming: '接下来',
      markDone: '标记为已完成',
      localOnly: '本地待办',
      expand: '展开备注与时间',
      collapse: '收起',
      start: '开始',
      end: '截止',
      note: '备注',
      notePlaceholder: '写点什么…可以直接 Ctrl/⌘+V 粘贴截图，或把文件拖进来',
      attach: '添加图片/视频/文件',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      uploadFailed: '附件上传失败',
      noMedia: '还没有附件',
      dayN: (i, n) => `第 ${i}/${n} 天`,
      spanDays: (n) => `${n} 天`,
      removeMedia: '移除附件',
      openInNotion: '在 Notion 打开',
      dropped: '松开即上传',
      tlCorner: '任务 / 日期',
      tlEmpty: '这个时间窗里没有待办',
      viewList: '列表',
      viewTimeline: '时间轴',
      notionTimeline: 'Notion 时间轴',
      settingsTitle: '今日待办',
      setTitle: '今日待办 · Notion 连接',
      setDesc: '填好下面两项，这个插件就能读写你自己的 Notion 数据库。令牌只存在本机（0600 权限），不会上传。',
      setToken: 'Notion 集成令牌',
      setTokenPh: '粘贴 ntn_… 或 secret_…',
      setTokenSaved: '已保存',
      setTokenHow: '在 Notion「设置 → 连接 → 开发集成」新建一个集成，复制它的 Internal Integration Token；然后在你的数据库页面右上角「…→ 连接」里把这个集成加进去。',
      setDb: '数据库 ID 或链接',
      setDbPh: '整条 Notion 链接粘进来也行',
      setDbHow: '数据库要有三个属性：名称（标题）、日期（date）、完成（checkbox）。链接里那段 32 位 id 会被自动认出来。',
      setSwitches: '同步行为',
      setCreate: '新增待办时自动在 Notion 建页',
      setCreateHow: '关掉后只在本地记，等你在 Notion 里自己建行。',
      setMedia: '把备注里的图片/视频同步到 Notion',
      setMediaHow: '打开后，备注里的附件会作为文件块上传到对应页面。',
      setSaveBtn: '保存',
      setTest: '测试连接',
      setTimelineBtn: '打开时间轴视图',
      setCreateTimeline: '在 Notion 建时间轴视图',
      setSaved: '已保存。',
      setOk: '连接正常。',
      setPath: '配置文件',
      setState: '当前状态',
      setConfigured: '已配置',
      setNotConfigured: '未配置',
      setTokenFromFile: '本地文件',
      setTokenFromPlugin: '插件配置',
      setTokenFromEnv: '环境变量',
      setTokenNone: '未设置',
      savedOk: '已保存',
      unsaved: '有改动未保存',
      ensureTimeline: '在 Notion 建时间轴视图',
      shiftBack: '向前一周',
      shiftFwd: '向后一周',
    }
    const DICT_EN = {
      panel: 'Today',
      title: 'Today',
      addPlaceholder: 'Add a todo, press Enter (today only — edit later for a range)',
      add: 'Add',
      undoneSection: 'Open',
      doneSection: 'Done',
      nothing: 'Nothing scheduled — clear day.',
      nothingDone: 'Nothing finished on this day.',
      today: 'Today',
      refresh: 'Refresh',
      sync: 'Sync Notion',
      prevDay: 'Previous day',
      nextDay: 'Next day',
      overdue: 'Overdue',
      notion: 'Notion',
      notConfigured: 'Notion is not configured — todos stay local. Put notionToken and notionDatabaseId in ~/.dsh/today-todo/config.json (or on the plugin settings page) for two-way sync.',
      openPlugins: 'Configure',
      lastSync: 'Last sync',
      neverSynced: 'never',
      move: 'Push one day',
      remove: 'Delete',
      loading: 'Loading…',
      redo: 'Mark as open',
      syncWarn: 'Notion write-back failed',
      upcoming: 'Upcoming',
      markDone: 'Mark as done',
      localOnly: 'Local todos',
      expand: 'Show note and dates',
      collapse: 'Collapse',
      start: 'Start',
      end: 'Due',
      note: 'Note',
      notePlaceholder: 'Write something… paste a screenshot with Ctrl/⌘+V, or drop files here',
      attach: 'Add image/video/file',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      uploadFailed: 'Attachment upload failed',
      noMedia: 'No attachments yet',
      dayN: (i, n) => `Day ${i}/${n}`,
      spanDays: (n) => `${n} days`,
      removeMedia: 'Remove attachment',
      openInNotion: 'Open in Notion',
      dropped: 'Drop to upload',
      tlCorner: 'Task / Date',
      tlEmpty: 'Nothing in this window',
      viewList: 'List',
      viewTimeline: 'Timeline',
      notionTimeline: 'Notion timeline',
      settingsTitle: 'Today Todo',
      setTitle: 'Today Todo · Notion connection',
      setDesc: 'Fill in the two fields below and this plugin can read and write your own Notion database. The token stays on this machine (file mode 0600).',
      setToken: 'Notion integration token',
      setTokenPh: 'paste ntn_… or secret_…',
      setTokenSaved: 'saved',
      setTokenHow: 'Create an integration under Notion → Settings → Connections → Develop integrations, copy its Internal Integration Token, then add that integration to your database via "… → Connections".',
      setDb: 'Database ID or URL',
      setDbPh: 'a full Notion URL works too',
      setDbHow: 'The database needs three properties: title, date, checkbox. The 32-character id is extracted from pasted URLs automatically.',
      setSwitches: 'Sync behaviour',
      setCreate: 'Create a Notion page when a todo is added',
      setCreateHow: 'Turn off to keep todos local until you add the row in Notion yourself.',
      setMedia: 'Upload images/videos in notes to Notion',
      setMediaHow: 'Attachments in a note are uploaded as file blocks to the matching page.',
      setSaveBtn: 'Save',
      setTest: 'Test connection',
      setTimelineBtn: 'Open timeline view',
      setCreateTimeline: 'Create a Notion timeline view',
      setSaved: 'Saved.',
      setOk: 'Connection is healthy.',
      setPath: 'Config file',
      setState: 'Status',
      setConfigured: 'Configured',
      setNotConfigured: 'Not configured',
      setTokenFromFile: 'local file',
      setTokenFromPlugin: 'plugin config',
      setTokenFromEnv: 'environment',
      setTokenNone: 'not set',
      savedOk: 'Saved',
      unsaved: 'Unsaved changes',
      ensureTimeline: 'Create a Notion timeline view',
      shiftBack: 'Back a week',
      shiftFwd: 'Forward a week',
    }
    function T(key, ...args) {
      let lang = 'zh'
      try {
        const snap = CTX && CTX.locale && CTX.locale.getLocale ? CTX.locale.getLocale() : null
        const id = typeof snap === 'string' ? snap : (snap && snap.active) || ''
        if (String(id).toLowerCase().startsWith('en')) lang = 'en'
      } catch { /* 取不到语言就按中文 */ }
      const d = lang === 'en' ? DICT_EN : DICT_ZH
      const v = d[key] != null ? d[key] : (DICT_ZH[key] != null ? DICT_ZH[key] : key)
      return typeof v === 'function' ? v(...args) : v
    }

    // ── 共享快照 ────────────────────────────────────────────────────────────
    const state = { data: null, timeline: null, loading: true, error: null, busy: false, loadedOnce: false, tick: 0 }
    const subscribers = new Set()
    function emit() {
      for (const fn of Array.from(subscribers)) {
        try { fn() } catch { /* 单个订阅者崩了不连坐 */ }
      }
    }
    function useStore() {
      const [, force] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => {
        subscribers.add(force)
        return () => { subscribers.delete(force) }
      }, [])
      return state
    }

    function shiftDay(day, delta) {
      const [y, m, d] = String(day || '').split('-').map(Number)
      if (!y) return day
      return new Date(Date.UTC(y, m - 1, d) + delta * 86400000).toISOString().slice(0, 10)
    }
    function dayDiff(a, b) {
      const [ay, am, ad] = String(a).split('-').map(Number)
      const [by, bm, bd] = String(b).split('-').map(Number)
      return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
    }

    async function load(day) {
      state.loading = true
      state.error = null
      emit()
      try {
        const query = day ? ('?date=' + encodeURIComponent(day)) : ''
        const res = await fetch(API + query, { headers: { accept: 'application/json' } })
        const json = await res.json()
        if (!json || !json.ok) throw new Error((json && json.error) || '读取失败')
        state.data = json
        state.loadedOnce = true
        state.tick += 1
      } catch (err) {
        state.error = String((err && err.message) || err)
      } finally {
        state.loading = false
        emit()
      }
    }

    async function loadRange(from, to) {
      try {
        const res = await fetch(API + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), {
          headers: { accept: 'application/json' },
        })
        const json = await res.json()
        if (!json || !json.ok) throw new Error((json && json.error) || '读取失败')
        state.timeline = json
      } catch (err) {
        state.error = String((err && err.message) || err)
      } finally {
        emit()
      }
    }

    async function post(op, payload) {
      state.busy = true
      state.error = null
      emit()
      try {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...(payload || {}) }),
        })
        const json = await res.json()
        if (!json) throw new Error('空响应')
        if (json.snapshot) state.data = json.snapshot
        // 任何写操作都让时间轴重新拉一窗：否则增删改之后甘特还是旧数据
        state.tick += 1
        if (!json.ok) throw new Error(json.error || '操作失败')
        return json.result
      } catch (err) {
        state.error = String((err && err.message) || err)
        throw err
      } finally {
        state.busy = false
        emit()
      }
    }

    async function uploadFiles(taskId, files) {
      const list = Array.from(files || []).filter(Boolean)
      if (!list.length) return
      state.error = null
      emit()
      try {
        for (const f of list) {
          const url = UPLOAD + '?task=' + encodeURIComponent(taskId) + '&name=' + encodeURIComponent(f.name || 'attachment')
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': f.type || 'application/octet-stream' },
            body: f,
          })
          const json = await res.json()
          if (!json || !json.ok) throw new Error((json && json.error) || T('uploadFailed'))
        }
        await load(state.data && state.data.date)
      } catch (err) {
        state.error = T('uploadFailed') + ': ' + String((err && err.message) || err)
        emit()
      }
    }

    const mediaUrl = (m) => MEDIA + '/' + encodeURIComponent(m.file)

    // ── 图标（侧栏入口） ────────────────────────────────────────────────────
    function PanelIcon(props) {
      const size = (props && props.size) || 18
      const s = useStore()
      const pending = s.data ? (s.data.counts.undone + s.data.counts.overdue) : 0
      return h('span', {
        style: { position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
      },
        h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          'aria-hidden': true, style: { display: 'block' },
        },
          h('rect', { x: 3.25, y: 3.25, width: 17.5, height: 17.5, rx: 4.5, stroke: 'currentColor', 'stroke-width': 1.6 }),
          h('path', { d: 'M8 12.4l2.6 2.6L16.4 9.2', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ),
        pending > 0
          ? h('span', {
            'aria-hidden': true,
            style: {
              position: 'absolute', top: -3, right: -4, minWidth: 8, height: 8, borderRadius: 999,
              background: '#EB5757',
              boxShadow: '0 0 0 2px var(--dsw-specific-sidebar-fill, #fff)',
            },
          })
          : null,
      )
    }

    const CSS = `
.dswtt-page{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
.dswtt-inner{max-width:820px;margin:0 auto;padding:28px 24px 72px;font-size:14px;line-height:1.55;}
.dswtt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.dswtt-h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.015em;color:var(--dsw-alias-label-primary);}
.dswtt-sub{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;}
.dswtt-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.dswtt-btn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;transition:background .12s,border-color .12s;}
.dswtt-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);}
.dswtt-btn:disabled{opacity:.45;cursor:not-allowed;}
.dswtt-btn.is-primary{background:#2383E2;border-color:transparent;color:#fff;font-weight:500;}
.dswtt-btn.is-primary:hover{background:#1b74c9;}
.dswtt-btn.is-primary:disabled{opacity:.5;background:#2383E2;}
.dswtt-icon-btn{width:30px;padding:0;justify-content:center;font-size:15px;}
.dswtt-add{display:flex;gap:8px;margin:22px 0 6px;}
.dswtt-input{flex:1;height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px;outline:none;}
.dswtt-input:focus{border-color:var(--dsw-alias-brand-primary);}
.dswtt-input::placeholder{color:var(--dsw-alias-label-secondary);}
.dswtt-sec{margin-top:20px;}
.dswtt-sec-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px;}
.dswtt-sec-toggle{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:5px;}
.dswtt-sec-arrow{display:inline-block;width:9px;font-size:9px;line-height:1;color:var(--dsw-alias-label-secondary);}
.dswtt-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}
.dswtt-item{border-top:1px solid var(--dsw-alias-border-l1);}
.dswtt-item:first-child{border-top:0;}
.dswtt-row{display:flex;align-items:center;gap:9px;height:44px;padding:0 11px;}
.dswtt-row:hover{background:var(--dsw-alias-bg-layer-2);}
.dswtt-item.is-open .dswtt-row{background:var(--dsw-alias-bg-layer-2);}
.dswtt-check{flex:none;width:17px;height:17px;border-radius:4px;border:1.5px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:background .12s,border-color .12s;}
.dswtt-check:hover{border-color:#448361;}
.dswtt-check.is-done{background:#448361;border-color:#448361;}
.dswtt-check.is-done:hover{background:#3b7052;border-color:#3b7052;}
.dswtt-body{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;cursor:pointer;}
.dswtt-text{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--dsw-alias-label-primary);}
.dswtt-row.is-done .dswtt-text{color:var(--dsw-alias-label-secondary);text-decoration:line-through;}
.dswtt-meta{flex:none;margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);}
.dswtt-tag{display:inline-flex;align-items:center;gap:3px;padding:0 6px;border-radius:3px;background:transparent;border:1px solid var(--dsw-alias-border-l1);white-space:nowrap;line-height:18px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dswtt-tag.is-range{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));color:var(--dsw-alias-brand-primary);}
.dswtt-tag.is-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);}
.dswtt-tag.is-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);}
.dswtt-row-actions{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s;}
.dswtt-row:hover .dswtt-row-actions,.dswtt-item.is-open .dswtt-row-actions,.dswtt-row:focus-within .dswtt-row-actions{opacity:1;}
.dswtt-mini{width:26px;height:26px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}
.dswtt-mini:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);}
.dswtt-mini.is-danger:hover{color:var(--dsw-alias-state-error-primary);}
.dswtt-empty{padding:13px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;}
.dswtt-notice{margin-top:18px;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);color:var(--dsw-alias-label-primary);font-size:12.5px;display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;}
.dswtt-err{margin-top:14px;padding:9px 12px;border-radius:9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12.5px;}
.dswtt-foot{margin-top:26px;color:var(--dsw-alias-label-secondary);font-size:11.5px;display:flex;gap:10px;flex-wrap:wrap;}
/* ── 展开编辑区 ── */
.dswtt-editor{padding:4px 14px 16px 41px;background:var(--dsw-alias-bg-layer-2);border-top:1px dashed var(--dsw-alias-border-l1);}
.dswtt-field{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;}
.dswtt-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:32px;}
.dswtt-date{height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;outline:none;color-scheme:light dark;}
.dswtt-date:focus{border-color:var(--dsw-alias-brand-primary);}
.dswtt-span{font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dswtt-note{width:100%;min-height:88px;margin-top:10px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box;}
.dswtt-note:focus{border-color:var(--dsw-alias-brand-primary);}
.dswtt-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px;margin-top:8px;transition:border-color .12s,background .12s;}
.dswtt-drop.is-over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);}
.dswtt-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;}
.dswtt-thumb{position:relative;border-radius:9px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);aspect-ratio:1;display:flex;align-items:center;justify-content:center;}
.dswtt-thumb img,.dswtt-thumb video{width:100%;height:100%;object-fit:cover;display:block;}
.dswtt-thumb .dswtt-fileicon{padding:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);text-align:center;word-break:break-all;}
.dswtt-thumb-del{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:6px;border:0;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s;}
.dswtt-thumb:hover .dswtt-thumb-del{opacity:1;}
.dswtt-editor-actions{display:flex;gap:8px;margin-top:12px;align-items:center;}
.dswtt-set{max-width:680px;padding:2px 2px 48px;font-size:13.5px;color:var(--dsw-alias-label-primary);line-height:1.55;}
.dswtt-set-title{margin:0 0 4px;font-size:17px;font-weight:600;}
.dswtt-set-desc{margin:0 0 18px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.65;}
.dswtt-set-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:16px;background:var(--dsw-alias-bg-layer-1);}
.dswtt-set-row{display:flex;flex-direction:column;gap:6px;}
.dswtt-set-label{font-size:12.5px;font-weight:600;}
.dswtt-set-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;}
.dswtt-set-input{height:33px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;transition:border-color .12s,box-shadow .12s;font-family:inherit;}
.dswtt-set-input:focus{border-color:#2383E2;box-shadow:0 0 0 3px rgba(35,131,226,.14);}
.dswtt-switch{display:flex;align-items:center;justify-content:space-between;gap:14px;}
.dswtt-track{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;cursor:pointer;transition:background .15s;flex:none;border:0;padding:0;}
.dswtt-track.is-on{background:#2383E2;}
.dswtt-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.22);}
.dswtt-track.is-on .dswtt-knob{transform:translateX(16px);}
.dswtt-set-msg{font-size:12.5px;padding:8px 10px;border-radius:8px;line-height:1.5;}
.dswtt-set-msg.is-ok{background:rgba(15,123,108,.1);color:#0f7b6c;}
.dswtt-set-msg.is-err{background:rgba(235,87,87,.1);color:#b23a32;}
.dswtt-set-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.dswtt-set code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px;word-break:break-all;}
.dswtt-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:6px;}
/* ── 时间轴（甘特）视图 ── */
.dswtt-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);}
.dswtt-seg button{height:26px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer;transition:background .12s,color .12s;}
.dswtt-seg button + button{border-left:1px solid var(--dsw-alias-border-l1);}
.dswtt-seg button.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.13);}
.dswtt-tl{margin-top:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}
.dswtt-tl-scroll{overflow-x:auto;overflow-y:hidden;}
.dswtt-tl-head{display:flex;align-items:stretch;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dswtt-tl-headright{display:flex;flex-direction:column;}
.dswtt-tl-months{display:flex;}
.dswtt-tl-month{flex:none;box-sizing:border-box;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);padding:8px 8px 0;border-right:1px solid var(--dsw-alias-border-l1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dswtt-tl-corner{flex:none;width:176px;position:sticky;left:0;z-index:3;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);padding:6px 10px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;align-items:flex-end;}
.dswtt-tl-days{display:flex;}
.dswtt-tl-day{flex:none;box-sizing:border-box;text-align:center;color:var(--dsw-alias-label-secondary);padding:3px 0 7px;border-right:1px solid var(--dsw-alias-border-l1);}
.dswtt-tl-daynum{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 3px;border-radius:11px;font-size:12px;line-height:1;font-variant-numeric:tabular-nums;}
.dswtt-tl-day.is-weekend{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 6%,transparent);}
.dswtt-tl-day.is-today .dswtt-tl-daynum{background:#EB5757;color:#fff;font-weight:600;}
body[data-ds-dark-theme] .dswtt-tl-day.is-today .dswtt-tl-daynum{background:#EB6B63;color:#fff;}
.dswtt-tl-row{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:stretch;}
.dswtt-tl-row:last-child{border-bottom:0;}
.dswtt-tl-row:hover .dswtt-tl-bar{box-shadow:0 2px 6px rgba(15,15,15,.16),0 0 0 1px rgba(15,15,15,.03);}
.dswtt-tl-row:hover .dswtt-tl-barlabel{color:var(--dsw-alias-label-primary);}
.dswtt-tl-row.is-open{background:var(--dsw-alias-bg-layer-2);}
.dswtt-tl-label{flex:none;width:176px;position:sticky;left:0;z-index:2;background:inherit;border-right:1px solid var(--dsw-alias-border-l1);padding:0 10px;font-size:14px;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:7px;cursor:pointer;min-height:40px;}
.dswtt-tl-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dswtt-tl-row.is-done .dswtt-tl-label span{color:var(--dsw-alias-label-secondary);text-decoration:line-through;}
.dswtt-tl-track{position:relative;flex:none;height:40px;}
.dswtt-tl-bar{position:absolute;box-sizing:border-box;z-index:2;top:6px;height:28px;border-radius:6px;background:#FFFFFF;color:#37352F;border:1px solid rgba(15,15,15,.14);box-shadow:0 1px 3px rgba(15,15,15,.10),0 0 0 .5px rgba(15,15,15,.05);font-size:12.5px;line-height:26px;padding:0 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;transition:box-shadow .12s;}
.dswtt-tl-bar.is-done{background:#FAFBFA;color:#8A968F;border-color:rgba(68,131,97,.28);box-shadow:none;}
.dswtt-tl-bar.is-late{background:#FFF8F7;color:#A8312A;border-color:rgba(235,87,87,.38);}
.dswtt-tl-bar.is-open{box-shadow:0 0 0 2px rgba(35,131,226,.45),0 1px 2px rgba(15,15,15,.12);border-color:rgba(35,131,226,.5);}
body[data-ds-dark-theme] .dswtt-tl-bar{background:rgba(255,255,255,.09);color:rgba(255,255,255,.92);border-color:rgba(255,255,255,.16);box-shadow:0 1px 3px rgba(0,0,0,.35);}
body[data-ds-dark-theme] .dswtt-tl-bar.is-done{background:rgba(68,131,97,.16);color:#8FC0A2;border-color:rgba(68,131,97,.4);}
body[data-ds-dark-theme] .dswtt-tl-bar.is-late{background:rgba(235,87,87,.14);color:#FFA39C;border-color:rgba(235,87,87,.44);}
body[data-ds-dark-theme] .dswtt-tl-bar.is-open{outline-color:rgba(255,255,255,.45);}
.dswtt-tl-barlabel{position:absolute;top:0;height:40px;line-height:40px;z-index:2;font-size:14px;color:#37352F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;max-width:260px;}
body[data-ds-dark-theme] .dswtt-tl-barlabel{color:rgba(255,255,255,.9);}
.dswtt-tl-row.is-done .dswtt-tl-barlabel{color:var(--dsw-alias-label-secondary);text-decoration:line-through;}
.dswtt-tl-today{position:absolute;top:0;bottom:0;width:1.5px;z-index:1;background:#EB5757;opacity:.5;pointer-events:none;}
body[data-ds-dark-theme] .dswtt-tl-today{background:#FF8A80;opacity:.6;}
.dswtt-tl-expand{background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);}
.dswtt-tl-empty{padding:30px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;}
`

    function CheckGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M5 12.5l4.2 4.2L19 6.8', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function rangeLabel(task) {
      const end = task.endDate || task.startDate
      if (!task.startDate) return ''
      if (!end || end === task.startDate) return task.startDate
      return task.startDate.slice(5) + ' → ' + end.slice(5)
    }

    // ── 展开后的编辑区 ──────────────────────────────────────────────────────
    function TaskEditor({ task, onClose }) {
      const [title, setTitle] = React.useState(task.title)
      const [start, setStart] = React.useState(task.startDate || '')
      const [end, setEnd] = React.useState(task.endDate || '')
      const [note, setNote] = React.useState(task.note || '')
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState(true)
      const [over, setOver] = React.useState(false)
      const firstRun = React.useRef(true)
      const fileRef = React.useRef(null)

      const media = task.media || []
      const spanDays = start ? dayDiff(start, end || start) + 1 : 0

      // 防抖自动保存：写完停手 1.2 秒就落盘（本地先落，再尽力同步 Notion）。
      // 有了它，"忘了点保存 / 点到了取消" 不会再丢备注。
      React.useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return undefined }
        setSaved(false)
        const timer = setTimeout(() => {
          post('update', {
            id: task.id,
            title: title.trim() || task.title,
            startDate: start || task.startDate,
            endDate: end || start || task.startDate,
            note,
          }).then(() => setSaved(true)).catch(() => {})
        }, 1200)
        return () => clearTimeout(timer)
      }, [title, start, end, note])

      const save = async () => {
        setSaving(true)
        try {
          await post('update', {
            id: task.id,
            title: title.trim() || task.title,
            startDate: start || task.startDate,
            endDate: end || start || task.startDate,
            note,
          })
          onClose()
        } catch { /* post 已经把错误挂到 state.error 上 */ } finally {
          setSaving(false)
        }
      }

      const onPickFiles = (files) => {
        if (!files || !files.length) return
        uploadFiles(task.id, files)
      }

      return h('div', { className: 'dswtt-editor',
        onDragOver: (e) => { e.preventDefault(); setOver(true) },
        onDragLeave: () => setOver(false),
        onDrop: (e) => {
          e.preventDefault()
          setOver(false)
          onPickFiles(e.dataTransfer && e.dataTransfer.files)
        } },
        h('div', { className: 'dswtt-field' },
          h('span', { className: 'dswtt-label' }, T('start')),
          h('input', {
            className: 'dswtt-date', type: 'date', value: start,
            onChange: (e) => {
              const v = e.target.value
              setStart(v)
              if (v && (!end || end < v)) setEnd(v)
            },
          }),
          h('span', { className: 'dswtt-label' }, T('end')),
          h('input', {
            className: 'dswtt-date', type: 'date', value: end, min: start || undefined,
            onChange: (e) => setEnd(e.target.value),
          }),
          spanDays > 1 ? h('span', { className: 'dswtt-span' }, T('spanDays', spanDays)) : null,
        ),
        h('textarea', {
          className: 'dswtt-note',
          value: note,
          placeholder: T('notePlaceholder'),
          onChange: (e) => setNote(e.target.value),
          onPaste: (e) => {
            const files = e.clipboardData && e.clipboardData.files
            if (files && files.length) {
              e.preventDefault()
              onPickFiles(files)
            }
          },
        }),
        h('div', { className: 'dswtt-drop' + (over ? ' is-over' : '') },
          media.length
            ? h('div', { className: 'dswtt-media' }, media.map((m) => h('div', { className: 'dswtt-thumb', key: m.id },
              m.kind === 'image'
                ? h('img', { src: mediaUrl(m), alt: m.name, loading: 'lazy' })
                : m.kind === 'video'
                  ? h('video', { src: mediaUrl(m), muted: true, preload: 'metadata' })
                  : h('div', { className: 'dswtt-fileicon' }, m.name),
              h('button', {
                type: 'button', className: 'dswtt-thumb-del', title: T('removeMedia'),
                onClick: () => post('removeMedia', { id: task.id, mediaId: m.id }).catch(() => {}),
              }, '×'),
            )))
            : h('div', { className: 'dswtt-hint' }, T('noMedia')),
          h('div', { className: 'dswtt-field' },
            h('button', { type: 'button', className: 'dswtt-btn', onClick: () => fileRef.current && fileRef.current.click() }, T('attach')),
            h('input', {
              ref: fileRef, type: 'file', multiple: true, style: { display: 'none' },
              onChange: (e) => { onPickFiles(e.target.files); e.target.value = '' },
            }),
            over ? h('span', { className: 'dswtt-hint' }, T('dropped')) : null,
          ),
        ),
        h('div', { className: 'dswtt-editor-actions' },
          h('button', { type: 'button', className: 'dswtt-btn is-primary', disabled: saving || state.busy, onClick: save }, saving ? T('saving') : T('save')),
          h('button', { type: 'button', className: 'dswtt-btn', disabled: saving, onClick: onClose }, T('cancel')),
          h('span', { className: 'dswtt-hint', style: { marginTop: 0 } }, saved ? T('savedOk') + ' ✓' : T('unsaved')),
          task.notionUrl ? h('a', { className: 'dswtt-btn', href: task.notionUrl, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, T('openInNotion')) : null,
        ),
      )
    }

    // ── 时间轴视图 ──────────────────────────────────────────────────────────
    const TL_DAYS = 21
    const TL_COL = 42
    const TL_LABEL = 176

    function TimelineView({ anchor }) {
      const s = useStore()
      const base = anchor || (s.data ? s.data.date : null)
      const from = base ? shiftDay(base, -5) : null
      const to = from ? shiftDay(from, TL_DAYS - 1) : null
      const [openId, setOpenId] = React.useState(null)

      React.useEffect(() => {
        if (from && to) loadRange(from, to)
      }, [from, to, s.tick])

      if (!from || !to) return h('div', { className: 'dswtt-tl' }, h('div', { className: 'dswtt-tl-empty' }, T('loading')))

      const data = s.timeline
      const today = data ? data.today : null
      const tasks = data ? data.tasks : []
      const days = []
      for (let i = 0; i < TL_DAYS; i += 1) {
        const d = shiftDay(from, i)
        const [y, m, dd] = d.split('-').map(Number)
        const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay()
        days.push({ day: d, num: String(dd), ym: d.slice(0, 7), weekend: wd === 0 || wd === 6, today: d === today })
      }
      const trackWidth = TL_DAYS * TL_COL

      // 表头按 Notion 那样分两行：上面月份，下面日号（今天红圈）
      const isEn = T('today') === 'Today'
      const monthName = (ym) => {
        const [y, m] = ym.split('-').map(Number)
        try {
          return new Intl.DateTimeFormat(isEn ? 'en-US' : 'zh-CN', { month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)))
        } catch { return ym.slice(5) + '月' }
      }
      const months = []
      for (const d of days) {
        const last = months[months.length - 1]
        if (last && last.ym === d.ym) last.cols += 1
        else months.push({ ym: d.ym, cols: 1 })
      }
      months.forEach((m, i) => {
        const [y] = m.ym.split('-').map(Number)
        // 只有当这个月占的列够宽时才带年份，否则「2026年10月」会被挤成一个字
        const withYear = i === 0 && m.cols >= 4
        m.label = withYear
          ? (isEn ? monthName(m.ym) + ' ' + y : y + '年' + monthName(m.ym))
          : monthName(m.ym)
      })

      const grid = h('div', { className: 'dswtt-tl' },
        h('div', { className: 'dswtt-tl-scroll' },
          h('div', { style: { width: TL_LABEL + trackWidth + 'px' } },
            h('div', { className: 'dswtt-tl-head' },
              h('div', { className: 'dswtt-tl-corner' }, T('tlCorner')),
              h('div', { className: 'dswtt-tl-headright' },
                h('div', { className: 'dswtt-tl-months' }, months.map((m) => h('div', {
                  key: m.ym, className: 'dswtt-tl-month', style: { width: m.cols * TL_COL },
                }, m.label))),
                h('div', { className: 'dswtt-tl-days' }, days.map((d) => h('div', {
                  key: d.day,
                  className: 'dswtt-tl-day' + (d.weekend ? ' is-weekend' : '') + (d.today ? ' is-today' : ''),
                  style: { width: TL_COL },
                }, h('span', { className: 'dswtt-tl-daynum' }, d.num)))),
              ),
            ),
            tasks.length
              ? tasks.map((t) => {
                const end = t.endDate || t.startDate
                let i0 = dayDiff(from, t.startDate)
                let i1 = dayDiff(from, end)
                i0 = Math.max(0, i0)
                i1 = Math.min(TL_DAYS - 1, i1)
                const late = !t.done && end && today && end < today
                const left = i0 * TL_COL
                const width = Math.max(TL_COL - 8, (i1 - i0 + 1) * TL_COL - 8)
                return h('div', { key: t.id, style: { display: 'block' } },
                  h('div', { className: 'dswtt-tl-row' + (openId === t.id ? ' is-open' : '') + (t.done ? ' is-done' : '') },
                    h('div', { className: 'dswtt-tl-label', onClick: () => setOpenId((c) => (c === t.id ? null : t.id)), title: t.title },
                      h('button', {
                        type: 'button', role: 'checkbox', 'aria-checked': t.done ? 'true' : 'false',
                        className: 'dswtt-check' + (t.done ? ' is-done' : ''),
                        style: { width: 15, height: 15, marginTop: 0 },
                        onClick: (e) => { e.stopPropagation(); post(t.done ? 'undone' : 'done', { id: t.id }).catch(() => {}) },
                      }, t.done ? h(CheckGlyph) : null),
                      h('span', null, t.title),
                    ),
                    h('div', { className: 'dswtt-tl-track', style: { width: trackWidth } },
                      days.map((d) => h('div', {
                        key: d.day,
                        style: {
                          position: 'absolute', boxSizing: 'border-box', left: (dayDiff(from, d.day) * TL_COL), top: 0, bottom: 0, width: TL_COL,
                          borderRight: '1px solid var(--dsw-alias-border-l1)',
                          background: d.weekend ? 'color-mix(in srgb,var(--dsw-alias-label-secondary) 8%,transparent)' : 'transparent',
                        },
                      })),
                      today && today >= from && today <= to
                        ? h('div', { className: 'dswtt-tl-today', style: { left: dayDiff(from, today) * TL_COL + TL_COL / 2 } })
                        : null,
                      h('div', {
                        className: 'dswtt-tl-bar' + (t.done ? ' is-done' : '') + (late ? ' is-late' : '') + (openId === t.id ? ' is-open' : ''),
                        style: { left, width },
                        title: t.title + '  ' + rangeLabel(t) + (late ? '  (逾期)' : ''),
                        onClick: () => setOpenId((c) => (c === t.id ? null : t.id)),
                      }, width >= 104 ? t.title : null),
                      width < 104
                        ? h('div', {
                          className: 'dswtt-tl-barlabel',
                          style: { left: left + width + 7 },
                          title: t.title,
                        }, t.title)
                        : null,
                    ),
                  ),
                  openId === t.id ? h('div', { className: 'dswtt-tl-expand' }, h(TaskEditor, { task: t, onClose: () => setOpenId(null) })) : null,
                )
              })
              : h('div', { className: 'dswtt-tl-empty' }, T('tlEmpty')),
          ),
        ),
      )
      return grid
    }

    // ── 一行待办 ────────────────────────────────────────────────────────────
    function TaskRow({ task, day, open, onToggleOpen }) {
      const late = !task.done && task.overdueDays > 0
      return h('div', { className: 'dswtt-row' + (task.done ? ' is-done' : '') },
        h('button', {
          type: 'button', role: 'checkbox', 'aria-checked': task.done ? 'true' : 'false',
          title: task.done ? T('redo') : T('markDone'),
          className: 'dswtt-check' + (task.done ? ' is-done' : ''),
          disabled: state.busy,
          onClick: (e) => { e.stopPropagation(); post(task.done ? 'undone' : 'done', { id: task.id, date: day }).catch(() => {}) },
        }, task.done ? h(CheckGlyph) : null),
        h('div', {
          className: 'dswtt-body',
          onClick: onToggleOpen,
          title: open ? T('collapse') : T('expand'),
        },
          h('span', { className: 'dswtt-text' }, task.title),
          h('span', { className: 'dswtt-meta', onClick: (e) => e.stopPropagation() },
            task.spanDays > 1
              ? h('span', { className: 'dswtt-tag is-range' }, rangeLabel(task) + (task.dayIndex ? ' · ' + T('dayN', task.dayIndex, task.spanDays) : ''))
              : h('span', { className: 'dswtt-tag' }, rangeLabel(task)),
            late ? h('span', { className: 'dswtt-tag is-warn' }, '逾期 ' + task.overdueDays + ' 天') : null,
            task.mediaCount ? h('span', { className: 'dswtt-tag' }, '📎 ' + task.mediaCount) : null,
            task.hasNote && !task.mediaCount ? h('span', { className: 'dswtt-tag' }, '备注') : null,
            task.source === 'notion' ? h('span', { className: 'dswtt-tag' }, 'Notion') : null,
            task.syncError ? h('span', { className: 'dswtt-tag is-error', title: task.syncError }, '同步失败') : null,
          ),
        ),
        h('div', { className: 'dswtt-row-actions' },
          h('button', {
            type: 'button', className: 'dswtt-mini', title: T('move'), disabled: state.busy,
            onClick: () => {
              const start = shiftDay(task.startDate || day, 1)
              const end = task.endDate ? shiftDay(task.endDate, 1) : start
              post('update', { id: task.id, startDate: start, endDate: end }).catch(() => {})
            },
          }, '→'),
          h('button', {
            type: 'button', className: 'dswtt-mini is-danger', title: T('remove'), disabled: state.busy,
            onClick: () => post('remove', { id: task.id }).catch(() => {}),
          }, '×'),
        ),
      )
    }

    // ── 面板 ────────────────────────────────────────────────────────────────
    function TodoPanel() {
      const s = useStore()
      const data = s.data
      const day = data ? data.date : null
      const [draft, setDraft] = React.useState('')
      const [showDone, setShowDone] = React.useState(true)
      const [openId, setOpenId] = React.useState(null)
      const [view, setView] = React.useState(() => {
        // 默认落在时间轴：这块面板的主用途是看排期；切到列表会被记住
        try { return localStorage.getItem('dsh-tt:view.v2') || 'timeline' } catch { return 'timeline' }
      })
      const changeView = (next) => {
        setView(next)
        try { localStorage.setItem('dsh-tt:view.v2', next) } catch { /* 无存储就只在本次生效 */ }
      }
      const autoSynced = React.useRef(false)

      React.useEffect(() => {
        // 首次打开：先拿快照，再看要不要顺手从 Notion 拉一次（当天没拉过才拉）
        const run = async () => {
          if (!state.loadedOnce) await load()
          const d = state.data
          if (!d || autoSynced.current) return
          if (d.isToday && d.notion && d.notion.configured && d.notion.lastSyncDay !== d.today) {
            autoSynced.current = true
            post('sync', { date: d.date }).catch(() => {})
          }
          if (d.notion && d.notion.configured && !d.notion.timelineUrl) {
            post('ensureTimeline', {}).catch(() => {})
          }
        }
        run()
      }, [])

      const undone = data ? data.tasks.filter((t) => !t.done) : []
      const done = data ? data.tasks.filter((t) => t.done) : []

      const submit = (event) => {
        event.preventDefault()
        const title = draft.trim()
        if (!title) return
        setDraft('')
        post('add', { title, date: day }).catch(() => {})
      }

      const weekday = (() => {
        if (!day) return ''
        const [y, m, d] = day.split('-').map(Number)
        const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || ''
      })()

      const renderList = (items) => h('div', { className: 'dswtt-list' }, items.map((t) => h('div', {
        key: t.id, className: 'dswtt-item' + (openId === t.id ? ' is-open' : ''),
      },
        h(TaskRow, {
          task: t, day, open: openId === t.id,
          onToggleOpen: () => setOpenId((cur) => (cur === t.id ? null : t.id)),
        }),
        openId === t.id ? h(TaskEditor, { task: t, onClose: () => setOpenId(null) }) : null,
      )))

      return h('div', { className: 'dswtt-page' },
        h('style', null, CSS),
        h('div', { className: 'dswtt-inner' },
          h('div', { className: 'dswtt-head' },
            h('div', null,
              h('h1', { className: 'dswtt-h1' }, T('title')),
              h('p', { className: 'dswtt-sub' },
                data
                  ? day + ' ' + weekday + (data.isToday ? ' · ' + T('today') : '') + ' · ' + T('undoneSection') + ' ' + data.counts.undone
                    + (data.counts.overdue ? ' · ' + T('overdue') + ' ' + data.counts.overdue : '')
                  : T('loading')),
            ),
            h('div', { className: 'dswtt-actions' },
              h('div', { className: 'dswtt-seg' },
                h('button', { type: 'button', className: view === 'list' ? 'is-on' : '', onClick: () => changeView('list') }, T('viewList')),
                h('button', { type: 'button', className: view === 'timeline' ? 'is-on' : '', onClick: () => changeView('timeline') }, T('viewTimeline')),
              ),
              view === 'timeline'
                ? h('button', { type: 'button', className: 'dswtt-btn dswtt-icon-btn', title: T('shiftBack'), onClick: () => load(shiftDay(day, -7)) }, '‹')
                : h('button', { type: 'button', className: 'dswtt-btn dswtt-icon-btn', title: T('prevDay'), disabled: !day || s.loading, onClick: () => load(shiftDay(day, -1)) }, '‹'),
              h('button', { type: 'button', className: 'dswtt-btn', disabled: !day || s.loading || data.isToday, onClick: () => load() }, T('today')),
              view === 'timeline'
                ? h('button', { type: 'button', className: 'dswtt-btn dswtt-icon-btn', title: T('shiftFwd'), onClick: () => load(shiftDay(day, 7)) }, '›')
                : h('button', { type: 'button', className: 'dswtt-btn dswtt-icon-btn', title: T('nextDay'), disabled: !day || s.loading, onClick: () => load(shiftDay(day, 1)) }, '›'),
              h('button', { type: 'button', className: 'dswtt-btn', disabled: s.loading, onClick: () => load(day) }, T('refresh')),
              h('button', {
                type: 'button', className: 'dswtt-btn is-primary',
                disabled: !data || !data.notion.configured || s.busy || s.loading,
                title: data && data.notion.configured ? T('sync') : T('notConfigured'),
                onClick: () => post('sync', { date: day }).catch(() => {}),
              }, T('sync')),
              data && data.notion.configured
                ? (data.notion.timelineUrl
                  ? h('a', {
                    className: 'dswtt-btn', href: data.notion.timelineUrl, target: '_blank', rel: 'noreferrer',
                    style: { textDecoration: 'none' }, title: T('notionTimeline'),
                  }, T('notionTimeline'))
                  : h('button', {
                    type: 'button', className: 'dswtt-btn', disabled: s.busy,
                    title: T('ensureTimeline'),
                    onClick: () => post('ensureTimeline', {}).catch(() => {}),
                  }, T('notionTimeline')))
                : null,
            ),
          ),

          h('form', { className: 'dswtt-add', onSubmit: submit },
            h('input', {
              className: 'dswtt-input', value: draft, placeholder: T('addPlaceholder'),
              onChange: (e) => setDraft(e.target.value), disabled: s.busy,
            }),
            h('button', { type: 'submit', className: 'dswtt-btn is-primary', disabled: s.busy || !draft.trim() }, T('add')),
          ),

          s.error ? h('div', { className: 'dswtt-err' }, s.error) : null,

          data && !data.notion.configured
            ? h('div', { className: 'dswtt-notice' },
              h('span', null, T('notConfigured')),
              h('button', {
                type: 'button', className: 'dswtt-btn',
                onClick: () => { try { CTX.layout.selectPanel('plugins') } catch { /* 无 layout 服务时忽略 */ } },
              }, T('openPlugins')))
            : null,

          view === 'timeline' ? h(TimelineView, { anchor: day }) : h(React.Fragment, null,

          h('section', { className: 'dswtt-sec' },
            h('div', { className: 'dswtt-sec-title' }, T('undoneSection') + ' · ' + undone.length),
            undone.length ? renderList(undone) : h('div', { className: 'dswtt-empty' }, T('nothing')),
          ),

          h('section', { className: 'dswtt-sec' },
            h('div', { className: 'dswtt-sec-title' },
              h('button', { type: 'button', className: 'dswtt-sec-toggle', onClick: () => setShowDone((v) => !v) },
                h('span', { className: 'dswtt-sec-arrow' }, showDone ? '▾' : '▸'), T('doneSection') + ' · ' + done.length)),
            showDone
              ? (done.length ? renderList(done) : h('div', { className: 'dswtt-empty' }, T('nothingDone')))
              : null,
          ),

          data && data.upcoming && data.upcoming.length
            ? h('section', { className: 'dswtt-sec' },
              h('div', { className: 'dswtt-sec-title' }, T('upcoming') + ' · ' + data.upcoming.length),
              renderList(data.upcoming))
            : null,
          ),

          h('div', { className: 'dswtt-foot' },
            h('span', null, data && data.notion.configured
              ? T('notion') + ' · ' + T('lastSync') + ': ' + (data.notion.lastSyncAt ? new Date(data.notion.lastSyncAt).toLocaleTimeString() : T('neverSynced'))
              : T('localOnly')),
            data && data.notion.lastError ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ' + data.notion.lastError) : null,
          ),
        ),
      )
    }

    /** 面板级错误边界：渲染期抛错不要留一块白屏，至少把错误原文摆出来。 */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'dswtt-page' },
            h('style', null, CSS),
            h('div', { className: 'dswtt-inner' },
              h('h1', { className: 'dswtt-h1' }, '今日待办'),
              h('div', { className: 'dswtt-err' }, String((this.state.error && this.state.error.message) || this.state.error)),
            ),
          )
        }
        return this.props.children
      }
    }

    // ── 设置页：让任何人都能自己接上 Notion ─────────────────────────────────
    function SettingsSection() {
      const [cfg, setCfg] = React.useState(null)
      const [token, setToken] = React.useState('')
      const [dbInput, setDbInput] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState(null)

      const call = async (op, payload) => {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...(payload || {}) }),
        })
        const json = await res.json()
        if (!json || !json.ok) throw new Error((json && json.error) || '请求失败')
        return json.result
      }

      const reload = React.useCallback(() => {
        call('getConfig')
          .then((c) => { setCfg(c); setDbInput(c.databaseId || '') })
          .catch((e) => setMsg({ kind: 'err', text: String((e && e.message) || e) }))
      }, [])
      React.useEffect(() => { reload() }, [])

      const run = async (tag, fn) => {
        setBusy(tag)
        setMsg(null)
        try { await fn() } catch (e) {
          setMsg({ kind: 'err', text: String((e && e.message) || e) })
        } finally { setBusy('') }
      }

      const save = (patch, okText) => run('save', async () => {
        const c = await call('saveConfig', patch)
        setCfg(c)
        setDbInput(c.databaseId || '')
        setToken('')
        setMsg({ kind: 'ok', text: okText || T('setSaved') })
      })

      const saveForm = () => save({
        notionDatabaseId: dbInput,
        ...(token.trim() ? { notionToken: token.trim() } : {}),
      })

      const test = () => run('test', async () => {
        const r = await call('testNotion')
        const who = (r && (r.bot || r.name || r.user)) || ''
        setMsg({ kind: 'ok', text: T('setOk') + (who ? '（' + who + '）' : '') })
      })

      const timeline = () => run('timeline', async () => {
        const r = await call('ensureTimeline')
        if (r && r.url) {
          try { window.open(r.url, '_blank', 'noreferrer') } catch { /* 被拦就算了 */ }
          setMsg({ kind: 'ok', text: r.url })
        }
        reload()
      })

      const ready = Boolean(cfg)
      const sourceText = !cfg || !cfg.tokenSet ? T('setTokenNone')
        : cfg.tokenSource === 'env' ? T('setTokenFromEnv')
          : cfg.tokenSource === 'plugin' ? T('setTokenFromPlugin')
            : T('setTokenFromFile')

      const field = (label, control, hint) => h('div', { className: 'dswtt-set-row' },
        h('label', { className: 'dswtt-set-label' }, label),
        control,
        hint ? h('div', { className: 'dswtt-set-hint' }, hint) : null,
      )

      const toggle = (on, onClick) => h('button', {
        type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
        className: 'dswtt-track' + (on ? ' is-on' : ''), disabled: !ready || busy === 'save',
        onClick,
      }, h('span', { className: 'dswtt-knob' }))

      return h('div', { className: 'dswtt-set' },
        h('h2', { className: 'dswtt-set-title' }, T('setTitle')),
        h('p', { className: 'dswtt-set-desc' }, T('setDesc')),

        h('div', { className: 'dswtt-set-card' },
          h('div', { className: 'dswtt-switch' },
            h('div', { className: 'dswtt-set-label' }, T('setState')),
            h('div', { className: 'dswtt-set-hint' },
              ready && cfg.configured ? '● ' + T('setConfigured') : '○ ' + T('setNotConfigured'),
              cfg && cfg.tokenSet ? ' · ' + T('setTokenSaved') + ': ' + cfg.tokenHint + ' (' + sourceText + ')' : '',
            ),
          ),

          field(T('setToken'), h('input', {
            className: 'dswtt-set-input', type: 'password', autoComplete: 'off', spellCheck: false,
            placeholder: cfg && cfg.tokenSet ? cfg.tokenHint + ' — ' + T('setTokenPh') : T('setTokenPh'),
            value: token, onChange: (e) => setToken(e.target.value),
          }), T('setTokenHow')),

          field(T('setDb'), h('input', {
            className: 'dswtt-set-input', type: 'text', autoComplete: 'off', spellCheck: false,
            placeholder: T('setDbPh'), value: dbInput,
            onChange: (e) => setDbInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') saveForm() },
          }), T('setDbHow')),

          h('div', { className: 'dswtt-set-row' }, h('div', { className: 'dswtt-set-label' }, T('setSwitches'))),

          h('div', { className: 'dswtt-switch' },
            h('div', null,
              h('div', { className: 'dswtt-set-label' }, T('setCreate')),
              h('div', { className: 'dswtt-set-hint' }, T('setCreateHow'))),
            toggle(Boolean(ready && cfg.createOnAdd), () => save({ notionCreateOnAdd: !cfg.createOnAdd })),
          ),

          h('div', { className: 'dswtt-switch' },
            h('div', null,
              h('div', { className: 'dswtt-set-label' }, T('setMedia')),
              h('div', { className: 'dswtt-set-hint' }, T('setMediaHow'))),
            toggle(Boolean(ready && cfg.syncMedia), () => save({ notionSyncMedia: !cfg.syncMedia })),
          ),

          msg ? h('div', { className: 'dswtt-set-msg ' + (msg.kind === 'ok' ? 'is-ok' : 'is-err') }, msg.text) : null,

          h('div', { className: 'dswtt-set-actions' },
            h('button', {
              type: 'button', className: 'dswtt-btn is-primary', disabled: !ready || busy === 'save',
              onClick: saveForm,
            }, busy === 'save' ? '…' : T('setSaveBtn')),
            h('button', {
              type: 'button', className: 'dswtt-btn', disabled: !ready || !cfg.configured || busy === 'test',
              onClick: test,
            }, busy === 'test' ? '…' : T('setTest')),
            h('button', {
              type: 'button', className: 'dswtt-btn', disabled: !ready || !cfg.configured || busy === 'timeline',
              onClick: timeline,
            }, cfg && cfg.timelineUrl ? T('setTimelineBtn') : T('setCreateTimeline')),
          ),

          cfg ? h('div', { className: 'dswtt-set-hint' }, T('setPath') + '：', h('code', null, cfg.configPath)) : null,
        ),
      )
    }

    function PanelRoot() {
      return h(PanelBoundary, null, h(TodoPanel))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        CTX = ctx
        ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'today-todo: dictionaries')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 90,
          label: () => T('panel'),
          locale: NS,
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, PanelRoot))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'today-todo',
          order: 28,
          label: () => T('settingsTitle'),
          locale: NS,
        }, () => h(PanelBoundary, null, h(SettingsSection))))

        // 一份共享快照：侧栏小圆点与面板读同一份；页面隐藏时不打接口
        ctx.effect(() => {
          if (!state.loadedOnce) load()
          const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return
            if (!state.data) return
            load(state.data.date)
          }, 120000)
          return () => clearInterval(timer)
        }, 'today-todo: snapshot poll')
      },
    }
  },
})
