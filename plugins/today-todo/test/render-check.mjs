import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('/tmp/ttrender/package.json')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const snapshot = JSON.parse(fs.readFileSync('/tmp/ttrender/snapshot.json', 'utf8'))
const range = JSON.parse(fs.readFileSync('/tmp/ttrender/range.json', 'utf8'))

globalThis.window = { __ModuleLoader__: { load(spec) { globalThis.__spec = spec } } }
globalThis.document = { hidden: false }
globalThis.fetch = async (url) => {
  const u = String(url)
  const body = u.includes('from=') ? range : snapshot
  return { ok: true, json: async () => body }
}

await import('/tmp/ttrender/client.test.mjs')
const spec = globalThis.__spec
const mod = spec.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})

const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : (() => {}) },
  locale: { register: () => () => {}, getLocale: () => ({ active: 'zh' }) },
  layout: { selectPanel: () => {} },
  slots: { inject: (k, cb) => { cb(); return () => {} }, register: () => () => {} },
}
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 60))

const { TodoPanel, TimelineView, state } = mod.__hook
console.log('state.data 已注入:', Boolean(state.data), '| tasks:', state.data && state.data.tasks.length)

const h = React.createElement
let fails = 0
const check = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL'), name, extra || ''); if (!ok) fails++ }

// 1) 列表视图
let html = ''
try {
  html = renderToStaticMarkup(h(TodoPanel))
  check('列表视图渲染', html.includes('今日待办'))
  check('列表：分段控件「时间轴」', html.includes('时间轴'))
  const anyRow = [...(snapshot.tasks || []), ...(snapshot.upcoming || [])][0]
  check('列表：日期 chip', Boolean(anyRow) && html.includes(anyRow.startDate), anyRow ? anyRow.startDate : '(无任务)')
} catch (e) {
  check('列表视图渲染', false, String(e.message))
}

// 2) 时间轴视图（用户点按钮后才会走到这里）
state.timeline = range
try {
  html = renderToStaticMarkup(h(TimelineView, { anchor: range.today }))
  check('时间轴视图渲染', html.includes('dswtt-tl-bar'))
  check('时间轴：今天列高亮', html.includes('is-today'))
  const firstRow = (range.tasks || [])[0]
  check('时间轴：色条含标题', Boolean(firstRow) && html.includes(firstRow.title), firstRow ? firstRow.title : '(无任务)')
  check('时间轴：21 天列头', (html.match(/dswtt-tl-day/g) || []).length >= 21)
  check('时间轴：今天竖线', html.includes('dswtt-tl-today'))
} catch (e) {
  check('时间轴视图渲染', false, String(e.message))
}

console.log(fails === 0 ? '\n全部通过' : `\n失败 ${fails} 项`)
process.exit(fails === 0 ? 0 : 1)
