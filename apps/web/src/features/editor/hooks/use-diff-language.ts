import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type { DiffFile, DiffRenderRow } from '@singapore-editor/diff'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'

import {
  createDiffLanguageSession,
  type DiffLanguageDocument,
  type DiffLanguageSession,
} from '@/features/editor/state/diff-language-session'
import { documentUriToFileName } from '@singapore-editor/lsp-plugin/paths'

import { useLanguageServerMatches } from '@/features/editor/hooks/use-language-server-matches'
import { diffLanguageServerConnectionProvider } from '@/features/editor/state/language-server-connection-pool'
import {
  languageServerLaneOptions,
  type LanguageServerMatch,
} from '@/features/editor/utils/language-server-plugin'
import {
  createDiffLanguagePlugin,
  type DiffAskTarget,
  type DiffDefinitionOutcome,
} from '@/features/editor/utils/diff-language-plugin'
import {
  firstDefinitionLocation,
  type DefinitionResponse,
} from '@/features/editor/utils/diff-definition'
import { diffLanguageDocuments } from '@/features/editor/utils/diff-documents'
import {
  diffQueryTargetAt,
  type DiffQueryTarget,
  type DiffSideState,
} from '@/features/editor/utils/diff-language-query'
import {
  createDiffPositionMap,
  type DiffFileSide,
  type DiffPositionMap,
} from '@/features/editor/utils/diff-position-map'
import { hoverMarkup, type HoverResponse } from '@/features/editor/utils/hover-markup'
import { log } from '@/lib/client-logging'
import type {
  DiffLanguageHost,
  DiffLanguageServerContext,
} from '@/features/editor/utils/diff-language-context'

const EMPTY_DIFF_LINES: readonly string[] = []

/**
 * Hover for a diff pane, over documents the diff opens itself.
 *
 * Both texts go to the language server — the new side under the file's real uri where that is safe,
 * the old side under a phantom sibling — so a deleted line answers as readily as an added one. The
 * row under the pointer is mapped to a line of whichever side it belongs to, and the question is
 * asked about that side's document.
 */
