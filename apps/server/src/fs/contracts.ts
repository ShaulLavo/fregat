import {
  workspaceAddressIdSchema,
  workspaceSearchGlobPatterns,
  type WorkspaceResourcePrecondition,
} from '@workspace/contracts'
import * as v from 'valibot'

export const pathSchema = v.pipe(v.string(), v.maxLength(4096))
const depthQueryValueSchema = integerQueryValueSchema('1', 10)
const limitQueryValueSchema = integerQueryValueSchema('50', 200)
const recentLimitQueryValueSchema = integerQueryValueSchema('20', 50)
const entryTypeQueryValueSchema = v.union([
  v.literal('file'),
  v.literal('directory'),
  v.literal('symlink'),
  v.literal('other'),
])
export const booleanQueryValueSchema = v.pipe(
  v.union([v.literal('true'), v.literal('false'), v.literal('1'), v.literal('0')]),
  v.transform((value) => value === 'true' || value === '1'),
)
const matchModeQueryValueSchema = v.union([
  v.literal('literal'),
  v.literal('regex'),
  v.literal('fuzzy'),
])
const pickerModeQueryValueSchema = v.union([v.literal('file'), v.literal('folder')])
const globQueryValueSchema = v.pipe(
  v.union([v.string(), v.array(v.string())]),
  v.transform((value) => workspaceSearchGlobPatterns(value)),
)

export const treeEntrySchema = v.object({
  canonicalPath: v.optional(pathSchema),
  name: v.string(),
  path: pathSchema,
  type: entryTypeQueryValueSchema,
  targetType: v.optional(entryTypeQueryValueSchema),
  size: v.number(),
  mtimeMs: v.number(),
  birthtimeMs: v.number(),
  version: v.string(),
})

export const pathQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
})

export const readQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  acceptTextOnly: v.optional(booleanQueryValueSchema),
})

export const treeQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  depth: v.optional(depthQueryValueSchema, '1'),
  entryType: v.optional(entryTypeQueryValueSchema),
})

export const searchQuerySchema = v.object({
  path: v.optional(pathSchema, ''),
  query: v.string(),
  limit: v.optional(limitQueryValueSchema, '50'),
  caseSensitive: v.optional(booleanQueryValueSchema, 'false'),
  excludeGlobs: v.optional(globQueryValueSchema),
  fileLimit: v.optional(limitQueryValueSchema),
  includeContent: v.optional(booleanQueryValueSchema, 'false'),
  includeGlobs: v.optional(globQueryValueSchema),
  includeNames: v.optional(booleanQueryValueSchema, 'true'),
  entryType: v.optional(entryTypeQueryValueSchema),
  matchMode: v.optional(matchModeQueryValueSchema, 'literal'),
  maxDepth: v.optional(depthQueryValueSchema),
  streamNameMatchesEarly: v.optional(booleanQueryValueSchema, 'true'),
  useWorkspaceIndex: v.optional(booleanQueryValueSchema, 'true'),
  wholeWord: v.optional(booleanQueryValueSchema, 'false'),
})

const workspaceSearchSourceSchema = v.union([v.literal('disk'), v.literal('open-buffer')])
const workspaceSearchProviderSourceSchema = v.union([
  v.literal('fallback'),
  v.literal('fd'),
  v.literal('index'),
  v.literal('rg'),
])
const workspaceSearchIndexReadinessSchema = v.union([
  v.literal('cold'),
  v.literal('building'),
  v.literal('ready'),
  v.literal('stale'),
  v.literal('failed'),
])
const workspaceSearchIndexFallbackReasonSchema = v.union([
  v.literal('building'),
  v.literal('cold'),
  v.literal('disabled'),
  v.literal('failed'),
  v.literal('regex-name-query'),
  v.literal('root-mismatch'),
  v.literal('stale'),
])

