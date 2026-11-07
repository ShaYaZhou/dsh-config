/**
 * Notion 数据源：只用官方 REST API，不依赖任何 SDK。
 *
 * 设计约束（都是踩坑得来的，改之前先看）：
 * - 数据库的属性名/类型因库而异，所以属性名 + 完成态的三种载体
 *   （checkbox / status / select）全部走配置，不在代码里写死。
 * - 属性不存在时 query 会整体 400，报错必须原样透出（含 Notion 的 message）。
 * - 待办是「时间轴」不是单日：日期属性用 date 的 start+end 表示区间。
 * - 备注里的图片/视频走 /v1/file_uploads 传到页面 body；传不上去时降级为
 *   文字段落 + 错误回传，绝不吞掉用户的本地数据。
 */

import { createHash } from 'node:crypto'

const API = 'https://api.notion.com/v1'

export class NotionError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'NotionError'
    this.status = status
    this.body = body
  }
}

async function request(cfg, path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Notion-Version': cfg.version,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON：保留原文 */ }
  if (!res.ok) {
    const msg = (json && (json.message || json.code)) || text || `HTTP ${res.status}`
    throw new NotionError(msg, res.status, json)
  }
  return json
}

/** 取「标题」属性的纯文本。 */
function readTitle(props, name, fallbackName) {
  const prop = props[name] ?? props[fallbackName]
  if (!prop || !Array.isArray(prop.title)) return ''
  return prop.title.map((t) => t.plain_text || '').join('').trim()
}

/** 把任意形态的完成态属性归一成 boolean。 */
function readDone(props, cfg) {
  const prop = props[cfg.doneProperty]
  if (!prop) return false
  if (prop.type === 'checkbox') return prop.checkbox === true
  const value = prop.type === 'status'
    ? prop.status && prop.status.name
    : prop.type === 'select'
      ? prop.select && prop.select.name
      : null
  if (typeof value !== 'string') return false
  if (cfg.doneTrue) return value.trim() === cfg.doneTrue.trim()
  return ['已完成', '完成', 'done', 'Done', 'DONE', 'complete', 'Completed'].includes(value)
}

/** 读日期区间：{ start, end }，end 为空表示单日。 */
function readRange(props, name) {
  const prop = props[name]
  if (!prop) return { start: null, end: null }
  if (prop.type === 'date') {
    if (!prop.date) return { start: null, end: null }
    return {
      start: prop.date.start ? String(prop.date.start).slice(0, 10) : null,
      end: prop.date.end ? String(prop.date.end).slice(0, 10) : null,
    }
  }
  if (prop.type === 'created_time') {
    return { start: prop.created_time ? String(prop.created_time).slice(0, 10) : null, end: null }
  }
  return { start: null, end: null }
}

/** 写完成态：按属性真实类型挑正确的 payload 形状（猜错 Notion 会 400）。 */
function donePayload(props, cfg, done) {
  const prop = props[cfg.doneProperty]
  const type = prop ? prop.type : kindToType(cfg.doneKind)
  if (type === 'checkbox') return { checkbox: done }
  const name = done ? cfg.doneTrue : cfg.doneFalse
  if (type === 'status') return { status: { name } }
  if (type === 'select') return { select: { name } }
  return null
}

function kindToType(kind) {
  if (kind === 'status' || kind === 'select') return kind
  return 'checkbox'
}

/** 日期属性的值对象；区间端点相同就退化成单日。 */
function dateValue(start, end) {
  if (!start) return null
  if (!end || end === start) return { start }
  return { start, end }
}

function normalizePage(page, cfg) {
  if (!page || page.object !== 'page') return null
  const props = page.properties || {}
  const title = readTitle(props, cfg.titleProperty, 'Name') || readTitle(props, 'Name', 'title')
  const range = readRange(props, cfg.dateProperty)
  return {
    notionPageId: page.id,
    title: title || '(无标题)',
    done: readDone(props, cfg),
    startDate: range.start,
    endDate: range.end,
    notionUrl: page.url || null,
    editedAt: page.last_edited_time || null,
  }
}

/**
 * 拉最近改动的一批页（最多 pages×100 条，默认 3 页）。
 *
 * 为什么不按日期过滤：Notion 的 date 过滤器在「区间」语义上不可靠
 * （on_or_before 比对 start、on_or_after 比对 end，跨区间条目会漏），
 * 所以这里按最近编辑倒序抓一窗，区间判断交给本地做。
 */
export async function queryRecent(cfg, { pages = 3, signal } = {}) {
  const out = []
  let cursor
  for (let i = 0; i < pages; i += 1) {
    const body = {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    }
    const result = await request(cfg, `/databases/${encodeURIComponent(cfg.databaseId)}/query`, {
      method: 'POST', body, signal,
    })
    for (const page of result.results || []) {
      const norm = normalizePage(page, cfg)
      if (norm) out.push(norm)
    }
    if (!result.has_more || !result.next_cursor) break
    cursor = result.next_cursor
  }
  return out
}

