/**
 * dsh-today-todo — 今日待办面板（Host 半边）。
 *
 * 把「这段时间还没做完的事」变成侧栏一个常驻入口 + 一块独立面板。
 * 待办是**时间轴**：有开始/截止，跨多天的事项天天都在列表里，直到截止。
 * 备注是富内容：纯文本 + 图片/视频/任意附件，落在本地 media 目录，
 * 有 Notion 页面（且页面是插件建的）时同步进页面 body。
 *
 * 结构：
 *   <dataDir>/tasks.json   本地真源（UI 与 Notion 的合并缓存）
 *   <dataDir>/config.json  凭据（0600，优先于插件 Config）
 *   <dataDir>/media/*      附件二进制
 *     ↑ 读写
 *   /dsh-today-todo-api    前端 fetch（本机回环才放行）
 *   /dsh-today-todo-upload 附件上传（raw body）
 *   /dsh-today-todo-media  附件读取
 *   today_todo 工具        ← 模型调用（与 UI 同一套 service 方法）
 *     ↓ 可选
 *   Notion REST API
 *
 * 本地永远是真源：Notion 只是同步进来的镜像 + 回写目标。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createPage, ensureTimelineView, queryRecent, replacePageBody, setPageArchived, setPageDone, setPageRange, verify } from './notion.js'

const ROUTE = '/dsh-today-todo-api'
const UPLOAD_ROUTE = '/dsh-today-todo-upload'
const MEDIA_ROUTE = '/dsh-today-todo-media'
const TOOL = 'today_todo'
const MAX_TASKS = 2000
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024

export const inject = ['tools', 'webServer']

export const Config = z.object({
  dataDir: z.string().default('').description('待办数据目录，留空用 ~/.dsh/today-todo'),
  timezone: z.string().default('Asia/Shanghai').description('判断"今天"用哪个时区'),
  allowLanAccess: z.boolean().default(false).description('允许非本机回环地址访问插件接口'),

  notionToken: z.string().default('').description('Notion 令牌（ntn_… / secret_…）；留空读环境变量 NOTION_TOKEN'),
  notionDatabaseId: z.string().default('').description('要联动的 Notion 数据库 ID'),
  notionVersion: z.string().default('2022-06-28').description('Notion-Version 头'),
  notionTitleProperty: z.string().default('名称').description('标题属性名'),
  notionDateProperty: z.string().default('日期').description('日期属性名（start+end 表示时间轴）'),
  notionDoneProperty: z.string().default('完成').description('完成态属性名'),
  notionDoneKind: z.string().default('checkbox').description('完成态载体：checkbox / status / select'),
  notionDoneTrue: z.string().default('已完成').description('完成态的选项名'),
  notionDoneFalse: z.string().default('未开始').description('未完成态的选项名'),
  notionCreateOnAdd: z.boolean().default(true).description('本地新增任务时是否在 Notion 建页'),
  notionSyncMedia: z.boolean().default(true).description('备注里的图片/视频是否上传到 Notion 页面'),
})

// ── 小工具 ──────────────────────────────────────────────────────────────────

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function safeTz(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return 'Asia/Shanghai'
  }
}

function dayOf(ts, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

function todayOf(tz) {
  return dayOf(Date.now(), tz)
}

function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + delta * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/** 两个 YYYY-MM-DD 相差几天（b - a）。 */
function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

function isDay(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function uid(prefix = 't') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function trimTitle(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 300)
}

const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.zip': 'application/zip',
}

function mediaKindOf(mime, name) {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  const ext = extname(String(name || '')).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(ext)) return 'image'
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return 'video'
  return 'file'
}

// ── 本地存储 ────────────────────────────────────────────────────────────────

function normalizeTask(raw) {
  if (!raw || typeof raw.id !== 'string') return null
  // 旧版本只有 date（单日）：迁移成 startDate/endDate
  const legacy = isDay(raw.date) ? raw.date : null
  const startDate = isDay(raw.startDate) ? raw.startDate : legacy
  let endDate = isDay(raw.endDate) ? raw.endDate : null
  if (!endDate && legacy) endDate = legacy
  if (startDate && endDate && endDate < startDate) endDate = startDate
  return {
    id: raw.id,
    title: String(raw.title || '(无标题)').slice(0, 300),
    startDate,
    endDate,
    done: raw.done === true,
    doneAt: raw.doneAt || null,
    priority: Number(raw.priority) === 1 ? 1 : 0,
    note: String(raw.note || ''),
    media: Array.isArray(raw.media) ? raw.media.filter((m) => m && m.id && m.file) : [],
    source: raw.source === 'notion' ? 'notion' : 'local',
    notionPageId: raw.notionPageId || null,
    notionUrl: raw.notionUrl || null,
    /** 页面是插件建的才允许改写 body —— 用户自己写的页面一个字都不能覆盖。 */
    notionOwned: raw.notionOwned === true,
    /** 上次由本插件写入的 body 指纹；对不上就说明页面被改过，不再覆盖。 */
    notionBodySignature: raw.notionBodySignature || null,
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now()),
    deletedAt: raw.deletedAt || null,
    syncError: raw.syncError || null,
  }
}