export const workspaceSearchMatchSchema = v.object({
  birthtimeMs: v.optional(v.number()),
  column: v.optional(v.number()),
  endColumn: v.optional(v.number()),
  kind: v.union([v.literal('name'), v.literal('content')]),
  line: v.optional(v.number()),
  mtimeMs: v.optional(v.number()),
  path: pathSchema,
  preview: v.optional(v.string()),
  previewStartColumn: v.optional(v.number()),
  size: v.optional(v.number()),
  source: workspaceSearchSourceSchema,
  targetType: v.optional(entryTypeQueryValueSchema),
  type: entryTypeQueryValueSchema,
})

const workspaceSearchProviderMeasurementSchema = v.object({
  durationMs: v.number(),
  firstResultMs: v.optional(v.number()),
  resultCount: v.number(),
  source: workspaceSearchProviderSourceSchema,
  statCallCount: v.number(),
  statDurationMs: v.number(),
})

const workspaceSearchStatPathCountSchema = v.object({
  count: v.number(),
  durationMs: v.number(),
  path: pathSchema,
})

const workspaceSearchIndexMeasurementSchema = v.object({
  fallbackReason: v.optional(workspaceSearchIndexFallbackReasonSchema),
  pendingCreatedPathCount: v.number(),
  readiness: v.optional(workspaceSearchIndexReadinessSchema),
  staleEntryCount: v.number(),
  used: v.boolean(),
})

const workspaceSearchMeasurementSchema = v.object({
  durationMs: v.number(),
  firstResultMs: v.optional(v.number()),
  providerSources: v.array(workspaceSearchProviderSourceSchema),
  providers: v.array(workspaceSearchProviderMeasurementSchema),
  repeatedStatPathCount: v.number(),
  statCallCount: v.number(),
  statDurationMs: v.number(),
  statPathCount: v.number(),
  topStatPaths: v.array(workspaceSearchStatPathCountSchema),
  workspaceIndex: v.optional(workspaceSearchIndexMeasurementSchema),
})

const workspaceSearchDoneEventSchema = v.object({
  count: v.number(),
  measurement: v.optional(workspaceSearchMeasurementSchema),
  path: pathSchema,
  query: v.string(),
  truncated: v.boolean(),
  type: v.literal('done'),
})

export const workspaceSearchEventSchema = v.variant('type', [
  v.object({
    match: workspaceSearchMatchSchema,
    type: v.literal('match'),
  }),
  workspaceSearchDoneEventSchema,
  v.object({
    code: v.string(),
    message: v.string(),
    type: v.literal('error'),
  }),
])

export const eventsQuerySchema = v.object({
  path: v.optional(pathSchema),
  paths: v.optional(v.union([v.string(), v.array(pathSchema)])),
})

export const recentsQuerySchema = v.object({
  limit: v.optional(recentLimitQueryValueSchema, '20'),
  mode: pickerModeQueryValueSchema,
  showHidden: booleanQueryValueSchema,
})

export const recordRecentBodySchema = v.object({
  path: pathSchema,
})

export const openWorkspaceRootBodySchema = v.object({
  generation: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  path: pathSchema,
})

export const registerWorkspaceAddressBodySchema = v.object({ path: pathSchema })
export const workspaceAddressParamsSchema = v.object({ id: workspaceAddressIdSchema })

export const writeBodySchema = v.object({
  path: pathSchema,
  content: v.string(),
  baseVersion: v.optional(v.string()),
  expectedMtimeMs: v.optional(v.number()),
  origin: v.optional(v.string()),
  writeId: v.optional(v.string()),
})

export const createFileBodySchema = v.object({
  path: pathSchema,
  content: v.optional(v.string()),
  overwrite: v.optional(v.boolean()),
  origin: v.optional(v.string()),
  writeId: v.optional(v.string()),
})

export const createFolderBodySchema = v.object({
  path: pathSchema,
  recursive: v.optional(v.boolean()),
})

export const renameBodySchema = v.object({
  from: pathSchema,
  to: pathSchema,
  overwrite: v.optional(v.boolean()),
})

export const copyBodySchema = v.object({
  from: pathSchema,
  to: pathSchema,
  overwrite: v.optional(v.boolean()),
  recursive: v.optional(v.boolean()),
})

