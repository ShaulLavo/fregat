import {
  acquireLanguageServerLane,
  type AcquiredLanguageServerLane,
  type LanguageServerLaneOptions,
} from '@singapore-editor/lsp-plugin/websocket'
import { LanguageServerSet } from '@singapore-editor/lsp-plugin'
import { type LspWorkspaceDocumentAttachment } from '@singapore-editor/lsp/types'
import { arrayLspLineStarts } from '@singapore-editor/lsp'
import { createStringTextSnapshot } from '@singapore-editor/core/document'

import type { DiffFileSide } from '@/features/editor/utils/diff-position-map'
import { clientErrors } from '@/lib/structured-errors'

export type DiffLanguageDocument = {
  readonly side: DiffFileSide
  readonly uri: string
  readonly languageId: string
  readonly text: string
  readonly sharesRealUri: boolean
}

export type DiffLanguageSession = {
  readonly openSides: ReadonlySet<DiffFileSide>
  uriFor(side: DiffFileSide): string | null
  sideForUri(uri: string): DiffFileSide | null
  request<TResult>(method: string, params: unknown): Promise<TResult | null>
  dispose(): void
}

export function createDiffLanguageSession({
  documents,
  lanes,
}: {
  readonly documents: readonly DiffLanguageDocument[]
  readonly lanes: readonly LanguageServerLaneOptions[]
}): DiffLanguageSession {
  const uris = new Map<DiffFileSide, string>(
    documents.map((document) => [document.side, document.uri]),
  )
  const openedAttachments = new Map<AcquiredLanguageServerLane, LspWorkspaceDocumentAttachment[]>()
  const abort = new AbortController()
  let leases: readonly {
    readonly connection: AcquiredLanguageServerLane
    readonly options: LanguageServerLaneOptions
  }[] = []
  let servers: LanguageServerSet | null = null
  let ready: Promise<void> | null = null
  let disposed = false

  async function ensureReady(): Promise<LanguageServerSet> {
    if (disposed) throw closedSessionError('disposed')
    if (!servers) {
      leases = lanes.map((options) => ({
        connection: acquireLanguageServerLane(options),
        options,
      }))
      servers = new LanguageServerSet(
        leases.map(({ connection, options }) => ({
          connection,
          features: options.features,
          id: options.id,
          onRequestError: options.onRequestError,
        })),
      )
    }
    if (!ready) ready = prepareLanes()

    await ready
    if (disposed) throw closedSessionError('disposed')
    return servers
  }

  async function prepareLanes(): Promise<void> {
    await Promise.all(
      leases.map(async ({ connection }) => {
        try {
          await connection.ready
          openDocuments(connection)
        } catch {
          // The router excludes this lane; another ready feature owner can still answer.
        }
      }),
    )
  }

  function openDocuments(acquired: AcquiredLanguageServerLane): void {
    if (disposed) return

    const opened: LspWorkspaceDocumentAttachment[] = []
    openedAttachments.set(acquired, opened)
    for (const document of documents) {
      const result = acquired.workspace.openDocumentSnapshot({
        languageId: document.languageId,
        lineStarts: arrayLspLineStarts(lineStarts(document.text)),
        sourceRevision: 0,
        sourceSegment: {},
        textSnapshot: createStringTextSnapshot(document.text),
        uri: document.uri,
      })
      opened.push(result.attachment)
    }
  }

  return {
    openSides: new Set(uris.keys()),
    uriFor: (side) => uris.get(side) ?? null,
    sideForUri: (uri) => documents.find((document) => document.uri === uri)?.side ?? null,
    request: async <TResult>(method: string, params: unknown) => {
      const router = await ensureReady()
      try {
        const result = await router.request<TResult | null>(method, params, {
          signal: abort.signal,
        })
        if (disposed) throw closedSessionError('disposed')
        return result
      } catch (error) {
        if (disposed) throw closedSessionError('disposed')
        throw error
      }
    },
    dispose: () => {
      if (disposed) return

      disposed = true
      abort.abort()
      for (const { connection } of leases) {
        for (const attachment of openedAttachments.get(connection) ?? []) {
          connection.workspace.closeDocument(attachment)
        }
        connection.release()
      }
      openedAttachments.clear()
      leases = []
      servers = null
      ready = null
    },
  }
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

function closedSessionError(reason: string) {
  return clientErrors.DIFF_LANGUAGE_SESSION_CLOSED({ internal: { reason } })
}