function makeStore(config) {
  const dir = config.dataDir && config.dataDir.trim() ? config.dataDir.trim() : join(dshHome(), 'today-todo')
  const file = join(dir, 'tasks.json')
  const mediaDir = join(dir, 'media')
  let cache = null

  function load() {
    if (cache) return cache
    let data = { version: 2, tasks: [], notion: {} }
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        if (raw && Array.isArray(raw.tasks)) {
          data = {
            version: 2,
            tasks: raw.tasks.map(normalizeTask).filter(Boolean),
            notion: raw.notion && typeof raw.notion === 'object' ? raw.notion : {},
          }
        }
      }
    } catch {
      data = { version: 2, tasks: [], notion: {} }
    }
    cache = data
    return cache
  }

  function flush() {
    const data = load()
    if (data.tasks.length > MAX_TASKS) {
      data.tasks.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      data.tasks = data.tasks.slice(0, MAX_TASKS)
    }
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.' + process.pid + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, file)
    return data
  }

  function saveMedia(buffer, originalName, mime) {
    mkdirSync(mediaDir, { recursive: true })
    const ext = extname(originalName || '').toLowerCase()
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 24)
    const name = hash + (MEDIA_TYPES[ext] ? ext : '.bin')
    const target = join(mediaDir, name)
    if (!existsSync(target)) writeFileSync(target, buffer)
    return {
      id: uid('m'),
      kind: mediaKindOf(mime, originalName),
      name: String(originalName || name).slice(0, 200),
      mime: String(mime || MEDIA_TYPES[ext] || 'application/octet-stream'),
      size: buffer.length,
      file: name,
    }
  }

  function readMedia(item) {
    if (!item || !item.file) return null
    const p = join(mediaDir, basename(String(item.file)))
    return existsSync(p) ? readFileSync(p) : null
  }

  function dropMedia(item) {
    if (!item || !item.file) return
    const safe = basename(String(item.file))
    const p = join(mediaDir, safe)
    // 内容寻址：同哈希可能被别的条目共用，删前确认没人在用
    const used = load().tasks.some((t) => !t.deletedAt && (t.media || []).some((m) => m.file === safe))
    if (!used && existsSync(p)) {
      try { unlinkSync(p) } catch { /* 删不掉不该让主流程失败 */ }
    }
  }

  function mediaPath(name) {
    const safe = basename(String(name || ''))
    if (!safe || safe.startsWith('.')) return null
    const p = join(mediaDir, safe)
    return existsSync(p) ? p : null
  }

  function listMedia() {
    try { return readdirSync(mediaDir) } catch { return [] }
  }

  return { dir, file, mediaDir, load, flush, saveMedia, readMedia, dropMedia, mediaPath, listMedia }
}

// ── Notion 配置归一 ─────────────────────────────────────────────────────────

function readLocalConfig(dir) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** 接受纯 id、带横线的 uuid、或整条 Notion 链接，统一取 32 位 hex。 */
function normalizeDatabaseId(input) {
  const s = String(input == null ? '' : input).trim()
  if (!s) return ''
  const m = s.replace(/-/g, '').match(/[0-9a-f]{32}/i)
  return m ? m[0].toLowerCase() : ''
}

