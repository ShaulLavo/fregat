import * as v from 'valibot'
import type { KeyValueStorage } from '@workspace/client-core/storage'

export const workbenchPanes = ['files', 'git', 'search', 'terminal', 'problems', 'logs'] as const
export type WorkbenchPane = (typeof workbenchPanes)[number]

const locationSchema = v.object({
  kind: v.literal('workbench'),
  rootPath: v.string(),
  pane: v.picklist(workbenchPanes),
  path: v.optional(v.string()),
  tree: v.optional(v.boolean()),
  line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
})
export type WorkbenchLocation = v.InferOutput<typeof locationSchema>

export function rememberedWorkbench(
  storage: KeyValueStorage,
  rootPath?: string,
): WorkbenchLocation | null {
  const key = rootPath === undefined ? 'workbench:last' : `workbench:location:${rootPath}`
  const value = storage.getItem(key)
  if (!value) return null
  try {
    const result = v.safeParse(locationSchema, JSON.parse(value))
    return result.success ? result.output : null
  } catch {
    return null
  }
}

export function rememberWorkbench(storage: KeyValueStorage, location: WorkbenchLocation) {
  const value = JSON.stringify(location)
  storage.setItem('workbench:last', value)
  storage.setItem(`workbench:location:${location.rootPath}`, value)
}
