import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext, ServiceContext } from './context'
import { textEdits } from './edits'
import { documentationMarkdown } from './hover'
import { isRecord, positionParam } from './protocol'

const COMPLETION_TRIGGER_INVOKED = 1
const COMPLETION_TRIGGER_CHARACTER = 2
const MAX_COMPLETION_ITEMS = 100
const MAX_TYPED_WORD = 128
const DOLLAR = 36
const UNDERSCORE = 95
const DIGIT_0 = 48
const DIGIT_9 = 57
const LOWER_CASE_BIT = 32
const LOWER_A = 97
const LOWER_Z = 122
const ASCII_MAX = 127
export const COMPLETION_TRIGGER_CHARACTERS = ['.', '"', "'", '`', '/', '@', '<', '#', ' '] as const
const completionTriggerCharacterSet = new Set<string>(COMPLETION_TRIGGER_CHARACTERS)

/** What an item carries so resolve can ask TypeScript about the same entry at the same place. */
type CompletionItemData = {
  readonly uri: lsp.DocumentUri
  readonly offset: number
  readonly name: string
  readonly source?: string
  readonly data?: ts.CompletionEntryData
}

export function emptyCompletionList(): lsp.CompletionList {
  return { isIncomplete: false, items: [] }
}

export function completion(ctx: DocumentContext, params: unknown): lsp.CompletionList {
  const position = positionParam(params)
  if (!position) return emptyCompletionList()

  const offset = ctx.lines.offset(position)
  const info = ctx.env.languageService.getCompletionsAtPosition(
    ctx.document.fileName,
    offset,
    { ...ctx.preferences, ...completionOptions(params) },
    ctx.formatSettings,
  )
  if (!info) return emptyCompletionList()

  const typed = typedWord(ctx.document.text, offset)
  const matching = info.entries.filter((entry) =>
    isSubsequence(typed, entry.filterText ?? entry.name),
  )
  const capped = matching.length > MAX_COMPLETION_ITEMS
  const kept = capped ? matching.toSorted(compareEntries).slice(0, MAX_COMPLETION_ITEMS) : matching
  return {
    // A capped list is incomplete, so the client asks again as the word grows and the cap moves on.
    isIncomplete: info.isIncomplete === true || capped,
    items: kept.map((entry) => completionItem(ctx, info, entry, offset)),
  }
}

/**
 * The identifier being typed. TypeScript answers every name in scope whatever has been typed, so the
 * cap has to be applied after this filter: capped first, an auto-import sorted late never arrives.
 */
function typedWord(text: string, offset: number): string {
  let start = offset
  while (
    start > 0 &&
    start > offset - MAX_TYPED_WORD &&
    isWordCharacter(text.charCodeAt(start - 1))
  ) {
    start -= 1
  }
  return text.slice(start, offset)
}

function isWordCharacter(code: number): boolean {
  if (code === DOLLAR || code === UNDERSCORE) return true
  if (code >= DIGIT_0 && code <= DIGIT_9) return true
  const lower = code | LOWER_CASE_BIT
  return (lower >= LOWER_A && lower <= LOWER_Z) || code > ASCII_MAX
}

/** Every character of `typed`, in order and ignoring case: what any fuzzy match at least needs. */
function isSubsequence(typed: string, candidate: string): boolean {
  if (typed.length === 0) return true
  const pattern = typed.toLowerCase()
  const text = candidate.toLowerCase()
  let matched = 0
  for (let index = 0; index < text.length && matched < pattern.length; index += 1) {
    if (text[index] === pattern[matched]) matched += 1
  }
  return matched === pattern.length
}

function compareEntries(left: ts.CompletionEntry, right: ts.CompletionEntry): number {
  if (left.sortText !== right.sortText) return left.sortText < right.sortText ? -1 : 1
  return left.name.localeCompare(right.name)
}

/**
 * Fills in what an item left out: its signature, its documentation and — the one that changes the
 * document — the import an auto-import entry needs.
 */
export function resolveCompletionItem(ctx: ServiceContext, params: unknown): lsp.CompletionItem {
  const item = params as lsp.CompletionItem
  const data = completionItemData(item.data)
  if (!data) return item

  const fileName = ctx.fileNameOf(data.uri)
  if (!fileName) return item

  const details = ctx.env.languageService.getCompletionEntryDetails(
    fileName,
    data.offset,
    data.name,
    ctx.formatSettings,
    data.source,
    ctx.preferences,
    data.data,
  )
  if (!details) return item

  const resolved: lsp.CompletionItem = { ...item }
  const detail = ts.displayPartsToString(details.displayParts)
  if (detail) resolved.detail = detail
  const documentation = documentationMarkdown('', details.documentation, details.tags)
  if (documentation) resolved.documentation = { kind: 'markdown', value: documentation }
  const additionalTextEdits = sameFileEdits(ctx, fileName, details.codeActions)
  if (additionalTextEdits.length > 0) resolved.additionalTextEdits = additionalTextEdits
  return resolved
}

