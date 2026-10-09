import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  applyEdits,
  createScanner,
  getNodeValue,
  modify,
  parseTree,
  printParseErrorCode,
  type FormattingOptions,
  type Node as JsonNode,
  type ParseError,
} from 'jsonc-parser'
import { isRecord } from '@workspace/utils/objects'
import { atomicTemporaryPath, commitAtomicWrite, stageAtomicWrite } from '../fs/atomic-write'
import { textFileVersion } from '../fs/version'

/**
 * Matches how the repo formats its own JSON, so a file the UI writes and a file
 * a person writes do not fight over indentation on every save.
 */
const FORMATTING: FormattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' }

const PARSE_OPTIONS = {
  allowTrailingComma: true,
  // An empty file is an empty document, not a parse error. It is the most common
  // outcome of a crashed or interrupted editor save, and treating it as a
  // failure would deadlock every write under the refuse-to-write-broken rule.
  allowEmptyContent: true,
} as const

export type SettingsParseError = {
  readonly message: string
  readonly offset: number
  readonly length: number
}

export type SettingsTextRange = {
  readonly offset: number
  readonly length: number
}

export type ParsedSettingsDocument = {
  readonly values: Record<string, unknown>
  readonly parseErrors: readonly SettingsParseError[]
  readonly keyRanges: Readonly<Record<string, SettingsTextRange>>
}

export type SettingsFileContents = {
  readonly text: string
  /** Content hash of the bytes on disk; `null` when the file does not exist. */
  readonly revision: string | null
}

export type DocumentEdit = {
  readonly key: string
  /** Omitted removes the key, which is what a reset does. */
  readonly value?: unknown
}

/**
 * Tolerant read.
 *
 * Comments and trailing commas are allowed, and a syntax error yields whatever
 * the parser could recover plus the errors — never a throw and never an empty
 * wipe. The caller decides what to do with a partial document; the store falls
 * back per key so one bad line cannot take out the keybindings the running app
 * depends on.
 */
export function parseSettingsDocument(text: string): ParsedSettingsDocument {
  if (text.trim() === '') return { values: {}, parseErrors: [], keyRanges: {} }

  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  const parsed: unknown = root ? getNodeValue(root) : undefined
  const parseErrors = errors.map(toParseError)

  if (!isRecord(parsed)) {
    const notAnObject = { message: 'settings must be a JSON object', offset: 0, length: 0 }

    return { values: {}, parseErrors: parseErrors.concat([notAnObject]), keyRanges: {} }
  }

  return { values: parsed, parseErrors, keyRanges: topLevelKeyRanges(root) }
}

function topLevelKeyRanges(root: JsonNode | undefined): Record<string, SettingsTextRange> {
  if (root?.type !== 'object') return {}

  const ranges: Record<string, SettingsTextRange> = {}
  for (const property of root.children ?? []) {
    const key = property.children?.[0]
    if (key?.type !== 'string') continue
    if (typeof key.value !== 'string') continue

    ranges[key.value] = { offset: key.offset, length: key.length }
  }

  return ranges
}

/** Text edits preserve untouched properties and comments; re-serialization would lose them. */
export function editSettingsText(text: string, edits: readonly DocumentEdit[]): string {
  let next = text.trim() === '' ? '{}\n' : text

  for (const edit of edits) {
    const value = Object.hasOwn(edit, 'value') ? edit.value : undefined
    next =
      value === undefined
        ? removeSettingsProperty(next, edit.key)
        : applyEdits(next, modify(next, [edit.key], value, { formattingOptions: FORMATTING }))
  }

  return next
}

function removeSettingsProperty(text: string, key: string): string {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  if (errors.length > 0 || root?.type !== 'object') return text

  const properties = root.children ?? []
  const index = properties.findIndex((property) => property.children?.[0]?.value === key)
  const property = properties[index]
  if (!property) return text

  const propertyEnd = property.offset + property.length
  const followingComma = commaAfter(text, propertyEnd)
  const hasTrailingComment =
    followingComma !== null && !/^[\t \r\n]*$/.test(text.slice(propertyEnd, followingComma))
  const range = propertyRemovalRange(text, property, hasTrailingComment ? null : followingComma)
  const edits = [{ ...range, content: '' }]
  if (followingComma !== null) {
    if (hasTrailingComment) edits.push({ offset: followingComma, length: 1, content: '' })
    return applyEdits(text, edits)
  }

  const previous = properties[index - 1]
  if (!previous) return applyEdits(text, edits)
  const precedingComma = commaAfter(text, previous.offset + previous.length)
  if (precedingComma === null) return applyEdits(text, edits)

  // Keep intervening comments; only a trivia-free compact gap joins the removal.
  if (/^[\t ]*$/.test(text.slice(precedingComma + 1, range.offset))) {
    edits[0] = {
      offset: precedingComma,
      length: range.offset + range.length - precedingComma,
      content: '',
    }
    return applyEdits(text, edits)
  }
  edits.push({ offset: precedingComma, length: 1, content: '' })
  return applyEdits(text, edits)
}

