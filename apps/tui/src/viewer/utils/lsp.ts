import * as v from 'valibot'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const positionSchema = v.object({ line: v.number(), character: v.number() })
const rangeSchema = v.object({ start: positionSchema, end: positionSchema })
const diagnosticSchema = v.object({
  range: rangeSchema,
  message: v.string(),
  severity: v.optional(v.number()),
  source: v.optional(v.string()),
  code: v.optional(v.union([v.string(), v.number()])),
})
export const diagnosticsSchema = v.object({
  uri: v.string(),
  diagnostics: v.array(diagnosticSchema),
})
export type ViewerDiagnostic = v.InferOutput<typeof diagnosticSchema>
export type ViewerDiagnostics = {
  readonly path: string
  readonly status: 'loading' | 'ready' | 'unavailable' | 'failed'
  readonly message: string | null
  readonly items: readonly ViewerDiagnostic[]
}

const markedStringSchema = v.union([v.string(), v.object({ value: v.string() })])
const hoverSchema = v.nullable(
  v.object({ contents: v.union([markedStringSchema, v.array(markedStringSchema)]) }),
)
export function hoverText(value: unknown) {
  const parsed = v.parse(hoverSchema, value)
  if (!parsed) return 'No hover information at this position.'
  const blocks = Array.isArray(parsed.contents) ? parsed.contents : [parsed.contents]
  return blocks.map((block) => (typeof block === 'string' ? block : block.value)).join('\n\n')
}

const locationSchema = v.object({ uri: v.string(), range: rangeSchema })
const locationLinkSchema = v.object({ targetUri: v.string(), targetSelectionRange: rangeSchema })
const definitionSchema = v.nullable(
  v.union([locationSchema, v.array(v.union([locationSchema, locationLinkSchema]))]),
)
export function definitionLocations(value: unknown, workspaceRoot: string) {
  const parsed = v.parse(definitionSchema, value)
  if (!parsed) return []
  const locations = Array.isArray(parsed) ? parsed : [parsed]
  return locations.flatMap((location) => {
    const uri = 'uri' in location ? location.uri : location.targetUri
    if (!uri.startsWith('file:')) return []
    const relative = path.relative(workspaceRoot, fileURLToPath(uri))
    if (relative.startsWith('../') || path.isAbsolute(relative)) return []
    const range = 'range' in location ? location.range : location.targetSelectionRange
    return [{ path: relative, line: range.start.line + 1, character: range.start.character }]
  })
}
