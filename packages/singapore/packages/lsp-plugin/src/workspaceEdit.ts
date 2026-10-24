export type ParsedWorkspaceEdit = {
  readonly annotations: ReadonlyMap<string, WorkspaceEditAnnotation>
  readonly operations: readonly WorkspaceEditOperation[]
}

export type WorkspaceEditAnnotation = {
  readonly description?: string
  readonly label: string
  readonly needsConfirmation: boolean
}

export type ParsedWorkspacePosition = {
  readonly character: number
  readonly line: number
}

export type ParsedWorkspaceTextEdit = {
  readonly annotationId?: string
  readonly newText: string
  readonly range: {
    readonly end: ParsedWorkspacePosition
    readonly start: ParsedWorkspacePosition
  }
}

export type WorkspaceEditOperation =
  | {
      readonly annotationId?: string
      readonly edits: readonly ParsedWorkspaceTextEdit[]
      readonly kind: 'text-document'
      readonly uri: string
      readonly version: number | null
    }
  | {
      readonly annotationId?: string
      readonly ignoreIfExists: boolean
      readonly kind: 'create'
      readonly overwrite: boolean
      readonly uri: string
    }
  | {
      readonly annotationId?: string
      readonly ignoreIfExists: boolean
      readonly kind: 'rename'
      readonly newUri: string
      readonly oldUri: string
      readonly overwrite: boolean
    }
  | {
      readonly annotationId?: string
      readonly ignoreIfNotExists: boolean
      readonly kind: 'delete'
      readonly recursive: boolean
      readonly uri: string
    }

export type WorkspaceEditFailure = {
  readonly code: WorkspaceEditFailureCode
  readonly editIndex?: number
  readonly operationIndex?: number
  readonly reason: string
}

export type WorkspaceEditFailureCode =
  | 'ambiguous-inserts'
  | 'invalid-annotation'
  | 'invalid-position'
  | 'invalid-workspace-edit'
  | 'overlapping-edits'
  | 'reversed-range'
  | 'snapshot-drift'
  | 'unsupported-snippet'
  | 'version-mismatch'

export type ParseWorkspaceEditResult = ParseResult<ParsedWorkspaceEdit>

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: WorkspaceEditFailure; readonly ok: false }

type UnknownRecord = Readonly<Record<string, unknown>>

const EMPTY_OPERATIONS: readonly WorkspaceEditOperation[] = Object.freeze([])

export function parseWorkspaceEdit(input: unknown): ParseWorkspaceEditResult {
  if (input === null || input === undefined) return emptyWorkspaceEdit()
  if (!isRecord(input)) return invalidWorkspaceEdit('WorkspaceEdit must be an object')

  const annotations = parseAnnotations(input)
  if (!annotations.ok) return annotations

  const hasChanges = hasOwn(input, 'changes')
  const hasDocumentChanges = hasOwn(input, 'documentChanges')
  if (hasChanges && hasDocumentChanges) {
    return invalidWorkspaceEdit('WorkspaceEdit cannot contain both changes and documentChanges')
  }
  if (hasDocumentChanges) return parseDocumentChanges(input.documentChanges, annotations.value)
  if (hasChanges) return parseLegacyChanges(input.changes, annotations.value)
  return workspaceEditResult(annotations.value, EMPTY_OPERATIONS)
}

function parseAnnotations(
  input: UnknownRecord,
): ParseResult<ReadonlyMap<string, WorkspaceEditAnnotation>> {
  if (!hasOwn(input, 'changeAnnotations')) return parsed(new Map())
  if (!isRecord(input.changeAnnotations)) {
    return failed('invalid-annotation', 'changeAnnotations must be an object')
  }

  const annotations = new Map<string, WorkspaceEditAnnotation>()
  for (const [id, value] of Object.entries(input.changeAnnotations)) {
    const annotation = parseAnnotation(value)
    if (!annotation.ok) return annotation
    annotations.set(id, annotation.value)
  }
  return parsed(annotations)
}

