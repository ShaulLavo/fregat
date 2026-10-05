import { waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi } from 'vitest'
import {
  Editor,
  createEditorStructuralOperation,
  type EditorStructuralOperationContext,
  type DocumentRead,
} from '@singapore-editor/core/editor'
import {
  createEmptySyntaxResult,
  toEditorTokenStore,
  type EditorToken,
} from '@singapore-editor/core/syntax'
import {
  createDiffRegionStore,
  createTextDiff,
  type DiffSyntaxBackend,
} from '@singapore-editor/diff'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { EDITOR_PALETTE_SOURCE } from '@/features/editor/state/syntax-highlighting'
import { highlightingService } from '@/lib/highlighting/state/service'
import { expect, test } from '../../../../../test/fixtures'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { renderWithProviders } from '../../../../../test/render'
import { installSyntaxWorker } from '../../../../../test/factories/syntax-worker'

// The plugin parses per side and publishes projected tokens; the host is what puts them on the
// editor. `setText` clears tokens on its way through, and the parse lands after the first push —
// so if the host does not re-apply them, every diff renders permanently uncoloured while the
// plugin's own tests go on passing. This asserts the tokens reach the editor, not that they exist.

test('the tokens the plugin projects are applied to the editor', async () => {
  stubHighlightApi()
  const setTokens = vi.spyOn(Editor.prototype, 'setTokens')
  try {
    renderWithProviders(
      <StrictMode>
        <DiffPane
          file={createTextDiff({
            newFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const b = 2\n' },
            oldFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const a = 1\n' },
          })}
          regions={createDiffRegionStore()}
          side='stacked'
          syntaxBackend={tokenBackend()}
          theme={{}}
        />
      </StrictMode>,
    )

    await waitFor(() => expect(appliedTokens(setTokens).length).toBeGreaterThan(0))
  } finally {
    setTokens.mockRestore()
  }
})

test('a prepared diff paints coloured with its first text, and a revisit reuses its parse', async () => {
  stubHighlightApi()
  const setText = vi.spyOn(Editor.prototype, 'setText')
  const worker = installSyntaxWorker(firstConstTokens)
  const service = highlightingService()
  const backend = service.documentBackend(EDITOR_PALETTE_SOURCE)
  const diff = () =>
    createTextDiff({
      newFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const b = 2\n' },
      oldFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const a = 1\n' },
    })
  const pane = () => (
    <StrictMode>
      <DiffPane
        file={diff()}
        regions={createDiffRegionStore()}
        side='stacked'
        syntaxBackend={backend}
        syntaxTheme={EDITOR_PALETTE_SOURCE}
        theme={{}}
      />
    </StrictMode>
  )
  try {
    expect(await service.prepareDiff(diff(), EDITOR_PALETTE_SOURCE)).toBe(true)
    const parsedAhead = worker.reads.length

    const first = renderWithProviders(pane())
    await waitFor(() => expect(setText).toHaveBeenCalled())
    expect(firstTextTokens(setText)).toHaveLength(2)
    first.unmount()
    expect(service.canPrepareDiff(diff(), EDITOR_PALETTE_SOURCE)).toBe(false)

    setText.mockClear()
    renderWithProviders(pane())
    await waitFor(() => expect(setText).toHaveBeenCalled())
    expect(firstTextTokens(setText)).toHaveLength(2)
    expect(worker.reads).toHaveLength(parsedAhead)
  } finally {
    setText.mockRestore()
  }
})

function firstTextTokens(spy: { mock: { calls: readonly Parameters<Editor['setText']>[] } }) {
  return toEditorTokenStore(spy.mock.calls[0]?.[1]?.tokens ?? []).toTokens()
}

function appliedTokens(spy: { mock: { calls: readonly Parameters<Editor['setTokens']>[] } }) {
  return spy.mock.calls.flatMap(([tokens]) => toEditorTokenStore(tokens).toTokens())
}

/** A parse that colours the word `const` wherever it appears, so a token has to be anchored to
 *  reach the editor rather than merely counted. */
function tokenBackend(sessions = { created: 0 }): DiffSyntaxBackend {
  return {
    kind: 'tree-sitter',
    provider: { operation: createEditorStructuralOperation(tokenSessions(sessions)) },
  }
}

function tokenSessions(sessions: { created: number }) {
  return (options: EditorStructuralOperationContext) => {
    sessions.created += 1
    let read = options.initialRead
    return {
      foldingSupport: 'supported' as const,
      dispose: () => undefined,
      getResult: () => result(options, read),
      getSnapshotVersion: () => read.revision.point.textVersion,
      getTokens: () => result(options, read).tokens,
      analyze: async (current: DocumentRead) => {
        read = current
        return result(options, read)
      },
    }
  }
}

function result(options: EditorStructuralOperationContext, read: DocumentRead) {
  return {
    ...createEmptySyntaxResult({
      language: {
        includeCaptures: true,
        includeHighlights: true,
        languageId: options.languageId,
        mode: 'full',
      },
      requestedRanges: [{ endIndex: read.text.length, startIndex: 0 }],
      snapshot: {
        documentId: options.documentId,
        length: read.text.length,
        version: read.revision.point.textVersion,
      },
    }),
    tokens: firstConstTokens(read.text.readRange(0, read.text.length)),
  }
}

function firstConstTokens(text: string): EditorToken[] {
  const start = text.indexOf('const')
  return start === -1 ? [] : [{ end: start + 5, start, style: { color: 'rgb(1, 2, 3)' } }]
}
