import '@workspace/ui/globals.css'

import { FileTreeModel } from '@shaulavo/workbench-tree'
import { FileTreeView, type FileTreeViewHandle } from '@shaulavo/workbench-tree/react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

test('FileTreeView renders Fregat paths with filter, keyboard navigation, and inline create', async () => {
  const model = new FileTreeModel({
    compactFolders: true,
    paths: ['README.md', 'src/components/Button.tsx', 'src/index.ts'],
  })
  const handleRef: { current: FileTreeViewHandle | null } = { current: null }
  const created: Array<{ kind: string; name: string; parent: string }> = []
  const opened: string[] = []

  const host = document.createElement('div')
  host.style.height = '240px'
  host.style.width = '320px'
  document.body.append(host)
  root = createRoot(host)

  flushSync(() => {
    root?.render(
      <div className='h-full' data-file-tree=''>
        <FileTreeView
          className='h-full'
          filterPlaceholder='Filter files'
          handleRef={handleRef}
          iconPreset='rich'
          label='Folder tree'
          model={model}
          onCreate={(parent, kind, name) => {
            created.push({ kind, name, parent })
          }}
          onOpenFile={(path) => {
            opened.push(path)
          }}
          rowHeight={20}
          showFilter
        />
      </div>,
    )
  })

  await expect.poll(() => host.querySelector('[data-wb-tree-row][data-path="src"]')).not.toBeNull()
  const srcRow = host.querySelector<HTMLElement>('[data-wb-tree-row][data-path="src"]')!
  expect(srcRow.getBoundingClientRect().height).toBe(20)

  srcRow.focus()
  await expect.poll(() => srcRow.dataset.focused).toBe('true')
  srcRow.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  await expect
    .poll(() => host.querySelector('[data-wb-tree-row][data-path="src/index.ts"]'))
    .not.toBeNull()

  host.querySelector<HTMLElement>('[data-wb-tree-row][data-path="src/index.ts"]')!.click()
  expect(opened).toEqual(['src/index.ts'])

  handleRef.current?.startCreate('src', 'file')
  await expect
    .poll(() => host.querySelector<HTMLInputElement>('[data-testid="wb-tree-inline-input"]'))
    .not.toBeNull()
  const input = host.querySelector<HTMLInputElement>('[data-testid="wb-tree-inline-input"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, 'new.ts')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))

  await expect.poll(() => created).toEqual([{ kind: 'file', name: 'new.ts', parent: 'src' }])
})
