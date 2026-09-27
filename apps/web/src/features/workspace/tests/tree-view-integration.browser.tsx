import '@workspace/ui/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useEffect, useEffectEvent, useState } from 'react'

import { TreeHost } from '@/features/workspace/components/tree-host'
import { useTreeModel } from '@/features/workspace/hooks/use-tree-model'
import type { GitStatusEntry } from '@workspace/tree'
import type { FileTreeContextMenuItem } from '@workspace/tree'
import { TreeViewModel } from '@/features/workspace/state/tree-model'
import type { TreeRowMenuHandle } from '@/features/workspace/utils/tree-row-menu-open'
import { fileIconRule, iconForEntry } from '@/lib/file-icons'

let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('tree view React integration', () => {
  it('renders the model and reports selection changes', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)

    function Harness() {
      const [selectedPaths, setSelectedPaths] = useState<readonly string[]>(['src/a.ts'])
      const { model } = useTreeModel({
        initialExpansion: 'open',
        initialSelectedPaths: ['src/a.ts'],
        onSelectionChange: setSelectedPaths,
        paths: ['src/', 'src/a.ts', 'src/b.ts'],
      })

      return (
        <>
          <TreeHost aria-label='Files' model={model} />
          <output data-testid='selection'>{selectedPaths.join(',')}</output>
          <button
            data-testid='select-b'
            type='button'
            onClick={() => model.getItem('src/b.ts')?.select()}
          >
            Select B
          </button>
        </>
      )
    }

    flushSync(() => root?.render(<Harness />))

    await vi.waitFor(() => {
      expect(document.querySelector('[data-file-tree] [role="tree"]')).toBeTruthy()
      expect(document.querySelector('[data-testid="selection"]')?.textContent).toBe('src/a.ts')
    })

    clickButton('select-b')

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="selection"]')?.textContent).toBe(
        'src/a.ts,src/b.ts',
      )
    })
  })

  it('syncs git status option changes into the stable model', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)

    function Harness() {
      const [gitStatus, setGitStatus] = useState<readonly GitStatusEntry[]>([])
      const { model } = useTreeModel({
        gitStatus,
        initialExpansion: 'open',
        paths: ['src/', 'src/a.ts'],
      })

      return (
        <>
          <TreeHost aria-label='Files' model={model} />
          <button
            data-testid='set-git-status'
            type='button'
            onClick={() => setGitStatus([{ path: 'src/a.ts', status: 'modified' }])}
          >
            Set Git Status
          </button>
        </>
      )
    }

    flushSync(() => root?.render(<Harness />))
    const tree = await waitForTree()
    expect(rowButton(tree, 'src/a.ts').dataset.itemGitStatus).toBeUndefined()

    clickButton('set-git-status')

    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/a.ts').dataset.itemGitStatus).toBe('modified')
    })
  })

  it('syncs density changes into the stable model and virtualized geometry', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const capturedModels: { first: TreeViewModel | null; latest: TreeViewModel | null } = {
      first: null,
      latest: null,
    }

    function Harness() {
      const [itemHeight, setItemHeight] = useState(20)
      const { model } = useTreeModel({
        initialExpansion: 'open',
        itemHeight,
        paths: ['src/', 'src/a.ts', 'src/b.ts'],
      })
      capturedModels.first ??= model
      capturedModels.latest = model

      return (
        <>
          <TreeHost aria-label='Files' model={model} />
          <button data-testid='set-density' type='button' onClick={() => setItemHeight(24)}>
            Use cozy density
          </button>
        </>
      )
    }

    flushSync(() => root?.render(<Harness />))
    const tree = await waitForTree()
    const host = document.querySelector<HTMLElement>('[data-file-tree]')
    expect(host?.style.getPropertyValue('--trees-item-height')).toBe('20px')
    expect(rowButton(tree, 'src/a.ts').style.minHeight).toBe('20px')

    clickButton('set-density')

    await vi.waitFor(() => {
      expect(capturedModels.latest).toBe(capturedModels.first)
      expect(capturedModels.first?.getItemHeight()).toBe(24)
      expect(host?.style.getPropertyValue('--trees-item-height')).toBe('24px')
      expect(rowButton(tree, 'src/a.ts').style.minHeight).toBe('24px')
      expect(
        tree.querySelector<HTMLElement>('[data-file-tree-virtualized-list="true"]')?.style.height,
      ).toBe('72px')
    })

    capturedModels.first?.setItemHeight(20)

    await vi.waitFor(() => {
      expect(host?.style.getPropertyValue('--trees-item-height')).toBe('20px')
      expect(rowButton(tree, 'src/a.ts').style.minHeight).toBe('20px')
    })
  })

  it('projects loading paths onto their virtualized rows', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const treeModel = new TreeViewModel({
      initialExpansion: 'open',
      paths: ['src/', 'src/a.ts', 'src/b.ts'],
    })

    flushSync(() => root?.render(<TreeHost aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()

    treeModel.setLoadingPaths(['src/a.ts'])

    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/a.ts').getAttribute('aria-busy')).toBe('true')
      expect(rowButton(tree, 'src/a.ts').dataset.itemLoading).toBe('true')
      expect(rowButton(tree, 'src/b.ts').dataset.itemLoading).toBeUndefined()
    })

    treeModel.setLoadingPaths([])

    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/a.ts').dataset.itemLoading).toBeUndefined()
    })
  })

  it('draws each file row with its glyph from the document sprite, in its hue', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const treeModel = new TreeViewModel({
      initialExpansion: 'open',
      paths: ['unknown.xyz', 'src/index.ts'],
    })

    flushSync(() => root?.render(<TreeHost aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()

    for (const name of ['unknown.xyz', 'src/index.ts']) {
      const rule = fileIconRule(iconForEntry({ name: name.split('/').at(-1)!, type: 'file' }))
      const icon = fileIcon(tree, name)
      expect(icon.querySelector('use')?.getAttribute('href')).toBe(`#app-vscode-icon-${rule.glyph}`)
      expect(icon.getAttribute('class')).toContain(rule.className.split(' ')[0])
    }
  })

  it('mounts and cleans up through the public React wrapper without runtime warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const treeModel = new TreeViewModel({
      initialExpansion: 'open',
      paths: ['src/', 'src/a.ts'],
    })

    flushSync(() => root?.render(<TreeHost aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/a.ts')).toBeTruthy()
    })

    flushSync(() => root?.render(<TreeHost aria-label='Files' model={treeModel} />))
    flushSync(() => root?.unmount())
    root = null
    await Promise.resolve()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('resets view hook state when the public wrapper replaces its model', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const firstModel = new TreeViewModel({
      initialSearchQuery: 'first',
      paths: ['first.ts'],
      search: true,
      searchBlurBehavior: 'retain',
    })
    const nextModel = new TreeViewModel({
      initialSearchQuery: 'second',
      paths: ['second.ts'],
      search: true,
      searchBlurBehavior: 'retain',
    })

    flushSync(() =>
      root?.render(
        <>
          <button data-testid='outside' type='button'>
            Outside
          </button>
          <TreeHost aria-label='Files' model={firstModel} />
        </>,
      ),
    )
    const firstHost = document.querySelector('[data-file-tree]')
    const tree = await waitForTree()
    await vi.waitFor(() => {
      expect(tree.querySelector<HTMLInputElement>('[data-file-tree-search-input]')?.value).toBe(
        'first',
      )
    })

    const outsideButton = document.querySelector<HTMLButtonElement>('[data-testid="outside"]')
    expect(outsideButton).not.toBeNull()
    outsideButton?.focus()
    firstModel.closeSearch()
    await vi.waitFor(() => {
      expect(tree.querySelector<HTMLInputElement>('[data-file-tree-search-input]')?.value).toBe('')
    })

    flushSync(() =>
      root?.render(
        <>
          <button data-testid='outside' type='button'>
            Outside
          </button>
          <TreeHost aria-label='Files' model={nextModel} />
        </>,
      ),
    )
    await vi.waitFor(() => {
      expect(document.querySelector('[data-file-tree]')).toBe(firstHost)
      expect(tree.querySelector<HTMLInputElement>('[data-file-tree-search-input]')?.value).toBe(
        'second',
      )
    })
    expect(document.activeElement).toBe(outsideButton)
  })

  it('keeps a right-click context menu mounted across incidental controller renders', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const mounts: FileTreeContextMenuItem[] = []
    const menus: TreeRowMenuHandle[] = []
    const treeModel = new TreeViewModel({
      initialExpansion: 'open',
      initialSelectedPaths: ['src/a.ts'],
      paths: ['src/', 'src/a.ts', 'src/b.ts'],
    })

    flushSync(() =>
      root?.render(
        <TreeHost
          aria-label='Files'
          model={treeModel}
          renderContextMenu={(item, menu) => {
            menus.push(menu)
            return <MenuProbe item={item} onMount={(mounted) => mounts.push(mounted)} />
          }}
        />,
      ),
    )
    const tree = await waitForTree()
    rowButton(tree, 'src/a.ts').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 37, clientY: 53 }),
    )

    await vi.waitFor(() => expect(mounts).toHaveLength(1))
    expect(mounts).toEqual([{ kind: 'file', name: 'a.ts', path: 'src/a.ts' }])
    const anchorRect = menus.at(-1)?.anchor.getBoundingClientRect()
    expect({ x: anchorRect?.x, y: anchorRect?.y }).toEqual({ x: 37, y: 53 })

    treeModel.getItem('src/b.ts')?.select()
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/b.ts').getAttribute('aria-selected')).toBe('true')
    })
    expect(mounts).toHaveLength(1)
    expect(document.querySelector('[data-menu-probe]')?.textContent).toBe('src/a.ts')
  })

  it('opens the focused row menu from Shift+F10 and closes through its handle', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const menus: TreeRowMenuHandle[] = []
    const treeModel = new TreeViewModel({
      initialExpansion: 'open',
      initialSelectedPaths: ['src/a.ts'],
      paths: ['src/', 'src/a.ts'],
    })

    flushSync(() =>
      root?.render(
        <TreeHost
          aria-label='Files'
          model={treeModel}
          renderContextMenu={(item, menu) => {
            menus.push(menu)
            return <MenuProbe item={item} onMount={() => {}} />
          }}
        />,
      ),
    )
    const tree = await waitForTree()
    const treeRoot = tree.querySelector<HTMLElement>('[role="tree"]')
    expect(treeRoot).not.toBeNull()
    treeRoot?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true }),
    )

    await vi.waitFor(() => {
      expect(document.querySelector('[data-menu-probe]')?.textContent).toBe('src/a.ts')
    })
    expect(menus.at(-1)?.anchor.contextElement).toBe(rowButton(tree, 'src/a.ts'))

    flushSync(() => menus.at(-1)?.onOpenChange(false))
    await vi.waitFor(() => expect(document.querySelector('[data-menu-probe]')).toBeNull())
  })
})

