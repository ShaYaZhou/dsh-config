import { extractMessageText } from './automation.js'

export const MEMORY_PARENT_RECORD = 'plugin:dsh-memory/parent'

const denyChinese = /(?:不要|不得|不|禁止|别)[^。！？\n]{0,80}(?:写(?:入)?(?:任何)?(?:长期)?记忆|保存(?:到)?(?:长期)?记忆|记录(?:到)?(?:长期)?记忆|记住本次|记住这次)/u
const denyEnglish = /\b(?:do\s+not|don't|never)\s+(?:write|save|store|persist)(?:\s+[\w-]+){0,4}\s+memor(?:y|ies)\b|\bno\s+(?:long[- ]term\s+)?memory\s+writes?\b/i
const restriction = (text) => denyChinese.test(text) || denyEnglish.test(text)

export function forbidsMemoryWrites(text) {
  const direct = String(text)
    .replace(/```[\s\S]*?```|`[^`\n]*`/g, '')
    .replace(/^\s*>[^\n]*$/gm, '')
    .replace(/“[^”\n]*”|「[^」\n]*」|‘[^’\n]*’|"[^"\n]*"|(?<![\p{L}\p{N}_])'[^'\n]*'(?![\p{L}\p{N}_])/gu,
      (quote) => restriction(quote.slice(1, -1)) ? '' : quote.slice(1, -1))
  return restriction(direct)
}

function messages(events) {
  return events.flatMap((event) => event.type === 'user/message'
    ? [event.data]
    : event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : [])
}

// Restrictions remain sticky in this history so a later summary cannot backfill it.
export class MemoryWritePolicy {
  constructor(readSession, appendRecord) {
    this.readSession = readSession
    this.appendRecord = appendRecord
  }

  inherit(parent, child) {
    if (!parent?.id || !child?.id || parent.id === child.id) throw new Error('memory: invalid parent relationship')
    this.appendRecord(child, MEMORY_PARENT_RECORD, { parentSessionId: parent.id })
  }

  async allowed(session, ancestors = new Set()) {
    const id = typeof session === 'string' ? session : session?.id
    if (!id || ancestors.has(id) || ancestors.size >= 64) return false
    const seen = new Set(ancestors).add(id)
    try {
      const { events, header } = await this.readSession(session)
      const input = messages(events)
      if (input.some((message) => message.source?.kind === 'user' && forbidsMemoryWrites(extractMessageText(message)))) return false
      const parents = new Set(events
        .filter((event) => event.type === MEMORY_PARENT_RECORD)
        .map((event) => event.data.parentSessionId))
      if (header?.parentSession) parents.add(header.parentSession)
      // Older fresh linked sessions already identify their coordinator in the first relay.
      const first = input[0]?.source
      if (first?.kind === 'agent-message' && first.form === 'relay' && first.senderSessionId) parents.add(first.senderSessionId)
      for (const parent of parents) if (!await this.allowed(parent, seen)) return false
      return true
    } catch {
      return false
    }
  }

  async assertWritable(session) {
    if (!await this.allowed(session)) throw new Error('memory: this session or its parent forbids memory writes (or its policy cannot be verified)')
  }
}