export function useDiffLanguage(
  file: DiffFile | null,
  rows: readonly DiffRenderRow[],
  theme: EditorTheme,
  languageServer: DiffLanguageServerContext | null,
): EditorPlugin | null {
  const origin = originForQueryClient(useQueryClient())
  const newLines = file?.newLines ?? EMPTY_DIFF_LINES
  const oldLines = file?.oldLines ?? EMPTY_DIFF_LINES
  const map = useMemo(
    () => createDiffPositionMap(rows, newLines, oldLines),
    [newLines, oldLines, rows],
  )
  const host = languageServer?.host ?? null
  const onApplyWorkspaceEdit = host?.applyWorkspaceEdit ?? null
  const openDefinition = host?.openDefinition ?? null
  const documentPath = languageServer?.documentPath ?? null
  const rootPath = languageServer?.rootPath ?? null
  // Asked before connecting. A file no server claims — a `.md`, anything outside a project — must
  // not open a socket at all: the connection would be accepted and then answer nothing, which is
  // indistinguishable from a server that is merely slow.
  const matches = useLanguageServerMatches(
    rootPath ?? '',
    documentPath ?? '',
    documentPath !== null,
  )
  const routedMatches = useMemo(() => diffLanguageServerMatches(matches), [matches])

  // A plain holder the plugin reads from, so its identity stays stable across renders — a fresh
  // plugin per render would tear the view contribution down and rebuild its tooltip on every mouse
  // move. Not a `useRef`: the React Compiler forbids touching `.current` during render, and this is
  // written on commit and read later, from event handlers.
  const [latest] = useState<HoverHolder>(() => ({
    documents: [],
    drifted: new Set<DiffFileSide>(),
    map,
    newSideIsWorkingTree: languageServer?.newSideIsWorkingTree ?? false,
    ownedText: null,
    openDefinition,
    path: documentPath ?? '',
    session: null,
    theme,
  }))
  useLayoutEffect(() => {
    Object.assign(latest, {
      map,
      newSideIsWorkingTree: languageServer?.newSideIsWorkingTree ?? false,
      openDefinition,
      ownedText: languageServer?.ownedText ?? null,
      path: documentPath ?? '',
      theme,
    })
  })

  // One socket per diff, opened once and kept for as long as the diff is on screen. Deliberately
  // NOT re-created when `ownedText` changes: that is every keystroke in an open editor, and each
  // one would cost a `didClose`/`didOpen` pair. What editing can invalidate is checked per request
  // instead, in `sideStates`.
  useEffect(() => {
    if (!file) return
    if (!documentPath || !rootPath || !onApplyWorkspaceEdit) return
    if (routedMatches.length === 0) return

    const documents = diffLanguageDocuments({
      documentPath,
      file,
      newSideIsWorkingTree: latest.newSideIsWorkingTree,
      ownedText: latest.ownedText,
    })
    if (documents.length === 0) return

    const session = createDiffLanguageSession({
      documents,
      lanes: routedMatches.map((match) =>
        languageServerLaneOptions({
          origin,
          connectionProvider: diffLanguageServerConnectionProvider({
            origin,
            rootPath: match.root,
            serverId: match.serverId,
            sessionId: crypto.randomUUID(),
          }),
          match,
          onApplyWorkspaceEdit,
          rootPath,
          target: { matchPath: documentPath },
        }),
      ),
    })
    // `Object.assign` rather than field writes for the same reason the layout effect above uses it:
    // the React Compiler treats a direct assignment into a `useState` value as a mutation it cannot
    // reason about, and this holder is deliberately mutable state written on commit.
    Object.assign(latest, { documents, drifted: new Set<DiffFileSide>(), session })

    return () => {
      Object.assign(latest, { documents: [], drifted: new Set<DiffFileSide>(), session: null })
      session.dispose()
    }
  }, [documentPath, file, latest, onApplyWorkspaceEdit, origin, rootPath, routedMatches])

  // Only whether a file could be asked about at all rebuilds the plugin; everything else is read
  // live from the holder.
  const available =
    file !== null &&
    documentPath !== null &&
    rootPath !== null &&
    onApplyWorkspaceEdit !== null &&
    routedMatches.length > 0

  return useMemo(() => {
    if (!available) return null

    return createDiffLanguagePlugin({
      resolve: (offset) => {
        const target = diffQueryTargetAt({ map: latest.map, offset, sides: sideStates(latest) })
        // Only when the answer changes. This runs per mouse move, and one event per pixel is not a
        // log — but "the cursor never becomes an I-beam" was the whole failure and nothing
        // recorded why.
        reportRefusal(latest, target)
        return target
      },
      hover: async (target) => {
        const session = latest.session
        if (!session) return refuse('no-session', latest.path)

        const uri = session.uriFor(target.side)
        if (!uri) return refuse('side-not-open', latest.path)

        const hover = await session.request<HoverResponse | null>('textDocument/hover', {
          position: target.position,
          textDocument: { uri },
        })
        const markup = hoverMarkup(hover)
        log.debug({
          action: 'diff.hover',
          area: 'editor',
          character: target.position.character,
          documentPath: latest.path,
          line: target.position.line,
          outcome: markup ? 'answered' : 'server-had-nothing',
          side: target.side,
          uri,
        })
        return markup
      },
      definition: (target) => followDefinition(latest, target),
      bufferOffsetAt: (side, position) => latest.map.bufferOffsetAt(side, position),
      theme: () => latest.theme,
    })
  }, [available, latest])
}

export function diffLanguageServerMatches(
  matches: readonly LanguageServerMatch[] | null,
): readonly LanguageServerMatch[] {
  if (!matches) return []

  return matches.filter(
    (match) => match.features.hover !== undefined || match.features.navigation !== undefined,
  )
}

type HoverHolder = {
  documents: readonly DiffLanguageDocument[]
  drifted: Set<DiffFileSide>
  lastRefusal?: string
  map: DiffPositionMap
  newSideIsWorkingTree: boolean
  openDefinition: DiffLanguageHost['openDefinition']
  ownedText: string | null
  path: string
  session: DiffLanguageSession | null
  theme: EditorTheme
}