function parseAnnotation(input: unknown): ParseResult<WorkspaceEditAnnotation> {
  if (!isRecord(input) || typeof input.label !== 'string') {
    return failed('invalid-annotation', 'Every change annotation must have a string label')
  }
  if (hasOwn(input, 'needsConfirmation') && typeof input.needsConfirmation !== 'boolean') {
    return failed('invalid-annotation', 'Annotation needsConfirmation must be a boolean')
  }
  if (hasOwn(input, 'description') && typeof input.description !== 'string') {
    return failed('invalid-annotation', 'Annotation description must be a string')
  }

  const annotation: WorkspaceEditAnnotation = Object.freeze({
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    label: input.label,
    needsConfirmation: input.needsConfirmation === true,
  })
  return parsed(annotation)
}

function parseDocumentChanges(
  input: unknown,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
): ParseWorkspaceEditResult {
  if (!Array.isArray(input)) return invalidWorkspaceEdit('documentChanges must be an array')

  const operations: WorkspaceEditOperation[] = []
  for (let operationIndex = 0; operationIndex < input.length; operationIndex += 1) {
    const operation = parseOperation(input[operationIndex], annotations, operationIndex)
    if (!operation.ok) return operation
    operations.push(operation.value)
  }
  return workspaceEditResult(annotations, Object.freeze(operations))
}

function parseLegacyChanges(
  input: unknown,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
): ParseWorkspaceEditResult {
  if (!isRecord(input)) return invalidWorkspaceEdit('changes must be an object')

  const operations: WorkspaceEditOperation[] = []
  const entries = Object.entries(input).sort(([left], [right]) => compareCodeUnits(left, right))
  for (let operationIndex = 0; operationIndex < entries.length; operationIndex += 1) {
    const [uri, value] = entries[operationIndex]!
    const edits = parseTextEdits(value, annotations, operationIndex)
    if (!edits.ok) return edits
    operations.push(
      Object.freeze({ edits: edits.value, kind: 'text-document', uri, version: null }),
    )
  }
  return workspaceEditResult(annotations, Object.freeze(operations))
}

