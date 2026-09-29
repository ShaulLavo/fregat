import {
  lspPositionToOffsetInSnapshot,
  offsetToLspPositionInSnapshot,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import { type OffsetRange, identifierRangeAtOffset } from '@singapore-editor/plugin-ui/offset-range'
import type { EditorSetSelectionOptions } from '@singapore-editor/core/editor'
import type * as lsp from 'vscode-languageserver-protocol'

import { documentUriToFileName } from './paths'
import { rangeAroundOffset } from './sourceText'
import type { LanguageServerFeatureRouter } from './serverSet'
import type { LanguageServerDefinitionTarget, LanguageServerNavigationKind } from './types'

/**
 * Inputs required to issue a `textDocument/definition` request against the
 * LSP client. The request is expressed in editor-native coordinates
 * (`offset` into `document`) and converted to an LSP `Position` internally.
 */
export type DefinitionRequest = {
  readonly uri: lsp.DocumentUri
  readonly document: LspTextDocumentSnapshot
  readonly offset: number
  readonly signal?: AbortSignal
}

export type NavigationRequest = DefinitionRequest & {
  readonly kind: LanguageServerNavigationKind
  readonly includeDeclaration?: boolean
}

/**
 * Normalized response from {@link requestDefinition}. The LSP protocol
 * permits a single `Location`, an array of `Location`, or an array of
 * `LocationLink` (or `null`); callers should not have to care which shape
 * was returned, so the raw result is collapsed into a flat list of
 * resolvable targets.
 */
export type DefinitionResult = {
  readonly targets: readonly LanguageServerDefinitionTarget[]
  readonly sourceRange?: OffsetRange
}

/**
 * Minimum editor surface required by {@link navigateToDefinition}. Matches
 * the corresponding subset of `EditorViewContributionContext` so the
 * contribution can pass its `context` through directly while keeping this
 * module decoupled from `@singapore-editor/core`'s full contribution surface.
 */
export type NavigationEditor = {
  readonly document: LspTextDocumentSnapshot
  setSelection(
    anchor: number,
    head: number,
    timingName: string,
    options?: EditorSetSelectionOptions,
  ): void
  focusEditor(): void
}

const SET_SELECTION_TIMING_NAME = 'lspPlugin.goToDefinition'

const REQUEST_METHODS: Record<Exclude<LanguageServerNavigationKind, 'references'>, string> = {
  definition: 'textDocument/definition',
  implementation: 'textDocument/implementation',
  typeDefinition: 'textDocument/typeDefinition',
}

/**
 * Issue a `textDocument/definition` request and normalize the response
 * into a flat list of {@link LanguageServerDefinitionTarget}s. The raw LSP
 * union (`Location`, `Location[]`, `LocationLink[]`, or `null`) is hidden
 * from callers so higher-level orchestration can work with a single shape.
 */
export async function requestDefinition(
  client: LanguageServerFeatureRouter,
  request: DefinitionRequest,
): Promise<DefinitionResult> {
  return requestNavigationTargets(client, { ...request, kind: 'definition' })
}

export async function requestNavigationTargets(
  client: LanguageServerFeatureRouter,
  request: NavigationRequest,
): Promise<DefinitionResult> {
  if (request.kind === 'references') return requestReferences(client, request)

  const raw = await client.request<lsp.Location[] | lsp.Location | lsp.LocationLink[] | null>(
    REQUEST_METHODS[request.kind],
    {
      textDocument: { uri: request.uri },
      position: offsetToLspPositionInSnapshot(request.document, request.offset),
    } satisfies lsp.TextDocumentPositionParams,
    request.signal ? { signal: request.signal } : undefined,
  )
  const sourceRange = definitionSourceRange(raw, request)
  return { targets: definitionTargets(raw), ...(sourceRange ? { sourceRange } : {}) }
}

async function requestReferences(
  client: LanguageServerFeatureRouter,
  request: NavigationRequest,
): Promise<DefinitionResult> {
  const raw = await client.request<lsp.Location[] | null>(
    'textDocument/references',
    {
      textDocument: { uri: request.uri },
      position: offsetToLspPositionInSnapshot(request.document, request.offset),
      context: {
        includeDeclaration: request.includeDeclaration ?? true,
      },
    } satisfies lsp.ReferenceParams,
    request.signal ? { signal: request.signal } : undefined,
  )
  return { targets: definitionTargets(raw) }
}

/**
 * Navigate the editor to `target` by translating its LSP range into
 * offsets in the editor's current text and applying the selection. The
 * caller is responsible for ensuring `editor.document` is the text of the same
 * document `target` refers to (i.e. a same-document jump); cross-document
 * jumps should be routed through `onOpenDefinition`, not this function.
 */
export function navigateToDefinition(
  target: LanguageServerDefinitionTarget,
  editor: NavigationEditor,
): void {
  navigateToTarget(target, editor, SET_SELECTION_TIMING_NAME)
}

export function navigateToTarget(
  target: LanguageServerDefinitionTarget,
  editor: NavigationEditor,
  timingName: string,
): void {
  const start = lspPositionToOffsetInSnapshot(editor.document, target.range.start)
  const end = lspPositionToOffsetInSnapshot(editor.document, target.range.end)
  editor.setSelection(start, end, timingName, { revealBlock: 'center', revealOffset: start })
  editor.focusEditor()
}

/**
 * Pick the best target to jump to from a definition result. Prefers
 * targets inside the active document, then targets outside `node_modules`,
 * then any target; returns `null` when no targets were returned.
 */
export function preferredDefinitionTarget(
  activeUri: lsp.DocumentUri,
  result: DefinitionResult,
): LanguageServerDefinitionTarget | null {
  return preferredTarget(activeUri, result.targets)
}

export function preferredReferenceTarget(
  activeUri: lsp.DocumentUri,
  activeDocument: LspTextDocumentSnapshot,
  sourceOffset: number,
  result: DefinitionResult,
): LanguageServerDefinitionTarget | null {
  const sourceRange =
    rangeAroundOffset(activeDocument, sourceOffset, identifierRangeAtOffset) ??
    ({ start: sourceOffset, end: sourceOffset } satisfies OffsetRange)
  const sameDocumentTargets = result.targets.flatMap((target) =>
    targetWithOffset(activeUri, activeDocument, target),
  )
  const nextTarget = sameDocumentTargets.find((target) => target.start > sourceRange.end)
  if (nextTarget) return nextTarget.target

  const otherTarget = sameDocumentTargets.find((target) => !rangesOverlap(sourceRange, target))
  return otherTarget?.target ?? preferredTarget(activeUri, result.targets)
}

/**
 * Pick the best target to render a ctrl/cmd-hover definition link for.
 * Same preference rules as {@link preferredDefinitionTarget} but filters
 * out targets that would point back at (or overlap with) the hovered
 * identifier itself — the user would not be able to "jump" to the
 * definition they are already looking at.
 */
export function preferredJumpableDefinitionTarget(
  activeUri: lsp.DocumentUri,
  activeDocument: LspTextDocumentSnapshot,
  sourceRange: OffsetRange,
  result: DefinitionResult,
): LanguageServerDefinitionTarget | null {
  const targets = result.targets.filter(
    (target) => !targetIsSourceRange(activeUri, activeDocument, sourceRange, target),
  )
  return preferredTarget(activeUri, targets)
}

function preferredTarget(
  activeUri: lsp.DocumentUri,
  targets: readonly LanguageServerDefinitionTarget[],
): LanguageServerDefinitionTarget | null {
  return (
    targets.find((target) => target.uri === activeUri) ??
    targets.find((target) => !target.path.includes('/node_modules/')) ??
    targets[0] ??
    null
  )
}

function targetWithOffset(
  activeUri: lsp.DocumentUri,
  activeDocument: LspTextDocumentSnapshot,
  target: LanguageServerDefinitionTarget,
): readonly (OffsetRange & {
  readonly target: LanguageServerDefinitionTarget
})[] {
  if (target.uri !== activeUri) return []

  return [
    {
      start: lspPositionToOffsetInSnapshot(activeDocument, target.range.start),
      end: lspPositionToOffsetInSnapshot(activeDocument, target.range.end),
      target,
    },
  ]
}

function targetIsSourceRange(
  activeUri: lsp.DocumentUri,
  activeDocument: LspTextDocumentSnapshot,
  sourceRange: OffsetRange,
  target: LanguageServerDefinitionTarget,
): boolean {
  if (target.uri !== activeUri) return false

  const targetStart = lspPositionToOffsetInSnapshot(activeDocument, target.range.start)
  const targetEnd = lspPositionToOffsetInSnapshot(activeDocument, target.range.end)
  return rangesOverlap(sourceRange, { start: targetStart, end: targetEnd })
}

function rangesOverlap(left: OffsetRange, right: OffsetRange): boolean {
  return left.start < right.end && right.start < left.end
}

function definitionTargets(
  result: lsp.Location[] | lsp.Location | lsp.LocationLink[] | null,
): readonly LanguageServerDefinitionTarget[] {
  if (!result) return []
  const items = Array.isArray(result) ? result : [result]
  return items.flatMap(definitionTarget)
}

function definitionSourceRange(
  result: lsp.Location[] | lsp.Location | lsp.LocationLink[] | null,
  request: DefinitionRequest,
): OffsetRange | null {
  if (!result) return null
  const items = Array.isArray(result) ? result : [result]
  for (const item of items) {
    if (!('originSelectionRange' in item) || !item.originSelectionRange) continue
    const start = lspPositionToOffsetInSnapshot(request.document, item.originSelectionRange.start)
    const end = lspPositionToOffsetInSnapshot(request.document, item.originSelectionRange.end)
    if (request.offset >= start && request.offset < end) return { start, end }
  }
  return null
}

function definitionTarget(
  item: lsp.Location | lsp.LocationLink,
): readonly LanguageServerDefinitionTarget[] {
  const uri = 'targetUri' in item ? item.targetUri : item.uri
  const range = 'targetSelectionRange' in item ? item.targetSelectionRange : item.range
  const fileName = documentUriToFileName(uri)
  if (!fileName) return []

  return [
    {
      uri,
      path: fileName.replace(/^\/+/, ''),
      range,
    },
  ]
}