/**
 * Follows a definition out of a diff.
 *
 * Three destinations, and the middle one is the reason this is not just the editor's navigation: a
 * definition can land in another file, in one of the two texts this diff is already drawing, or
 * nowhere. The old side has no file to open — it exists in git and in the server's memory — so a
 * target inside it is shown where it already is rather than refused.
 */
async function followDefinition(
  holder: HoverHolder,
  target: DiffAskTarget,
): Promise<DiffDefinitionOutcome> {
  const session = holder.session
  if (!session) return definitionOutcome(holder, 'no-session', { kind: 'none' })

  const uri = session.uriFor(target.side)
  if (!uri) return definitionOutcome(holder, 'side-not-open', { kind: 'none' })

  const result = await session.request<DefinitionResponse>('textDocument/definition', {
    position: target.position,
    textDocument: { uri },
  })
  const location = firstDefinitionLocation(result)
  if (!location) return definitionOutcome(holder, 'server-had-nothing', { kind: 'none' })

  const side = session.sideForUri(location.uri)
  if (side) {
    return definitionOutcome(holder, `in-diff:${side}`, {
      kind: 'in-diff',
      position: location.range.start,
      side,
    })
  }

  const path = documentUriToFileName(location.uri)?.replace(/^\/+/, '') ?? null
  if (!path) return definitionOutcome(holder, 'unopenable-uri', { kind: 'none' })
  // A host may explicitly support hover without offering navigation outside the diff.
  if (!holder.openDefinition) return definitionOutcome(holder, 'no-open-command', { kind: 'none' })

  holder.openDefinition({ path, range: location.range, uri: location.uri })
  return definitionOutcome(holder, 'opened', { kind: 'opened' })
}

function definitionOutcome(
  holder: HoverHolder,
  outcome: string,
  result: DiffDefinitionOutcome,
): DiffDefinitionOutcome {
  log.debug({ action: 'diff.definition', area: 'editor', documentPath: holder.path, outcome })

  return result
}

/**
 * Which sides can be asked about right now.
 *
 * Only a side sharing the file's real uri can go stale, and it does so when an editor holds
 * different text than the diff was built from — at that point the server's copy is theirs.
 *
 * Latched, and that is the subtle half. When the editor tab closes, the backend does NOT drop its
 * text: this session still owns the uri, so the proxy's owner set keeps the document alive exactly
 * as the editor last left it. `ownedText` going back to null therefore means "nobody is editing",
 * not "the file is ours again" — and a side that once drifted stays drifted for this session.
 */
function sideStates(holder: HoverHolder): ReadonlyMap<DiffFileSide, DiffSideState> {
  const states = new Map<DiffFileSide, DiffSideState>()
  if (!holder.session) return states

  for (const document of holder.documents) {
    if (!document.sharesRealUri) {
      states.set(document.side, 'ready')
      continue
    }

    if (holder.ownedText !== null && holder.ownedText !== document.text) {
      holder.drifted.add(document.side)
    }
    states.set(document.side, holder.drifted.has(document.side) ? 'drifted' : 'ready')
  }

  return states
}

/** One event per hover that got past the gate and still produced nothing. */
function refuse(outcome: string, documentPath: string): null {
  log.debug({ action: 'diff.hover', area: 'editor', documentPath, outcome })

  return null
}

/**
 * The gate's answer, recorded when it changes.
 *
 * `resolve` runs on every mouse move, so this dedupes on the reason — the useful signal is
 * "hovering this diff refuses, and here is which of the reasons", not a stream of identical lines.
 */
function reportRefusal(holder: HoverHolder, target: DiffQueryTarget): void {
  const reason = target.kind === 'unavailable' ? target.reason : `ask:${target.side}`
  if (holder.lastRefusal === reason) return

  holder.lastRefusal = reason
  log.debug({ action: 'diff.hover.gate', area: 'editor', outcome: reason, path: holder.path })
}