/** Stands in for the app's menu; reports each mount so a remount is visible. */
function MenuProbe({
  item,
  onMount,
}: {
  readonly item: FileTreeContextMenuItem
  readonly onMount: (item: FileTreeContextMenuItem) => void
}) {
  const reportMount = useEffectEvent(() => onMount(item))
  useEffect(() => {
    reportMount()
  }, [])
  return <div data-menu-probe>{item.path}</div>
}

async function waitForTree() {
  await vi.waitFor(() => {
    expect(document.querySelector('[data-file-tree] [role="tree"]')).toBeTruthy()
  })

  const tree = document.querySelector<HTMLElement>('[data-file-tree]')
  if (!tree) throw new Error('missing file tree')

  return tree
}

function rowButton(tree: ParentNode, path: string) {
  const button = tree.querySelector<HTMLButtonElement>(`button[data-item-path="${path}"]`)
  if (!button) throw new Error(`missing row ${path}`)

  return button
}

function fileIcon(tree: ParentNode, path: string) {
  const icon = rowButton(tree, path).querySelector<SVGSVGElement>('[data-slot="tree-row-lane"] svg')
  if (!icon) throw new Error(`missing file icon ${path}`)

  return icon
}

function clickButton(testId: string) {
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!button) throw new Error(`missing button ${testId}`)

  button.click()
}