function commaAfter(text: string, offset: number): number | null {
  const scanner = createScanner(text, true)
  scanner.setPosition(offset)
  scanner.scan()
  const tokenOffset = scanner.getTokenOffset()
  return text[tokenOffset] === ',' ? tokenOffset : null
}

function propertyRemovalRange(
  text: string,
  property: JsonNode,
  followingComma: number | null,
): SettingsTextRange {
  const end = followingComma === null ? property.offset + property.length : followingComma + 1
  const lineStart = text.lastIndexOf('\n', property.offset - 1) + 1
  const newline = /^[\t ]*(?:\r\n|\n)/.exec(text.slice(end))
  if (newline && /^[\t ]*$/.test(text.slice(lineStart, property.offset))) {
    return { offset: lineStart, length: end + newline[0].length - lineStart }
  }

  const spaces = followingComma === null ? '' : (/^[\t ]*/.exec(text.slice(end))?.[0] ?? '')
  return { offset: property.offset, length: end + spaces.length - property.offset }
}

/**
 * The boot read, done synchronously.
 *
 * `createApp` is synchronous and fifteen call sites depend on that, while the
 * provider registry has to be built from settings before the app finishes
 * constructing. One small file read at startup is a far smaller cost than making
 * app construction async everywhere.
 */
export function readSettingsFileSync(filePath: string): SettingsFileContents {
  try {
    const text = readFileSync(filePath, 'utf8')

    return { text, revision: textFileVersion(text) }
  } catch (error) {
    if (isMissingFile(error)) return { text: '', revision: null }
    throw error
  }
}

/** `null` when the file does not exist — an untouched install, not an error. */
export async function readSettingsFile(filePath: string): Promise<SettingsFileContents> {
  try {
    const text = await readFile(filePath, 'utf8')

    return { text, revision: textFileVersion(text) }
  } catch (error) {
    if (isMissingFile(error)) return { text: '', revision: null }
    throw error
  }
}

export type StagedSettingsFile = {
  readonly destination: string
  readonly mode?: number
  readonly revision: string
  readonly temporary: string
  readonly text: string
}

/** Writes and fsyncs the new bytes without making them visible yet. */
export async function stageSettingsFile(
  filePath: string,
  text: string,
  mode?: number,
): Promise<StagedSettingsFile> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = atomicTemporaryPath(filePath)
  await stageAtomicWrite(temporary, text, { durability: 'fsync-all', mode })
  return {
    destination: filePath,
    mode,
    revision: textFileVersion(text),
    temporary,
    text,
  }
}

export async function tryCommitStagedSettingsFile(
  staged: StagedSettingsFile,
  expectedRevision: string | null | undefined,
  beforeCommit?: () => void,
): Promise<
  | { readonly kind: 'committed'; readonly revision: string }
  | { readonly foundRevision: string | null; readonly kind: 'revision-mismatch' }
> {
  if (expectedRevision !== undefined) {
    const current = await currentSettingsFileRevision(staged.destination)
    if (current !== expectedRevision) {
      return { foundRevision: current, kind: 'revision-mismatch' }
    }
  }

  beforeCommit?.()
  await commitAtomicWrite(staged.temporary, staged.destination, { durability: 'fsync-all' })

  return { kind: 'committed', revision: staged.revision }
}

export async function discardStagedSettingsFile(staged: StagedSettingsFile): Promise<void> {
  await rm(staged.temporary, { force: true }).catch(() => {})
}

/**
 * Re-read immediately before the rename rather than trusting the revision the
 * caller read earlier. The gap between a store's read and its write is exactly
 * where a hand-edit lands, and a counter-style revision cannot see it.
 */
async function currentSettingsFileRevision(filePath: string): Promise<string | null> {
  try {
    await stat(filePath)

    return textFileVersion(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

function toParseError(error: ParseError): SettingsParseError {
  return {
    message: printParseErrorCode(error.error),
    offset: error.offset,
    length: error.length,
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
