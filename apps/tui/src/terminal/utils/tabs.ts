import * as v from 'valibot'
import type { KeyValueStorage } from '@workspace/client-core/storage'
import { recordObservabilityWarning } from '@workspace/observability'
import type { FileStorage } from '@/storage/files'

const tabsSchema = v.object({
  ids: v.array(v.pipe(v.string(), v.minLength(1))),
  selected: v.nullable(v.string()),
})
export type TerminalTabs = v.InferOutput<typeof tabsSchema>

export function readTerminalTabs(
  storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue'>,
  rootPath: string,
): TerminalTabs {
  const key = `terminal-tabs:${rootPath}`
  let raw = storage.getItem(key)
  while (raw !== null) {
    const tabs = readTabsValue(storage, key, raw)
    if (tabs !== null) return tabs
    raw = storage.getItem(key)
  }
  return freshTerminalTabs()
}

function readTabsValue(storage: Pick<FileStorage, 'removeItemIfValue'>, key: string, raw: string) {
  try {
    const parsed = v.parse(tabsSchema, JSON.parse(raw))
    return {
      ids: parsed.ids,
      selected: parsed.ids.find((id) => id === parsed.selected) ?? parsed.ids[0] ?? null,
    }
  } catch {
    if (!storage.removeItemIfValue(key, raw)) return null
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: key,
      outcome: 'discarded',
    })
    return freshTerminalTabs()
  }
}

function freshTerminalTabs(): TerminalTabs {
  const id = crypto.randomUUID()
  return { ids: [id], selected: id }
}

export function saveTerminalTabs(storage: KeyValueStorage, rootPath: string, tabs: TerminalTabs) {
  storage.setItem(`terminal-tabs:${rootPath}`, JSON.stringify(tabs))
}

export function nextTerminal(tabs: TerminalTabs, direction: number) {
  const index = tabs.ids.findIndex((id) => id === tabs.selected)
  return tabs.ids[(index + direction + tabs.ids.length) % tabs.ids.length] ?? null
}
