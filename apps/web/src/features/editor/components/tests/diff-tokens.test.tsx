import { waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi } from 'vitest'
import { Editor } from '@singapor/core'
import {
  createEmptySyntaxResult,
  type EditorSyntaxSessionOptions,
  type EditorToken,
} from '@singapor/core/syntax'
import { createDiffRegionStore, createTextDiff, type DiffSyntaxBackend } from '@singapor/diff'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { expect, test } from '../../../../../test/fixtures'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { renderWithProviders } from '../../../../../test/render'

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

function appliedTokens(spy: { mock: { calls: readonly unknown[][] } }) {
  return spy.mock.calls.flatMap((call) => call[0] as readonly EditorToken[])
}

/** A parse that colours the word `const` wherever it appears, so a token has to be anchored to
 *  reach the editor rather than merely counted. */
function tokenBackend(): DiffSyntaxBackend {
  return {
    kind: 'tree-sitter',
    provider: {
      createSession: (options: EditorSyntaxSessionOptions) => ({
        foldingSupport: 'supported',
        applyChange: async () => result(options),
        dispose: () => undefined,
        getResult: () => result(options),
        getSnapshotVersion: () => 0,
        getTokens: () => result(options).tokens,
        refresh: async () => result(options),
      }),
    },
  } as DiffSyntaxBackend
}

function result(options: EditorSyntaxSessionOptions) {
  const start = options.fullText.indexOf('const')
  const tokens: EditorToken[] =
    start === -1 ? [] : [{ end: start + 5, start, style: { color: 'rgb(1, 2, 3)' } }]

  return {
    ...createEmptySyntaxResult({
      language: {
        includeCaptures: true,
        includeHighlights: true,
        languageId: options.languageId,
        mode: 'full',
      },
      requestedRanges: [{ endIndex: options.snapshot.length, startIndex: 0 }],
      snapshot: { documentId: options.documentId, length: options.snapshot.length, version: 1 },
    }),
    tokens,
  }
}
