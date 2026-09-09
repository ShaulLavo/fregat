import * as v from 'valibot'
import type { KeyValueStorage } from '@workspace/client-core/storage'

const tabsSchema = v.object({
  ids: v.array(v.pipe(v.string(), v.minLength(1))),
  selected: v.nullable(v.string()),
})
export type TerminalTabs = v.InferOutput<typeof tabsSchema>

export function readTerminalTabs(storage: KeyValueStorage, rootPath: string): TerminalTabs {
  const raw = storage.getItem(`terminal-tabs:${rootPath}`)
  if (raw === null) {
    const id = crypto.randomUUID()
    return { ids: [id], selected: id }
  }
  const parsed = v.parse(tabsSchema, JSON.parse(raw))
  return {
    ids: parsed.ids,
    selected: parsed.ids.find((id) => id === parsed.selected) ?? parsed.ids[0] ?? null,
  }
}

export function saveTerminalTabs(storage: KeyValueStorage, rootPath: string, tabs: TerminalTabs) {
  storage.setItem(`terminal-tabs:${rootPath}`, JSON.stringify(tabs))
}

export function nextTerminal(tabs: TerminalTabs, direction: number) {
  const index = tabs.ids.findIndex((id) => id === tabs.selected)
  return tabs.ids[(index + direction + tabs.ids.length) % tabs.ids.length] ?? null
}
