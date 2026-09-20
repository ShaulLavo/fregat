import '@workspace/ui/globals.css'
import { createDiffRegionStore, createTextDiff } from '@singapore-editor/diff'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'

// A pure rename has no hunks, and for a long time that meant the pane drew a sentence where the
// file should have been. What replaces it is whole-file context rows, which only a real browser can
// confirm: the rows are virtualized, so "the projection has 400 rows" says nothing about whether
// any of them reached the screen.

const LINE_COUNT = 400

let root: Root | null = null

afterEach(() => {
  if (root) flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

test('a renamed file with no content changes paints its text in both panes', async () => {
  mountRenameDiff()

  const old = await paneText('old')
  const next = await paneText('new')

  expect(old).toContain('line 1')
  expect(next).toContain('line 1')
  expect(old).not.toContain('No changes')
  expect(next).not.toContain('No changes')
})

function mountRenameDiff() {
  seedBootMirrorTheme('dark')
  const text = `${Array.from({ length: LINE_COUNT }, (_, index) => `line ${index + 1}`).join('\n')}\n`
  const file = createTextDiff({
    newFile: { path: 'repo/renamed.ts', text },
    oldFile: { path: 'repo/original.ts', text },
  })
  expect(file.hunks).toEqual([])

  const host = document.createElement('div')
  host.style.height = '400px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() =>
    root?.render(
      <StrictMode>
        <AppProviders queryClient={createTestQueryClient()}>
          <DiffEditor file={file} mode='split' regions={createDiffRegionStore()} />
        </AppProviders>
      </StrictMode>,
    ),
  )
}

async function paneText(side: 'new' | 'old') {
  const selector = `.editor-diff-pane-${side} .editor-virtualized`
  await expect.poll(() => document.querySelector(selector)?.textContent).toContain('line')

  return document.querySelector<HTMLElement>(selector)?.textContent ?? ''
}