export const deleteBodySchema = v.object({
  path: pathSchema,
  recursive: v.optional(v.boolean()),
})

const workspaceEditIdSchema = v.pipe(v.string(), v.uuid())
const workspaceEditDigestSchema = v.pipe(v.string(), v.regex(/^sha256:[a-f0-9]{64}$/u))
const workspaceEditIndexSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const workspaceEditGenerationSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const workspaceEditRelativePathSchema = v.pipe(
  pathSchema,
  v.nonEmpty(),
  v.check(isWorkspaceEditRelativePath, 'WorkspaceEdit paths must be normalized relative paths'),
)
const workspaceEditWorkspaceSchema = v.pipe(
  pathSchema,
  v.check(isWorkspaceEditWorkspace, 'WorkspaceEdit workspace must be a normalized relative path'),
)
const workspaceEditSnapshotPreconditionSchema = v.strictObject({
  kind: v.literal('snapshot'),
  mtimeMs: v.pipe(v.number(), v.finite(), v.minValue(0)),
  version: v.pipe(v.string(), v.nonEmpty()),
})
const workspaceEditMissingPreconditionSchema = v.strictObject({
  kind: v.literal('missing'),
})
const workspaceEditTransactionPreconditionSchema = v.strictObject({
  afterOperation: workspaceEditIndexSchema,
  kind: v.literal('transaction'),
})
const workspaceEditExistingPreconditionSchema = v.union([
  workspaceEditSnapshotPreconditionSchema,
  workspaceEditTransactionPreconditionSchema,
])
const workspaceEditPreconditionSchema = v.union([
  workspaceEditMissingPreconditionSchema,
  workspaceEditSnapshotPreconditionSchema,
  workspaceEditTransactionPreconditionSchema,
])
const workspaceEditWriteOperationSchema = v.strictObject({
  expected: workspaceEditExistingPreconditionSchema,
  index: workspaceEditIndexSchema,
  kind: v.literal('write'),
  path: workspaceEditRelativePathSchema,
  text: v.string(),
})
const workspaceEditCreateOperationSchema = v.strictObject({
  destination: workspaceEditPreconditionSchema,
  ignoreIfExists: v.boolean(),
  index: workspaceEditIndexSchema,
  kind: v.literal('create'),
  overwrite: v.boolean(),
  path: workspaceEditRelativePathSchema,
})
const workspaceEditRenameOperationSchema = v.strictObject({
  destination: workspaceEditPreconditionSchema,
  ignoreIfExists: v.boolean(),
  index: workspaceEditIndexSchema,
  kind: v.literal('rename'),
  newPath: workspaceEditRelativePathSchema,
  oldPath: workspaceEditRelativePathSchema,
  overwrite: v.boolean(),
  source: workspaceEditExistingPreconditionSchema,
})
const workspaceEditDeleteOperationSchema = v.strictObject({
  expected: workspaceEditPreconditionSchema,
  ignoreIfNotExists: v.boolean(),
  index: workspaceEditIndexSchema,
  kind: v.literal('delete'),
  path: workspaceEditRelativePathSchema,
  recursive: v.boolean(),
})

export const workspacePersistenceOperationSchema = v.variant('kind', [
  workspaceEditWriteOperationSchema,
  workspaceEditCreateOperationSchema,
  workspaceEditRenameOperationSchema,
  workspaceEditDeleteOperationSchema,
])

export const workspaceEditPrepareBodySchema = v.strictObject({
  bodyDigest: workspaceEditDigestSchema,
  operationId: workspaceEditIdSchema,
  operations: v.pipe(
    v.array(workspacePersistenceOperationSchema),
    v.minLength(1),
    v.check(
      (operations) => hasValidWorkspaceEditOperationOrder(operations),
      'WorkspaceEdit operation order is invalid',
    ),
    v.readonly(),
  ),
  origin: v.literal('workspace-edit'),
  workspace: workspaceEditWorkspaceSchema,
})

