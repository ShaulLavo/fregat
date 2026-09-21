import { waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@singapore-editor/core/editor'
import {
  createDiffRegionStore,
  createStackedProjection,
  createTextDiff,
} from '@singapore-editor/diff'
import { vi } from 'vitest'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { log } from '@/lib/client-logging'
import { expect, test } from '../../../../../test/fixtures'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { renderWithProviders } from '../../../../../test/render'

// Expanding a collapsed region rewrites the whole buffer. The reader is somewhere in it, and the
// two ways of pushing text back in do not agree about that: `openDocument` takes no scroll position
// from the host and lands at the top, `setText` carries the current one across.

const LINE_COUNT = 60

test.beforeEach(() => {
  stubEditorViewport({ height: 160 })
})

test('expanding a skipped range splices rows in without moving the reader', async () => {
  const { editor, rowElements } = await mountStackedDiff()
  editor.setScrollPosition({ top: 120 })
  const scrolled = editor.getScrollPosition().top
  // A scroll offset that clamped to zero would make the assertion below say nothing.
  expect(scrolled).toBeGreaterThan(0)

  const before = textLineCount(editor)
  const separator = rowElements().find((row) =>
    row.classList.contains('editor-diff-row-expandable'),
  )
  expect(separator).toBeDefined()
  await userEvent.click(separator!)

  await waitFor(() => expect(textLineCount(editor)).toBeGreaterThan(before))
  expect(editor.getScrollPosition().top).toBe(scrolled)
})

test('does not report a transient stacked row-count mismatch', async () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
  try {
    const { editor, rowCount } = await mountStackedDiff()

    await waitFor(() => expect(textLineCount(editor)).toBe(rowCount))
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'editor.diff.document_mode_violation',
        documentId: 'repo/a.ts:stacked',
        side: 'stacked',
        violations: ['row-count-mismatch'],
      }),
    )
  } finally {
    warn.mockRestore()
  }
})

function textLineCount(editor: Editor): number {
  return editor.materializeFullText().split('\n').length
}

async function mountStackedDiff() {
  stubHighlightApi()
  const text = (replacements: Record<number, string> = {}) =>
    `${Array.from({ length: LINE_COUNT }, (_, index) => replacements[index + 1] ?? `line ${index + 1}`).join('\n')}\n`
  const file = createTextDiff({
    newFile: { path: 'repo/a.ts', text: text({ 2: 'two changed', 55: 'fifty five' }) },
    oldFile: { path: 'repo/a.ts', text: text() },
  })
  let mounted: Editor | null = null
  renderWithProviders(
    // The app mounts under StrictMode, which mounts, tears down and remounts. Anything that only
    // survives the first mount is invisible without it.
    <StrictMode>
      <DiffPane
        file={file}
        regions={createDiffRegionStore()}
        side='stacked'
        syntaxBackend={{ kind: 'tree-sitter', provider: null }}
        theme={{}}
        onRegisterEditor={(_side, editor) => {
          mounted = editor
        }}
      />
    </StrictMode>,
  )

  await waitFor(() => expect(mounted).not.toBeNull())

  return {
    editor: mounted as unknown as Editor,
    rowCount: createStackedProjection(file).rows.length,
    rowElements: () => [
      ...document.querySelectorAll<HTMLElement>(
        '.editor-diff-pane-stacked [data-editor-virtual-row]',
      ),
    ],
  }
}
