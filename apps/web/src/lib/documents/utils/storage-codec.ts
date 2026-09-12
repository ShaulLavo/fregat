import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import { toWorkspaceAbsolute, toWorkspaceRelative } from '@workspace/client-core/files/path'
import { durableTab } from '@/lib/documents/utils/capabilities'
import {
  conflictId,
  fileDocument,
  fileResource,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { TabContent, WorkspaceRoot } from '@/lib/documents/utils/types'

const textSchema = v.pipe(
  v.string(),
  v.check((value) => !value.includes('\0')),
)
const pathSchema = v.pipe(textSchema, v.transform(filesystemPath))
const nonemptySchema = v.pipe(textSchema, v.minLength(1))
const resourceSchema = v.strictObject({ path: pathSchema })
const statusSchema = v.picklist([
  'added',
  'deleted',
  'ignored',
  'modified',
  'renamed',
  'untracked',
  'unmodified',
  'conflicted',
])
const revisionEntries = {
  oldObjectId: v.optional(textSchema),
  newObjectId: v.optional(textSchema),
  oldPath: v.optional(pathSchema),
  status: v.optional(statusSchema),
}
const checkpointEntries = {
  ...revisionEntries,
  owner: pathSchema,
  sessionId: sessionIdSchema,
  fromTurnCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  toTurnCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
}
const comparisonSchema = v.pipe(
  v.variant('kind', [
    v.strictObject({
      ...revisionEntries,
      kind: v.literal('snapshot'),
      path: pathSchema,
      source: v.optional(v.picklist(['staged', 'worktree'])),
    }),
    v.strictObject({
      ...checkpointEntries,
      kind: v.literal('checkpoint-file'),
      file: resourceSchema,
    }),
    v.strictObject({ ...checkpointEntries, kind: v.literal('checkpoint-session') }),
    v.strictObject({ ...checkpointEntries, kind: v.literal('checkpoint-turn') }),
  ]),
  v.check((source) =>
    source.kind === 'snapshot'
      ? Boolean(source.oldObjectId || source.newObjectId)
      : source.toTurnCount >= source.fromTurnCount,
  ),
)
const storedDocumentSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('file'), relativePath: nonemptySchema }),
  v.strictObject({
    kind: v.literal('git-ref'),
    source: v.strictObject({ path: pathSchema, ref: nonemptySchema }),
  }),
  v.strictObject({ kind: v.literal('git-diff'), source: comparisonSchema }),
  v.strictObject({ kind: v.literal('compare-saved'), file: resourceSchema }),
  v.strictObject({ kind: v.literal('search'), root: pathSchema }),
  v.strictObject({
    kind: v.literal('conflict'),
    conflictId: v.pipe(nonemptySchema, v.transform(conflictId)),
  }),
])

export const storedTabContentSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('settings') }),
  v.strictObject({ kind: v.literal('document'), document: storedDocumentSchema }),
])

export type StoredTabContent = v.InferOutput<typeof storedTabContentSchema>

export function encodeTabContent(
  content: TabContent,
  root: WorkspaceRoot,
): StoredTabContent | null {
  if (!durableTab(content, root)) return null
  if (content.kind === 'settings') return content
  if (content.document.kind !== 'file') return { kind: 'document', document: content.document }

  const relativePath = toWorkspaceRelative(root, content.document.resource.path)
  if (relativePath === null) return null
  return { kind: 'document', document: { kind: 'file', relativePath } }
}

export function decodeTabContent(input: unknown, root: WorkspaceRoot): TabContent | null {
  const parsed = v.safeParse(storedTabContentSchema, input)
  if (!parsed.success) return null
  const stored = parsed.output
  if (stored.kind === 'settings') return stored
  if (stored.document.kind !== 'file') {
    const content: TabContent = { kind: 'document', document: stored.document }
    return durableTab(content, root) ? content : null
  }

  const path = toWorkspaceAbsolute(root, stored.document.relativePath)
  if (path === null) return null
  const content = documentTab(fileDocument(fileResource(filesystemPath(path))))
  return durableTab(content, root) ? content : null
}