export const workspaceEditTransitionBodySchema = v.strictObject({
  expectedGeneration: workspaceEditGenerationSchema,
  operationId: workspaceEditIdSchema,
  transitionId: workspaceEditIdSchema,
})

const workspaceEditRecoveryTargetSchema = v.union([
  v.literal('rolled-back'),
  v.literal('finalized'),
  v.literal('undone'),
  v.literal('redone'),
])

export const workspaceEditRecoverBodySchema = v.strictObject({
  ...workspaceEditTransitionBodySchema.entries,
  recoveryTarget: workspaceEditRecoveryTargetSchema,
})

const workspaceEditUnrecoveredPathsSchema = v.pipe(
  v.array(workspaceEditRelativePathSchema),
  v.check(
    (paths) => isCanonicalPathSet(paths),
    'WorkspaceEdit recovery paths must be sorted and unique',
  ),
  v.readonly(),
)

export const workspaceEditReleaseBodySchema = v.strictObject({
  ...workspaceEditTransitionBodySchema.entries,
  acknowledgePartial: v.optional(
    v.strictObject({
      generation: workspaceEditGenerationSchema,
      unrecoveredPaths: workspaceEditUnrecoveredPathsSchema,
    }),
  ),
})

export const workspaceEditStatusQuerySchema = v.strictObject({
  operationId: workspaceEditIdSchema,
})

export const workspaceEditRecoveryQuerySchema = v.strictObject({
  workspace: workspaceEditWorkspaceSchema,
})

const workspaceEditResultEntrySchema = v.union([
  v.strictObject({
    exists: v.literal(false),
    path: workspaceEditRelativePathSchema,
  }),
  v.strictObject({
    exists: v.literal(true),
    mtimeMs: v.pipe(v.number(), v.finite(), v.minValue(0)),
    path: workspaceEditRelativePathSchema,
    size: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    type: v.literal('file'),
    version: v.pipe(v.string(), v.nonEmpty()),
  }),
])

const workspaceEditStateSchema = v.union([
  v.literal('preparing'),
  v.literal('prepared'),
  v.literal('committed'),
  v.literal('finalized'),
  v.literal('aborted'),
  v.literal('rolled-back'),
  v.literal('undo-committed'),
  v.literal('undone'),
  v.literal('redo-committed'),
  v.literal('redone'),
  v.literal('partial'),
  v.literal('released'),
])

export const workspaceEditResultSchema = v.pipe(
  v.strictObject({
    affectedPaths: v.pipe(v.array(workspaceEditRelativePathSchema), v.readonly()),
    entries: v.pipe(v.array(workspaceEditResultEntrySchema), v.readonly()),
    eventPublication: v.union([
      v.literal('pending'),
      v.literal('published'),
      v.literal('suppressed'),
    ]),
    generation: workspaceEditGenerationSchema,
    operationId: workspaceEditIdSchema,
    recoveryTarget: v.optional(workspaceEditRecoveryTargetSchema),
    rolledBackPaths: v.pipe(v.array(workspaceEditRelativePathSchema), v.readonly()),
    serverEpoch: workspaceEditIdSchema,
    state: workspaceEditStateSchema,
    unrecoveredPaths: workspaceEditUnrecoveredPathsSchema,
  }),
  v.check(
    (result) => hasValidWorkspaceEditRecoveryResult(result),
    'WorkspaceEdit recovery result is invalid',
  ),
)

export type WriteBody = v.InferOutput<typeof writeBodySchema>
export type OpenWorkspaceRootBody = v.InferOutput<typeof openWorkspaceRootBodySchema>
export type CreateFileBody = v.InferOutput<typeof createFileBodySchema>
export type CreateFolderBody = v.InferOutput<typeof createFolderBodySchema>
export type RenameBody = v.InferOutput<typeof renameBodySchema>
export type CopyBody = v.InferOutput<typeof copyBodySchema>
export type DeleteBody = v.InferOutput<typeof deleteBodySchema>
export type RecentsQuery = v.InferOutput<typeof recentsQuerySchema>
export type WorkspaceEditPrepareBody = v.InferOutput<typeof workspaceEditPrepareBodySchema>
export type WorkspaceEditTransitionBody = v.InferOutput<typeof workspaceEditTransitionBodySchema>
export type WorkspaceEditRecoverBody = v.InferOutput<typeof workspaceEditRecoverBodySchema>
export type WorkspaceEditReleaseBody = v.InferOutput<typeof workspaceEditReleaseBodySchema>