function sameFileEdits(
  ctx: ServiceContext,
  fileName: string,
  actions: readonly ts.CodeAction[] | undefined,
): lsp.TextEdit[] {
  if (!actions) return []

  return actions.flatMap((action) =>
    action.changes
      .filter((change) => change.fileName === fileName)
      .flatMap((change) => textEdits(ctx, fileName, change.textChanges)),
  )
}

function completionOptions(params: unknown): ts.GetCompletionsAtPositionOptions {
  const trigger = completionTrigger(params)
  const options: ts.GetCompletionsAtPositionOptions = {
    includeCompletionsForImportStatements: true,
    includeCompletionsForModuleExports: true,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithSnippetText: false,
    triggerKind: trigger.kind as ts.CompletionTriggerKind,
  }
  if (trigger.character) options.triggerCharacter = trigger.character
  return options
}

function completionTrigger(params: unknown): {
  readonly kind: number
  readonly character?: ts.CompletionsTriggerCharacter
} {
  if (!isRecord(params)) return { kind: COMPLETION_TRIGGER_INVOKED }
  if (!isRecord(params.context)) return { kind: COMPLETION_TRIGGER_INVOKED }

  const context = params.context
  const character = completionTriggerCharacter(context.triggerCharacter)
  if (context.triggerKind === COMPLETION_TRIGGER_CHARACTER && character) {
    return { kind: COMPLETION_TRIGGER_CHARACTER, character }
  }

  return { kind: COMPLETION_TRIGGER_INVOKED }
}

function completionTriggerCharacter(value: unknown): ts.CompletionsTriggerCharacter | undefined {
  if (typeof value !== 'string') return undefined
  if (!completionTriggerCharacterSet.has(value)) return undefined
  return value as ts.CompletionsTriggerCharacter
}

function completionItem(
  ctx: DocumentContext,
  info: ts.CompletionInfo,
  entry: ts.CompletionEntry,
  offset: number,
): lsp.CompletionItem {
  const insertText = entry.insertText ?? entry.name
  const item: lsp.CompletionItem = {
    label: entry.name,
    kind: completionItemKind(entry.kind),
    sortText: entry.sortText,
    filterText: entry.filterText,
    commitCharacters: entry.commitCharacters ?? info.defaultCommitCharacters,
    data: itemData(ctx.document.uri, offset, entry),
  }
  const detail = completionEntryDetail(entry)
  if (detail) item.detail = detail
  if (entry.labelDetails) item.labelDetails = entry.labelDetails

  const span = entry.replacementSpan ?? info.optionalReplacementSpan
  if (span) item.textEdit = { range: ctx.lines.range(span), newText: insertText }
  else item.insertText = insertText
  return item
}

function itemData(
  uri: lsp.DocumentUri,
  offset: number,
  entry: ts.CompletionEntry,
): CompletionItemData {
  const data: { -readonly [Key in keyof CompletionItemData]: CompletionItemData[Key] } = {
    uri,
    offset,
    name: entry.name,
  }
  if (entry.source) data.source = entry.source
  if (entry.data) data.data = entry.data
  return data
}

function completionItemData(value: unknown): CompletionItemData | null {
  if (!isRecord(value)) return null
  if (typeof value.uri !== 'string') return null
  if (typeof value.offset !== 'number') return null
  if (typeof value.name !== 'string') return null
  return value as CompletionItemData
}

function completionEntryDetail(entry: ts.CompletionEntry): string | undefined {
  const source = ts.displayPartsToString(entry.sourceDisplay ?? [])
  if (source) return source
  if (entry.kindModifiers) return entry.kindModifiers
  return undefined
}

function completionItemKind(kind: string): lsp.CompletionItemKind {
  if (kind === 'method') return 2
  if (kind === 'function') return 3
  if (kind === 'constructor') return 4
  if (kind === 'member variable') return 5
  if (kind === 'member get accessor') return 5
  if (kind === 'member set accessor') return 5
  if (kind === 'var') return 6
  if (kind === 'let') return 6
  if (kind === 'const') return 6
  if (kind === 'local var') return 6
  if (kind === 'parameter') return 6
  if (kind === 'class') return 7
  if (kind === 'interface') return 8
  if (kind === 'module') return 9
  if (kind === 'property') return 10
  if (kind === 'enum') return 13
  if (kind === 'keyword') return 14
  if (kind === 'enum member') return 20
  if (kind === 'alias') return 18
  if (kind === 'type') return 25
  return 1
}