function parseOperation(
  input: unknown,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<WorkspaceEditOperation> {
  if (!isRecord(input)) {
    return invalidOperation(operationIndex, 'WorkspaceEdit operation must be an object')
  }
  if (!hasOwn(input, 'kind')) return parseTextDocumentOperation(input, annotations, operationIndex)
  if (input.kind === 'create') return parseCreateOperation(input, annotations, operationIndex)
  if (input.kind === 'rename') return parseRenameOperation(input, annotations, operationIndex)
  if (input.kind === 'delete') return parseDeleteOperation(input, annotations, operationIndex)
  return invalidOperation(operationIndex, 'WorkspaceEdit contains an unknown resource operation')
}

function parseTextDocumentOperation(
  input: UnknownRecord,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<WorkspaceEditOperation> {
  if (!isRecord(input.textDocument) || typeof input.textDocument.uri !== 'string') {
    return invalidOperation(operationIndex, 'Text document operation must have a string URI')
  }

  const version = input.textDocument.version
  if (version !== null && !Number.isInteger(version)) {
    return invalidOperation(operationIndex, 'Text document version must be an integer or null')
  }

  const annotationId = parseAnnotationReference(input, annotations, operationIndex)
  if (!annotationId.ok) return annotationId
  const edits = parseTextEdits(input.edits, annotations, operationIndex)
  if (!edits.ok) return edits

  return parsed(
    Object.freeze({
      ...optionalAnnotationId(annotationId.value),
      edits: edits.value,
      kind: 'text-document' as const,
      uri: input.textDocument.uri,
      version: version as number | null,
    }),
  )
}

function parseCreateOperation(
  input: UnknownRecord,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<WorkspaceEditOperation> {
  if (typeof input.uri !== 'string') {
    return invalidOperation(operationIndex, 'Create operation must have a string URI')
  }
  const annotationId = parseAnnotationReference(input, annotations, operationIndex)
  if (!annotationId.ok) return annotationId
  const options = parseResourceOptions(input.options, operationIndex)
  if (!options.ok) return options
  const overwrite = resourceBoolean(options.value, 'overwrite', operationIndex)
  if (!overwrite.ok) return overwrite
  const ignoreIfExists = resourceBoolean(options.value, 'ignoreIfExists', operationIndex)
  if (!ignoreIfExists.ok) return ignoreIfExists

  return parsed(
    Object.freeze({
      ...optionalAnnotationId(annotationId.value),
      ignoreIfExists: ignoreIfExists.value,
      kind: 'create' as const,
      overwrite: overwrite.value,
      uri: input.uri,
    }),
  )
}

function parseRenameOperation(
  input: UnknownRecord,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<WorkspaceEditOperation> {
  if (typeof input.oldUri !== 'string' || typeof input.newUri !== 'string') {
    return invalidOperation(operationIndex, 'Rename operation must have string oldUri and newUri')
  }
  const annotationId = parseAnnotationReference(input, annotations, operationIndex)
  if (!annotationId.ok) return annotationId
  const options = parseResourceOptions(input.options, operationIndex)
  if (!options.ok) return options
  const overwrite = resourceBoolean(options.value, 'overwrite', operationIndex)
  if (!overwrite.ok) return overwrite
  const ignoreIfExists = resourceBoolean(options.value, 'ignoreIfExists', operationIndex)
  if (!ignoreIfExists.ok) return ignoreIfExists

  return parsed(
    Object.freeze({
      ...optionalAnnotationId(annotationId.value),
      ignoreIfExists: ignoreIfExists.value,
      kind: 'rename' as const,
      newUri: input.newUri,
      oldUri: input.oldUri,
      overwrite: overwrite.value,
    }),
  )
}

function parseDeleteOperation(
  input: UnknownRecord,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<WorkspaceEditOperation> {
  if (typeof input.uri !== 'string') {
    return invalidOperation(operationIndex, 'Delete operation must have a string URI')
  }
  const annotationId = parseAnnotationReference(input, annotations, operationIndex)
  if (!annotationId.ok) return annotationId
  const options = parseResourceOptions(input.options, operationIndex)
  if (!options.ok) return options
  const recursive = resourceBoolean(options.value, 'recursive', operationIndex)
  if (!recursive.ok) return recursive
  const ignoreIfNotExists = resourceBoolean(options.value, 'ignoreIfNotExists', operationIndex)
  if (!ignoreIfNotExists.ok) return ignoreIfNotExists

  return parsed(
    Object.freeze({
      ...optionalAnnotationId(annotationId.value),
      ignoreIfNotExists: ignoreIfNotExists.value,
      kind: 'delete' as const,
      recursive: recursive.value,
      uri: input.uri,
    }),
  )
}

function parseResourceOptions(
  input: unknown,
  operationIndex: number,
): ParseResult<UnknownRecord | undefined> {
  if (input === undefined) return parsed(undefined)
  if (isRecord(input)) return parsed(input)
  return invalidOperation(operationIndex, 'Resource operation options must be an object')
}

function resourceBoolean(
  options: UnknownRecord | undefined,
  key: string,
  operationIndex: number,
): ParseResult<boolean> {
  if (!options || !hasOwn(options, key)) return parsed(false)
  if (typeof options[key] === 'boolean') return parsed(options[key])
  return invalidOperation(operationIndex, `Resource option ${key} must be a boolean`)
}

function parseTextEdits(
  input: unknown,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
): ParseResult<readonly ParsedWorkspaceTextEdit[]> {
  if (!Array.isArray(input)) {
    return invalidOperation(operationIndex, 'Text document edits must be an array')
  }

  const edits: ParsedWorkspaceTextEdit[] = []
  for (let editIndex = 0; editIndex < input.length; editIndex += 1) {
    const edit = parseTextEdit(input[editIndex], annotations, operationIndex, editIndex)
    if (!edit.ok) return edit
    edits.push(edit.value)
  }
  return parsed(Object.freeze(edits))
}

function parseTextEdit(
  input: unknown,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
  editIndex: number,
): ParseResult<ParsedWorkspaceTextEdit> {
  if (!isRecord(input)) {
    return invalidTextEdit(operationIndex, editIndex, 'Text edit must be an object')
  }
  if (hasOwn(input, 'snippet')) {
    return failed('unsupported-snippet', 'Snippet text edits are unsupported', {
      editIndex,
      operationIndex,
    })
  }
  if (typeof input.newText !== 'string') {
    return invalidTextEdit(operationIndex, editIndex, 'Text edit newText must be a string')
  }
  if (!isRecord(input.range)) {
    return invalidPosition(operationIndex, editIndex, 'Text edit range must be an object')
  }

  const start = parsePosition(input.range.start, operationIndex, editIndex)
  if (!start.ok) return start
  const end = parsePosition(input.range.end, operationIndex, editIndex)
  if (!end.ok) return end
  const annotationId = parseAnnotationReference(input, annotations, operationIndex, editIndex)
  if (!annotationId.ok) return annotationId

  return parsed(
    Object.freeze({
      ...optionalAnnotationId(annotationId.value),
      newText: input.newText,
      range: Object.freeze({ end: end.value, start: start.value }),
    }),
  )
}

function parsePosition(
  input: unknown,
  operationIndex: number,
  editIndex: number,
): ParseResult<ParsedWorkspacePosition> {
  if (!isRecord(input)) {
    return invalidPosition(operationIndex, editIndex, 'Position must be an object')
  }
  if (!isNonNegativeInteger(input.line) || !isNonNegativeInteger(input.character)) {
    return invalidPosition(
      operationIndex,
      editIndex,
      'Position line and character must be non-negative integers',
    )
  }
  return parsed(Object.freeze({ character: input.character, line: input.line }))
}

function parseAnnotationReference(
  input: UnknownRecord,
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operationIndex: number,
  editIndex?: number,
): ParseResult<string | undefined> {
  if (!hasOwn(input, 'annotationId')) return parsed(undefined)
  if (typeof input.annotationId !== 'string') {
    return failed('invalid-annotation', 'annotationId must be a string', {
      editIndex,
      operationIndex,
    })
  }
  if (annotations.has(input.annotationId)) return parsed(input.annotationId)
  return failed('invalid-annotation', `Unknown change annotation ${input.annotationId}`, {
    editIndex,
    operationIndex,
  })
}

function optionalAnnotationId(annotationId: string | undefined): {
  readonly annotationId?: string
} {
  if (annotationId === undefined) return {}
  return { annotationId }
}

function emptyWorkspaceEdit(): ParseWorkspaceEditResult {
  return workspaceEditResult(new Map(), EMPTY_OPERATIONS)
}

function workspaceEditResult(
  annotations: ReadonlyMap<string, WorkspaceEditAnnotation>,
  operations: readonly WorkspaceEditOperation[],
): ParseWorkspaceEditResult {
  return parsed(Object.freeze({ annotations, operations }))
}

function invalidWorkspaceEdit(reason: string): ParseWorkspaceEditResult {
  return failed('invalid-workspace-edit', reason)
}

function invalidOperation(operationIndex: number, reason: string): ParseResult<never> {
  return failed('invalid-workspace-edit', reason, { operationIndex })
}

function invalidTextEdit(
  operationIndex: number,
  editIndex: number,
  reason: string,
): ParseResult<never> {
  return failed('invalid-workspace-edit', reason, { editIndex, operationIndex })
}

function invalidPosition(
  operationIndex: number,
  editIndex: number,
  reason: string,
): ParseResult<never> {
  return failed('invalid-position', reason, { editIndex, operationIndex })
}

function parsed<T>(value: T): ParseResult<T> {
  return { ok: true, value }
}

function failed(
  code: WorkspaceEditFailureCode,
  reason: string,
  indices: { readonly editIndex?: number; readonly operationIndex?: number } = {},
): ParseResult<never> {
  return {
    error: Object.freeze({ code, reason, ...definedIndices(indices) }),
    ok: false,
  }
}

function definedIndices(indices: {
  readonly editIndex?: number
  readonly operationIndex?: number
}): { readonly editIndex?: number; readonly operationIndex?: number } {
  return {
    ...(indices.operationIndex === undefined ? {} : { operationIndex: indices.operationIndex }),
    ...(indices.editIndex === undefined ? {} : { editIndex: indices.editIndex }),
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export { prepareWorkspaceTextReplay } from './workspaceTextEdits'
export type {
  PreparedWorkspaceTextEdit,
  PreparedWorkspaceTextSegment,
  PreparedWorkspaceTextStep,
  PrepareWorkspaceTextReplayResult,
  WorkspaceTextDocumentProvenance,
  WorkspaceTextReplayInput,
  WorkspaceTextReplaySegmentInput,
  WorkspaceTextReplayTarget,
} from './workspaceTextEdits'