export type { EntryTypeFilter, TreeEntry, WatchServerMessage } from '@workspace/contracts'

function integerQueryValueSchema(defaultValue: string, max: number) {
  return v.pipe(
    v.string(),
    v.toNumber(),
    v.integer(),
    v.minValue(1),
    v.toMaxValue(max),
    v.transform((value) => value || Number(defaultValue)),
  )
}

function isWorkspaceEditRelativePath(input: string) {
  if (input.includes('\\')) return false
  if (input.includes('\0')) return false
  if (input.startsWith('/')) return false
  if (/^[a-zA-Z]:/u.test(input)) return false
  if (input === '.' || input === '..') return false
  if (input.startsWith('../')) return false

  return input
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isWorkspaceEditWorkspace(input: string) {
  if (input === '') return true

  return isWorkspaceEditRelativePath(input)
}

function hasValidWorkspaceEditOperationOrder(
  operations: readonly v.InferOutput<typeof workspacePersistenceOperationSchema>[],
) {
  const currentGeneration = new Map<string, number>()
  let previousIndex = -1

  for (const operation of operations) {
    if (operation.index <= previousIndex) return false
    if (!operationPreconditionsAreValid(operation, currentGeneration)) return false

    previousIndex = operation.index
    recordOperationGeneration(operation, currentGeneration)
  }

  return true
}

function operationPreconditionsAreValid(
  operation: v.InferOutput<typeof workspacePersistenceOperationSchema>,
  currentGeneration: ReadonlyMap<string, number>,
) {
  if (operation.kind === 'write') {
    return preconditionIsValid(
      operation.expected,
      operation.path,
      operation.index,
      currentGeneration,
    )
  }
  if (operation.kind === 'create') {
    return preconditionIsValid(
      operation.destination,
      operation.path,
      operation.index,
      currentGeneration,
    )
  }
  if (operation.kind === 'delete') {
    return preconditionIsValid(
      operation.expected,
      operation.path,
      operation.index,
      currentGeneration,
    )
  }

  if (
    !preconditionIsValid(operation.source, operation.oldPath, operation.index, currentGeneration)
  ) {
    return false
  }

  return preconditionIsValid(
    operation.destination,
    operation.newPath,
    operation.index,
    currentGeneration,
  )
}

function preconditionIsValid(
  precondition: WorkspaceResourcePrecondition,
  path: string,
  operationIndex: number,
  currentGeneration: ReadonlyMap<string, number>,
) {
  const generation = currentGeneration.get(path)
  if (precondition.kind !== 'transaction') return generation === undefined
  if (precondition.afterOperation >= operationIndex) return false

  return generation === precondition.afterOperation
}

function recordOperationGeneration(
  operation: v.InferOutput<typeof workspacePersistenceOperationSchema>,
  currentGeneration: Map<string, number>,
) {
  if (operation.kind === 'rename') {
    currentGeneration.set(operation.oldPath, operation.index)
    currentGeneration.set(operation.newPath, operation.index)
    return
  }

  currentGeneration.set(operation.path, operation.index)
}

function isCanonicalPathSet(paths: readonly string[]) {
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index - 1]! >= paths[index]!) return false
  }

  return true
}

function hasValidWorkspaceEditRecoveryResult(result: {
  recoveryTarget?: string
  state: string
  unrecoveredPaths: readonly string[]
}) {
  if (result.state === 'partial') {
    if (!result.recoveryTarget) return false
    return result.unrecoveredPaths.length > 0
  }
  if (result.recoveryTarget !== undefined) return false

  return result.unrecoveredPaths.length === 0
}