/** 改一页的完成态。 */
export async function setPageDone(cfg, pageId, done, signal) {
  const page = await request(cfg, `/pages/${encodeURIComponent(pageId)}`, { signal })
  const payload = donePayload(page.properties || {}, cfg, done)
  if (!payload) {
    throw new NotionError(
      `数据库里没有名为「${cfg.doneProperty}」的完成态属性——请在插件配置里改成你库里真实的属性名`,
      400, null,
    )
  }
  const updated = await request(cfg, `/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    body: { properties: { [cfg.doneProperty]: payload } },
    signal,
  })
  return normalizePage(updated, cfg)
}

/** 把一页移入/移出回收站（删除条目时同步用）。 */
export async function setPageArchived(cfg, pageId, archived, signal) {
  return request(cfg, `/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    body: archived ? { archived: true } : { archived: false },
    signal,
  })
}

/** 改一页的时间轴。 */
export async function setPageRange(cfg, pageId, startDate, endDate, signal) {
  const updated = await request(cfg, `/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    body: { properties: { [cfg.dateProperty]: { date: dateValue(startDate, endDate) } } },
    signal,
  })
  return normalizePage(updated, cfg)
}

/** 新建一页。 */
export async function createPage(cfg, { title, startDate, endDate, note, done }, signal) {
  const properties = {
    [cfg.titleProperty]: { title: [{ type: 'text', text: { content: title } }] },
  }
  if (cfg.dateProperty) properties[cfg.dateProperty] = { date: dateValue(startDate, endDate) }
  const kind = kindToType(cfg.doneKind)
  if (kind === 'checkbox') properties[cfg.doneProperty] = { checkbox: Boolean(done) }
  else if (kind === 'status') properties[cfg.doneProperty] = { status: { name: done ? cfg.doneTrue : cfg.doneFalse } }
  else properties[cfg.doneProperty] = { select: { name: done ? cfg.doneTrue : cfg.doneFalse } }

  const page = await request(cfg, '/pages', {
    method: 'POST',
    body: { parent: { database_id: cfg.databaseId }, properties, ...(note ? bodyBlocks(note, []) : {}) },
    signal,
  })
  return normalizePage(page, cfg)
}

// ── 页面 body（备注 + 媒体） ──────────────────────────────────────────────

const MAX_BLOCKS = 100
const MAX_TEXT_BLOCK = 1800

function bodyBlocks(note, mediaBlocks) {
  const children = []
  const text = String(note || '').trim()
  if (text) {
    // 按段切，单块不超过 Notion 的 2000 字符上限
    const paragraphs = text.split(/\n{2,}/)
    for (const para of paragraphs) {
      let rest = para
      while (rest.length > 0 && children.length < MAX_BLOCKS) {
        const chunk = rest.slice(0, MAX_TEXT_BLOCK)
        rest = rest.slice(MAX_TEXT_BLOCK)
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        })
      }
      if (children.length >= MAX_BLOCKS) break
    }
  }
  for (const b of mediaBlocks) {
    if (children.length >= MAX_BLOCKS) break
    children.push(b)
  }
  return children.length ? { children } : {}
}

/** 传一个文件进 Notion，返回 file_upload id。 */
export async function uploadFile(cfg, { buffer, filename, contentType }) {
  const created = await request(cfg, '/file_uploads', {
    method: 'POST',
    body: { mode: 'single_part', filename, content_type: contentType || 'application/octet-stream' },
  })
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: contentType || 'application/octet-stream' }), filename)
  const res = await fetch(created.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Notion-Version': cfg.version,
      // 不要手写 Content-Type：multipart 的 boundary 必须由 fetch 生成
    },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new NotionError('文件上传失败: ' + (text || res.status), res.status, null)
  }
  return created.id
}

const MEDIA_BLOCK_TYPE = { image: 'image', video: 'video', file: 'file' }

/** 页面 body 的内容指纹：用来判断「这里的内容还是不是我们上次写的那份」。 */
function blocksSignature(blocks) {
  const parts = (blocks || []).map((b) => {
    const t = b.type
    if (b[t] && Array.isArray(b[t].rich_text)) return t + ':' + b[t].rich_text.map((x) => x.plain_text || '').join('')
    return t
  })
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

async function listAllChildren(cfg, pageId) {
  const out = []
  let cursor
  for (let i = 0; i < 5; i += 1) {
    const kids = await request(cfg, `/blocks/${encodeURIComponent(pageId)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
    for (const b of kids.results || []) out.push(b)
    if (!kids.has_more || !kids.next_cursor) break
    cursor = kids.next_cursor
  }
  return out
}

/**
 * 用本地备注+媒体重建页面 body。
 *
 * 会先删掉页面现有子块——所以**只对插件自己建的页面调用**，
 * 用户自己在 Notion 里写的内容绝不能被这里抹掉。
 */
export async function replacePageBody(cfg, pageId, { note, media }, readMedia, expectedSignature) {
  const warnings = []
  const existing = await listAllChildren(cfg, pageId)
  const currentSig = blocksSignature(existing)

  // 页面里的内容不是我们上次写的那份 → 一律不碰，交给用户决定。
  if (existing.length && expectedSignature && currentSig !== expectedSignature) {
    return { skipped: true, signature: currentSig, uploaded: 0, warnings: ['页面正文在 Notion 里被改过，已跳过覆盖'] }
  }
  if (existing.length && !expectedSignature) {
    return { skipped: true, signature: currentSig, uploaded: 0, warnings: ['页面正文已有内容且不是本插件写的，已跳过覆盖'] }
  }

  const mediaBlocks = []
  for (const item of media || []) {
    try {
      const buf = readMedia ? readMedia(item) : null
      if (!buf) continue
      const uploadId = await uploadFile(cfg, {
        buffer: buf.buffer ?? buf,
        filename: item.name || 'attachment',
        contentType: item.mime,
      })
      const type = MEDIA_BLOCK_TYPE[item.kind] || 'file'
      const payload = { type: 'file_upload', file_upload: { id: uploadId }, caption: [{ type: 'text', text: { content: item.name || '' } }] }
      mediaBlocks.push({ object: 'block', type, [type]: payload })
    } catch (err) {
      warnings.push(`${item.name || '附件'}: ${(err && err.message) || err}`)
    }
  }

  for (const b of existing) {
    try { await request(cfg, `/blocks/${encodeURIComponent(b.id)}`, { method: 'DELETE' }) } catch { /* 已经是空的就别管 */ }
  }

  const payload = bodyBlocks(note, mediaBlocks)
  if (payload.children) {
    await request(cfg, `/blocks/${encodeURIComponent(pageId)}/children`, { method: 'PATCH', body: payload })
  }

  const after = await listAllChildren(cfg, pageId).catch(() => [])
  return { uploaded: mediaBlocks.length, warnings, signature: blocksSignature(after) }
}

/** 找（或建）这个库的时间轴视图。Notion 的视图接口 2025-09 起可用。 */
export async function ensureTimelineView(cfg, signal) {
  const list = await request(cfg, `/views?database_id=${encodeURIComponent(cfg.databaseId)}`, { signal })
  const ids = (list.results || []).map((v) => v.id)
  let dataSourceId = null
  for (const id of ids) {
    const detail = await request(cfg, `/views/${encodeURIComponent(id)}`, { signal })
    if (detail.type === 'timeline') return { created: false, view: detail }
    if (!dataSourceId && detail.data_source_id) dataSourceId = detail.data_source_id
  }
  // 没有就用现有视图的 data_source_id 建一个（创建时必须同时给 database_id 和 data_source_id）
  if (!dataSourceId) {
    const db = await request(cfg, `/databases/${encodeURIComponent(cfg.databaseId)}`, { signal })
    dataSourceId = db.data_source_id || (Array.isArray(db.data_sources) && db.data_sources[0] && db.data_sources[0].id) || null
  }
  if (!dataSourceId) throw new NotionError('拿不到 data_source_id，无法创建时间轴视图', 400, null)

  const db = await request(cfg, `/databases/${encodeURIComponent(cfg.databaseId)}`, { signal })
  const dateEntry = Object.entries(db.properties || {}).find(([, v]) => v.type === 'date')
  if (!dateEntry) throw new NotionError(`数据库里没有 date 类型的「${cfg.dateProperty}」属性，时间轴视图建不了`, 400, null)
  const [, dateProp] = dateEntry

  const view = await request(cfg, '/views', {
    method: 'POST',
    body: {
      database_id: cfg.databaseId,
      data_source_id: dataSourceId,
      name: '时间轴',
      type: 'timeline',
      configuration: { type: 'timeline', date_property_id: dateProp.id },
    },
    signal,
  })

  // 建库时 Notion 会自动塞一个 table 视图，它会让「打开库」落到表格上。
  // 只删名字是默认名的那张表（用户自己建的表视图不动），让这个库默认就是甘特。
  const DEFAULT_TABLE_NAMES = ['Default view', '默认视图', '表格']
  for (const id of ids) {
    try {
      const d = await request(cfg, `/views/${encodeURIComponent(id)}`, { signal })
      if (d.type === 'table' && DEFAULT_TABLE_NAMES.includes(d.name)) {
        await request(cfg, `/views/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
      }
    } catch { /* 删不掉就留着，不影响甘特可用 */ }
  }

  return { created: true, view }
}

/** 连通性自检。 */
export async function verify(cfg, signal) {
  const db = await request(cfg, `/databases/${encodeURIComponent(cfg.databaseId)}`, { signal })
  const title = Array.isArray(db.title)
    ? db.title.map((t) => t.plain_text || '').join('').trim()
    : ''
  return { databaseTitle: title || '(未命名数据库)', propertyNames: Object.keys(db.properties || {}) }
}