function notionConfigOf(config, dir) {
  const local = readLocalConfig(dir || '')
  // 优先级：本地凭据文件 > 插件 Config（patch 里那份）> 环境变量
  const pick = (key) => {
    const v = local[key] != null ? local[key] : config[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  const token = pick('notionToken')
    || (process.env.NOTION_TOKEN || '').trim()
    || (process.env.NOTION_API_KEY || '').trim()
  const databaseId = pick('notionDatabaseId')
  const timelineUrl = (() => {
    const v = local.notionTimelineUrl != null ? local.notionTimelineUrl : ''
    return typeof v === 'string' ? v : ''
  })()
  return {
    token,
    databaseId,
    version: pick('notionVersion') || '2022-06-28',
    titleProperty: pick('notionTitleProperty') || '名称',
    dateProperty: pick('notionDateProperty') || '日期',
    doneProperty: pick('notionDoneProperty') || '完成',
    doneKind: pick('notionDoneKind') || 'checkbox',
    doneTrue: pick('notionDoneTrue') || '已完成',
    doneFalse: pick('notionDoneFalse') || '未开始',
    syncMedia: local.notionSyncMedia != null ? local.notionSyncMedia !== false : config.notionSyncMedia !== false,
    createOnAdd: local.notionCreateOnAdd != null ? local.notionCreateOnAdd !== false : config.notionCreateOnAdd !== false,
    timelineUrl,
    configured: Boolean(token && databaseId),
  }
}

// ── 核心服务（UI 与工具共用，只此一份） ──────────────────────────────────────

function createService(config) {
  const store = makeStore(config)
  const tz = safeTz(config.timezone)
  let notionCfg = notionConfigOf(config, store.dir)
  const inflight = new Map()

  function refreshNotion() {
    notionCfg = notionConfigOf(config, store.dir)
    return notionCfg
  }

  function notionState() {
    refreshNotion()
    const n = store.load().notion || {}
    return {
      configured: notionCfg.configured,
      databaseId: notionCfg.configured ? notionCfg.databaseId : '',
      lastSyncAt: n.lastSyncAt || null,
      lastSyncDay: n.lastSyncDay || null,
      lastError: n.lastError || null,
      createOnAdd: notionCfg.configured && notionCfg.createOnAdd,
      syncMedia: notionCfg.syncMedia,
      timelineUrl: notionCfg.timelineUrl || '',
    }
  }

  function markNotion(patch) {
    const data = store.load()
    data.notion = { ...(data.notion || {}), ...patch }
    store.flush()
  }

  /** 某天是否落在这条待办的时间轴里。 */
  function coversDay(task, day) {
    if (!task.startDate) return false
    const end = task.endDate || task.startDate
    return task.startDate <= day && day <= end
  }

  function endOf(task) {
    return task.endDate || task.startDate || ''
  }

  function decorate(t, view) {
    const end = endOf(t)
    return {
      ...t,
      overdueDays: !t.done && end && end < view ? dayDiff(end, view) : 0,
      spanDays: t.startDate ? dayDiff(t.startDate, t.endDate || t.startDate) + 1 : 0,
      dayIndex: t.startDate && coversDay(t, view) ? dayDiff(t.startDate, view) + 1 : 0,
      hasNote: Boolean(t.note || (t.media && t.media.length)),
      mediaCount: t.media ? t.media.length : 0,
    }
  }

  function snapshot(day) {
    const today = todayOf(tz)
    const view = isDay(day) ? day : today
    const all = store.load().tasks.filter((t) => !t.deletedAt)

    const overdue = all.filter((t) => !t.done && t.startDate && endOf(t) < view)
    const active = all.filter((t) => coversDay(t, view))
    const upcoming = all.filter((t) => !t.done && t.startDate && t.startDate > view)
    // 在「接下来」里勾掉的任务：日期还在未来，所以不在 active 里，
    // 但它是今天完成的——不单独捞出来就会两边都不显示，等于凭空消失。
    const doneElsewhere = all.filter((t) => t.done && t.doneAt
      && dayOf(t.doneAt, tz) === view && !active.includes(t))

    const sortFn = (a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const ae = endOf(a), be = endOf(b)
      if (ae !== be) return String(ae).localeCompare(String(be))
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0)
      return Number(a.createdAt || 0) - Number(b.createdAt || 0)
    }

    const merged = [...overdue, ...active.filter((t) => !overdue.includes(t)), ...doneElsewhere].sort(sortFn)

    return {
      ok: true,
      today,
      date: view,
      isToday: view === today,
      tasks: merged.map((t) => decorate(t, view)),
      upcoming: upcoming.sort(sortFn).slice(0, 20).map((t) => decorate(t, view)),
      counts: {
        total: active.length,
        undone: active.filter((t) => !t.done).length,
        done: active.filter((t) => t.done).length + doneElsewhere.length,
        overdue: overdue.length,
      },
      notion: notionState(),
      tz,
    }
  }

  /** 时间轴视图：取和 [from, to] 有交集的全部待办（不做当日收拢）。 */
  function rangeSnapshot(from, to) {
    const today = todayOf(tz)
    const all = store.load().tasks.filter((t) => !t.deletedAt && t.startDate)
    const rows = all.filter((t) => {
      const end = t.endDate || t.startDate
      return end >= from && t.startDate <= to
    })
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if ((a.startDate || '') !== (b.startDate || '')) return String(a.startDate).localeCompare(String(b.startDate))
      return Number(a.createdAt || 0) - Number(b.createdAt || 0)
    })
    return {
      ok: true,
      from, to, today, tz,
      tasks: rows.map((t) => decorate(t, today)),
      notion: notionState(),
    }
  }

  function add({ title, startDate, endDate, note, priority }) {
    const clean = trimTitle(title)
    if (!clean) throw new Error('任务标题不能为空')
    const start = isDay(startDate) ? startDate : todayOf(tz)
    let end = isDay(endDate) ? endDate : start
    if (end < start) end = start
    const now = Date.now()
    const task = normalizeTask({
      id: uid(),
      title: clean,
      startDate: start,
      endDate: end,
      done: false,
      priority: Number(priority) === 1 ? 1 : 0,
      note: note ? String(note).slice(0, 20000) : '',
      media: [],
      source: 'local',
      createdAt: now,
      updatedAt: now,
    })
    store.load().tasks.push(task)
    store.flush()
    return task
  }

  function find(id) {
    return store.load().tasks.find((t) => t.id === id && !t.deletedAt)
  }

  function patchTask(id, patch) {
    const task = find(id)
    if (!task) throw new Error('任务不存在或已删除: ' + id)
    if (patch.title !== undefined) task.title = trimTitle(patch.title) || task.title
    if (patch.note !== undefined) task.note = String(patch.note || '').slice(0, 20000)
    if (patch.priority !== undefined) task.priority = Number(patch.priority) === 1 ? 1 : 0
    if (patch.startDate !== undefined && isDay(patch.startDate)) task.startDate = patch.startDate
    if (patch.endDate !== undefined) task.endDate = isDay(patch.endDate) ? patch.endDate : null
    if (task.startDate && task.endDate && task.endDate < task.startDate) task.endDate = task.startDate
    task.updatedAt = Date.now()
    store.flush()
    return task
  }

  /** 把软删除的条目捞回来（含已删除的那批），有 Notion 页的一并恢复。 */
  async function restore(id) {
    refreshNotion()
    const task = store.load().tasks.find((t) => t.id === id)
    if (!task) throw new Error('任务不存在: ' + id)
    if (!task.deletedAt) return task
    task.deletedAt = null
    task.updatedAt = Date.now()
    store.flush()
    if (notionCfg.configured && task.notionPageId) {
      try { await setPageArchived(notionCfg, task.notionPageId, false) } catch (err) {
        task.syncError = String((err && err.message) || err)
        store.flush()
      }
    }
    return task
  }

  /**
   * 删除：本地软删 + 把对应的 Notion 页一并移入回收站。
   * 不这么做的话「面板删了、Notion 还在」，两边对不上（用户已经踩过）。
   */
  async function remove(id) {
    refreshNotion()
    const task = find(id)
    if (!task) throw new Error('任务不存在或已删除: ' + id)
    task.deletedAt = Date.now()
    task.updatedAt = task.deletedAt
    store.flush()
    for (const m of task.media || []) store.dropMedia(m)
    if (notionCfg.configured && task.notionPageId) {
      try { await setPageArchived(notionCfg, task.notionPageId, true) } catch { /* 归档失败不挡本地删除 */ }
    }
    return { id, title: task.title }
  }

  /** 把备注/媒体推到页面 body（只对插件自己建的页面）。 */
  async function syncBody(task) {
    if (!notionCfg.configured || !task.notionPageId || !task.notionOwned) return
    try {
      const r = await replacePageBody(
        notionCfg,
        task.notionPageId,
        { note: task.note, media: notionCfg.syncMedia ? task.media : [] },
        (item) => store.readMedia(item),
        task.notionBodySignature,
      )
      if (!r.skipped && r.signature) task.notionBodySignature = r.signature
      task.syncError = r.warnings && r.warnings.length ? r.warnings.join('; ') : null
    } catch (err) {
      task.syncError = String((err && err.message) || err)
      markNotion({ lastError: task.syncError })
    }
    task.updatedAt = Date.now()
    store.flush()
  }

  async function pushProperties(task) {
    if (!notionCfg.configured || !task.notionPageId) return
    try {
      await setPageRange(notionCfg, task.notionPageId, task.startDate, task.endDate)
    } catch (err) {
      task.syncError = String((err && err.message) || err)
      markNotion({ lastError: task.syncError })
      store.flush()
    }
  }

  /** 更新一条：本地先落盘，再尽力同步 Notion（属性 + body）。 */
  async function updateTask(id, patch) {
    refreshNotion()
    const task = patchTask(id, patch)
    await pushProperties(task)
    await syncBody(task)
    return task
  }

  async function setDone(id, done) {
    refreshNotion()
    const task = find(id)
    if (!task) throw new Error('任务不存在或已删除: ' + id)
    task.done = Boolean(done)
    task.doneAt = task.done ? Date.now() : null
    task.updatedAt = Date.now()
    task.syncError = null
    store.flush()
    if (notionCfg.configured && task.notionPageId) {
      try {
        await setPageDone(notionCfg, task.notionPageId, task.done)
      } catch (err) {
        task.syncError = String((err && err.message) || err)
        task.updatedAt = Date.now()
        store.flush()
        markNotion({ lastError: task.syncError })
      }
    }
    return task
  }

  function addMediaTo(id, buffer, originalName, mime) {
    const task = find(id)
    if (!task) throw new Error('任务不存在或已删除: ' + id)
    const item = store.saveMedia(buffer, originalName, mime)
    task.media = [...(task.media || []), item]
    task.updatedAt = Date.now()
    store.flush()
    return { task, item }
  }

  function removeMediaFrom(id, mediaId) {
    const task = find(id)
    if (!task) throw new Error('任务不存在或已删除: ' + id)
    const item = (task.media || []).find((m) => m.id === mediaId)
    if (!item) throw new Error('附件不存在: ' + mediaId)
    task.media = task.media.filter((m) => m.id !== mediaId)
    task.updatedAt = Date.now()
    store.flush()
    store.dropMedia(item)
    return task
  }

  /** 拉 Notion：抓最近改动的一窗，取和 [view-60, view+180] 有交集的条目。 */
  async function sync(day) {
    refreshNotion()
    const view = isDay(day) ? day : todayOf(tz)
    if (!notionCfg.configured) {
      throw new Error('Notion 还没配置：填好 notionToken 与 notionDatabaseId 后再同步')
    }
    if (inflight.has('all')) return inflight.get('all')
    const job = (async () => {
      const from = shiftDay(view, -60)
      const to = shiftDay(view, 180)
      try {
        const pages = await queryRecent(notionCfg, { pages: 3 })
        const now = Date.now()
        const data = store.load()
        const byPage = new Map()
        for (const t of data.tasks) if (t.notionPageId) byPage.set(t.notionPageId, t)
        let added = 0
        let updated = 0
        for (const page of pages) {
          const start = page.startDate
          if (!start) continue
          const end = page.endDate || start
          if (end < from || start > to) continue
          const existing = byPage.get(page.notionPageId)
          if (existing) {
            const localNewer = Number(existing.updatedAt || 0) > Date.parse(page.editedAt || 0)
            if (localNewer || existing.deletedAt) continue
            if (existing.done !== page.done || existing.title !== page.title
              || existing.startDate !== start || (existing.endDate || '') !== (page.endDate || '')) {
              updated += 1
            }
            existing.done = page.done
            existing.title = page.title || existing.title
            existing.startDate = start
            existing.endDate = page.endDate
            existing.notionUrl = page.notionUrl || existing.notionUrl
            existing.updatedAt = now
          } else {
            data.tasks.push(normalizeTask({
              id: uid(),
              title: page.title,
              startDate: start,
              endDate: page.endDate,
              done: page.done,
              note: '',
              media: [],
              source: 'notion',
              notionPageId: page.notionPageId,
              notionUrl: page.notionUrl,
              notionOwned: false,
              createdAt: now,
              updatedAt: now,
            }))
            added += 1
          }
        }
        store.flush()
        markNotion({ lastSyncAt: now, lastSyncDay: view, lastError: null })
        return { ok: true, date: view, added, updated, fetched: pages.length }
      } catch (err) {
        markNotion({ lastError: String((err && err.message) || err) })
        throw err
      } finally {
        inflight.delete('all')
      }
    })()
    inflight.set('all', job)
    return job
  }

  async function addAndPush(input) {
    refreshNotion()
    const task = add(input)
    if (!notionCfg.configured || config.notionCreateOnAdd === false) return task
    try {
      const page = await createPage(notionCfg, {
        title: task.title,
        startDate: task.startDate,
        endDate: task.endDate,
        done: task.done,
      })
      task.notionPageId = page.notionPageId
      task.notionUrl = page.notionUrl
      task.notionOwned = true
      task.source = 'notion'
      task.updatedAt = Date.now()
      store.flush()
      if (task.note || (task.media || []).length) await syncBody(task)
    } catch (err) {
      task.syncError = String((err && err.message) || err)
      store.flush()
      markNotion({ lastError: task.syncError })
    }
    return task
  }

  /** 把时间轴视图的地址写进 config.json，面板下次就能直接跳。 */
  function rememberTimeline(url, viewId) {
    try {
      const file = join(store.dir, 'config.json')
      const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
      cur.notionTimelineUrl = url
      cur.notionTimelineViewId = viewId
      writeFileSync(file, JSON.stringify(cur, null, 2), 'utf8')
      try { chmodSync(file, 0o600) } catch { /* Windows 上没这个 */ }
    } catch { /* 写不进去也不影响本次返回 */ }
  }

  const CONFIG_FILE_KEYS = ['notionToken', 'notionDatabaseId', 'notionCreateOnAdd', 'notionSyncMedia']

  /** 给设置页用的配置视图（令牌只回脱敏提示，不回明文）。 */
  function getConfig() {
    refreshNotion()
    const meta = store.load().notion || {}
    const local = readLocalConfig(store.dir)
    const tokenSource = local.notionToken ? 'file'
      : config.notionToken ? 'plugin'
        : (process.env.NOTION_TOKEN || process.env.NOTION_API_KEY) ? 'env' : 'none'
    return {
      configured: notionCfg.configured,
      tokenSet: Boolean(notionCfg.token),
      tokenHint: notionCfg.token ? `${notionCfg.token.slice(0, 4)}…${notionCfg.token.slice(-4)}` : '',
      tokenSource,
      databaseId: notionCfg.databaseId,
      titleProperty: notionCfg.titleProperty,
      dateProperty: notionCfg.dateProperty,
      doneProperty: notionCfg.doneProperty,
      createOnAdd: notionCfg.createOnAdd,
      syncMedia: notionCfg.syncMedia,
      timelineUrl: notionCfg.timelineUrl,
      configPath: join(store.dir, 'config.json'),
      lastSyncAt: meta.lastSyncAt || null,
      lastError: meta.lastError || null,
    }
  }

  /** 写设置（只接受白名单字段），落到 config.json，然后立刻重新读一遍。 */
  function saveConfig(patch) {
    const file = join(store.dir, 'config.json')
    const cur = readLocalConfig(store.dir)
    const next = { ...cur }
    const p = patch && typeof patch === 'object' ? patch : {}

    if (typeof p.notionToken === 'string') {
      const v = p.notionToken.trim()
      if (v) next.notionToken = v
      else delete next.notionToken
    }
    if (typeof p.notionDatabaseId === 'string') {
      const v = normalizeDatabaseId(p.notionDatabaseId)
      if (v) next.notionDatabaseId = v
      else delete next.notionDatabaseId
      // 只在"真的换了一个库"时清掉视图缓存；同一个库换个写法不算
      if (v && v !== normalizeDatabaseId(cur.notionDatabaseId)) {
        delete next.notionTimelineUrl
        delete next.notionTimelineViewId
      }
    }
    if (typeof p.notionCreateOnAdd === 'boolean') next.notionCreateOnAdd = p.notionCreateOnAdd
    if (typeof p.notionSyncMedia === 'boolean') next.notionSyncMedia = p.notionSyncMedia

    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
    try { chmodSync(file, 0o600) } catch { /* Windows */ }
    for (const k of CONFIG_FILE_KEYS) if (!(k in next)) delete next[k]
    refreshNotion()
    return getConfig()
  }

  /** 确保 Notion 侧有一个时间轴视图；没有就建一个。 */
  async function ensureTimeline() {
    refreshNotion()
    if (!notionCfg.configured) throw new Error('Notion 还没配置')
    if (notionCfg.timelineUrl) return { ok: true, created: false, url: notionCfg.timelineUrl }
    const r = await ensureTimelineView(notionCfg)
    rememberTimeline(r.view.url, r.view.id)
    refreshNotion()
    return { ok: true, created: r.created, url: r.view.url }
  }

  async function testNotion() {
    refreshNotion()
    if (!notionCfg.token) throw new Error('没有 Notion token')
    if (!notionCfg.databaseId) throw new Error('没有 notionDatabaseId')
    return verify(notionCfg)
  }

  return {
    store, tz,
    snapshot, rangeSnapshot, add, addAndPush, find, patchTask, updateTask, remove, restore, setDone,
    addMediaTo, removeMediaFrom, sync, testNotion, ensureTimeline, getConfig, saveConfig, notionState,
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function isLoopback(hostHeader) {
  if (!hostHeader) return false
  const host = String(hostHeader).replace(/:\d+$/, '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1' || host === '0.0.0.0'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try { resolve(JSON.parse(text)) } catch { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('文件超过 ' + Math.round(limit / 1024 / 1024) + 'MB 上限'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const conf = config || {}
  const service = createService(conf)

  const guard = (req, res) => {
    if (!conf.allowLanAccess && !isLoopback(req.headers.host)) {
      sendJson(res, 403, { ok: false, error: '只允许本机访问' })
      return false
    }
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(req, res) {
      if (!guard(req, res)) return
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url || '/', 'http://localhost')
          const from = url.searchParams.get('from')
          const to = url.searchParams.get('to')
          if (isDay(from) && isDay(to)) {
            sendJson(res, 200, service.rangeSnapshot(from, to))
            return
          }
          sendJson(res, 200, service.snapshot(url.searchParams.get('date') || undefined))
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST' })
          res.end()
          return
        }
        const body = await readJsonBody(req)
        const result = await dispatch(body)
        sendJson(res, 200, { ok: true, result, snapshot: service.snapshot(body && body.date) })
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          error: String((err && err.message) || err),
          snapshot: (() => { try { return service.snapshot() } catch { return null } })(),
        })
      }
    },
  }), 'today-todo: http route')

  // 附件上传：raw body，省掉 base64 膨胀
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: UPLOAD_ROUTE,
    async handler(req, res) {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const taskId = url.searchParams.get('task') || ''
        const name = url.searchParams.get('name') || 'attachment'
        const mime = req.headers['content-type'] || url.searchParams.get('mime') || ''
        const buffer = await readRawBody(req, MAX_UPLOAD_BYTES)
        if (!buffer.length) throw new Error('空文件')
        const { item } = service.addMediaTo(taskId, buffer, name, mime)
        sendJson(res, 200, { ok: true, item })
      } catch (err) {
        sendJson(res, 200, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }), 'today-todo: upload route')

  // 附件读取
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: MEDIA_ROUTE,
    handler(req, res) {
      if (!guard(req, res)) return
      const url = new URL(req.url || '/', 'http://localhost')
      let name = ''
      try { name = decodeURIComponent(url.pathname.slice(MEDIA_ROUTE.length + 1)) } catch { name = '' }
      const file = service.store.mediaPath(name)
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      try {
        const buf = readFileSync(file)
        res.writeHead(200, {
          'Content-Type': MEDIA_TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': buf.length,
          'Cache-Control': 'private, max-age=86400',
        })
        res.end(buf)
      } catch {
        res.writeHead(500)
        res.end()
      }
    },
  }), 'today-todo: media route')

  async function dispatch(body) {
    const op = String(body.op || '')
    switch (op) {
      case 'add': return service.addAndPush(body)
      case 'update': return service.updateTask(body.id, body)
      case 'done': return service.setDone(body.id, true)
      case 'undone': return service.setDone(body.id, false)
      case 'move': {
        if (!isDay(body.date)) throw new Error('日期格式应为 YYYY-MM-DD')
        return service.updateTask(body.id, { startDate: body.date, endDate: body.date })
      }
      case 'priority': return service.patchTask(body.id, { priority: body.priority })
      case 'remove': return service.remove(body.id)
      case 'restore': return service.restore(body.id)
      case 'removeMedia': return service.removeMediaFrom(body.id, body.mediaId)
      case 'sync': return service.sync(body.date)
      case 'testNotion': return service.testNotion()
      case 'ensureTimeline': return service.ensureTimeline()
      case 'getConfig': return service.getConfig()
      case 'saveConfig': return service.saveConfig(body)
      default: throw new Error('未知操作: ' + op)
    }
  }

  ctx.effect(() => ctx.tools.register({
    name: TOOL,
    description: `今日待办（本地待办清单 + 可选 Notion 数据库联动）。用户在界面上有一块"今日待办"面板，这个工具与面板共用同一份数据，改动会实时反映到界面上。
待办是时间轴：startDate/endDate 表示起止，跨多天的条目在每一天的列表里都会出现，直到截止。
action 说明：
- list：列出某天（默认今天）的待办，含逾期未完成项与统计
- get：读一条详情（含备注全文与附件清单）
- add：新增（title 必填；date 可选 YYYY-MM-DD，默认今天；endDate 可选，做多天区间；note 可选）
- done / undone：标记完成 / 未完成（id 从 list 结果里取）
- remove：删除
- move：把起止都改到某一天
- sync：从 Notion 数据库拉取（需要已配置 Notion）
- testNotion：检查 Notion 配置，返回数据库名与属性清单`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'add', 'done', 'undone', 'remove', 'move', 'sync', 'testNotion'],
          description: '要执行的操作',
        },
        title: { type: 'string', description: 'add 时的任务标题' },
        id: { type: 'string', description: 'get/done/undone/remove/move 时的任务 id' },
        date: { type: 'string', description: 'list/add/move 的日期，YYYY-MM-DD，默认今天' },
        endDate: { type: 'string', description: 'add 时的截止日期，YYYY-MM-DD；不给表示单日' },
        note: { type: 'string', description: 'add 时的备注（纯文本）' },
        priority: { type: 'number', description: '1 = 重要，0 = 普通' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const action = String((args && args.action) || '')
      const fmtRange = (t) => {
        const end = t.endDate || t.startDate
        return end && end !== t.startDate ? t.startDate + '→' + end : String(t.startDate || '')
      }
      if (action === 'list') {
        const snap = service.snapshot(args.date)
        const lines = []
        lines.push('📅 ' + snap.date + (snap.isToday ? '（今天）' : '') + ' 未完成 ' + snap.counts.undone + ' / 共 ' + snap.counts.total + (snap.counts.overdue ? '，另有 ' + snap.counts.overdue + ' 项逾期' : ''))
        if (!snap.tasks.length) lines.push('（这一天没有待办）')
        for (const t of snap.tasks) {
          const mark = t.done ? '[x]' : '[ ]'
          const late = t.overdueDays ? ' ⚠️已逾期 ' + t.overdueDays + ' 天' : ''
          const span = t.spanDays > 1 ? ' · 第 ' + t.dayIndex + '/' + t.spanDays + ' 天' : ''
          const extra = (t.hasNote ? ' · 有备注' : '') + (t.mediaCount ? '（' + t.mediaCount + ' 个附件）' : '')
          lines.push(mark + ' ' + t.title + ' [' + fmtRange(t) + span + ']' + late + extra + '  id=' + t.id)
        }
        if (!snap.notion.configured) lines.push('\n提示：Notion 尚未配置，当前只有本地待办。')
        else if (snap.notion.lastError) lines.push('\nNotion 上次错误：' + snap.notion.lastError)
        return lines.join('\n')
      }
      if (action === 'get') {
        const t = service.find(args.id)
        if (!t) throw new Error('任务不存在: ' + args.id)
        const parts = [
          t.title,
          '时间：' + fmtRange(t) + (t.done ? '（已完成）' : ''),
          '来源：' + t.source + (t.notionUrl ? ' ' + t.notionUrl : ''),
        ]
        if (t.syncError) parts.push('⚠️ ' + t.syncError)
        parts.push('', '备注：', t.note || '（空）')
        if ((t.media || []).length) {
          parts.push('', '附件：')
          for (const m of t.media) parts.push('- [' + m.kind + '] ' + m.name + ' (' + Math.round(m.size / 1024) + 'KB)')
        }
        return parts.join('\n')
      }
      if (action === 'add') {
        const task = await service.addAndPush({
          title: args.title, startDate: args.date, endDate: args.endDate, note: args.note, priority: args.priority,
        })
        return '已添加：' + task.title + '（' + fmtRange(task) + '）id=' + task.id
          + (task.notionPageId ? '，并已写入 Notion' : '')
          + (task.syncError ? '\n⚠️ Notion 回写失败：' + task.syncError : '')
      }
      if (action === 'done' || action === 'undone') {
        const task = await service.setDone(args.id, action === 'done')
        return (action === 'done' ? '已完成' : '已恢复为未完成') + '：' + task.title
          + (task.syncError ? '\n⚠️ Notion 回写失败：' + task.syncError : (task.notionPageId ? '（已同步 Notion）' : ''))
      }
      if (action === 'remove') {
        const r = await service.remove(args.id)
        return '已删除：' + r.title
      }
      if (action === 'move') {
        if (!isDay(args.date)) throw new Error('date 必须是 YYYY-MM-DD')
        const task = await service.updateTask(args.id, { startDate: args.date, endDate: args.date })
        return '已改期：' + task.title + ' → ' + fmtRange(task)
      }
      if (action === 'sync') {
        const r = await service.sync(args.date)
        return '已从 Notion 同步：拉到 ' + r.fetched + ' 条，新增 ' + r.added + '，更新 ' + r.updated
      }
      if (action === 'testNotion') {
        const info = await service.testNotion()
        return 'Notion 连接正常：数据库「' + info.databaseTitle + '」\n属性：' + (info.propertyNames.join('、') || '（无）')
      }
      throw new Error('未知 action: ' + action)
    },
  }), 'today-todo: tool')
}
