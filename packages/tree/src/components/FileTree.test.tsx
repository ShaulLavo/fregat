import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useState } from 'react'

import { FileTree } from './FileTree'
import { useFileTree } from '../hooks/useFileTree'
import type { FileTreeIcons } from '../utils/iconConfig'
import type { GitStatusEntry } from '../utils/publicTypes'
import type {
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
} from '../utils/model/publicTypes'
import { FileTree as FileTreeModel } from '../utils/render/FileTree'

let root: Root | null = null

const ICON_FALLBACK_CASES = [
  {
    expectedTypeScriptIcon: '#file-tree-builtin-typescript',
    set: 'standard',
  },
  {
    expectedTypeScriptIcon: '#test-generic-file',
    set: 'minimal',
  },
] as const

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('FileTree React integration', () => {
  it('renders the model and reports selection changes', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)

    function Harness() {
      const [selectedPaths, setSelectedPaths] = useState<readonly string[]>(['src/a.ts'])
      const { model } = useFileTree({
        initialExpansion: 'open',
        initialSelectedPaths: ['src/a.ts'],
        onSelectionChange: setSelectedPaths,
        paths: ['src/', 'src/a.ts', 'src/b.ts'],
      })

      return (
        <>
          <FileTree aria-label='Files' model={model} />
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
      const { model } = useFileTree({
        gitStatus,
        initialExpansion: 'open',
        paths: ['src/', 'src/a.ts'],
      })

      return (
        <>
          <FileTree aria-label='Files' model={model} />
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

  it('syncs icon option changes into the stable model', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)

    function Harness() {
      const [icons, setIcons] = useState<FileTreeIcons>(() => fileIconRemap('first-file-icon'))
      const { model } = useFileTree({
        icons,
        initialExpansion: 'open',
        paths: ['src/', 'src/a.ts'],
      })

      return (
        <>
          <FileTree aria-label='Files' model={model} />
          <button
            data-testid='set-icons'
            type='button'
            onClick={() => setIcons(fileIconRemap('second-file-icon'))}
          >
            Set Icons
          </button>
        </>
      )
    }

    flushSync(() => root?.render(<Harness />))
    const tree = await waitForTree()
    expect(fileIconHref(tree, 'src/a.ts')).toBe('#first-file-icon')

    clickButton('set-icons')

    await vi.waitFor(() => {
      expect(fileIconHref(tree, 'src/a.ts')).toBe('#second-file-icon')
    })
  })

  it('syncs density changes into the stable model and virtualized geometry', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const capturedModels: { first: FileTreeModel | null; latest: FileTreeModel | null } = {
      first: null,
      latest: null,
    }

    function Harness() {
      const [itemHeight, setItemHeight] = useState(20)
      const { model } = useFileTree({
        density: 'compact',
        initialExpansion: 'open',
        itemHeight,
        paths: ['src/', 'src/a.ts', 'src/b.ts'],
      })
      capturedModels.first ??= model
      capturedModels.latest = model

      return (
        <>
          <FileTree aria-label='Files' model={model} />
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

    capturedModels.first?.setDensity('compact', 20)

    await vi.waitFor(() => {
      expect(host?.style.getPropertyValue('--trees-item-height')).toBe('20px')
      expect(rowButton(tree, 'src/a.ts').style.minHeight).toBe('20px')
    })
  })

  it('projects loading paths onto their virtualized rows', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const treeModel = new FileTreeModel({
      initialExpansion: 'open',
      paths: ['src/', 'src/a.ts', 'src/b.ts'],
    })

    flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
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

  it.each(ICON_FALLBACK_CASES)(
    'uses the generic file remap as the $set fallback',
    async ({ expectedTypeScriptIcon, set }) => {
      const container = document.createElement('main')
      document.body.append(container)
      root = createRoot(container)
      const treeModel = new FileTreeModel({
        icons: {
          remap: { 'file-tree-icon-file': 'test-generic-file' },
          set,
        },
        initialExpansion: 'open',
        paths: ['unknown.xyz', 'src/index.ts'],
      })

      flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
      const tree = await waitForTree()

      expect(fileIconHref(tree, 'unknown.xyz')).toBe('#test-generic-file')
      expect(fileIconHref(tree, 'src/index.ts')).toBe(expectedTypeScriptIcon)
      treeModel.cleanUp()
    },
  )

  it('mounts and cleans up through the public React wrapper without runtime warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const treeModel = new FileTreeModel({
      initialExpansion: 'open',
      paths: ['src/', 'src/a.ts'],
    })

    flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/a.ts')).toBeTruthy()
    })

    flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
    flushSync(() => root?.unmount())
    root = null
    await Promise.resolve()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    treeModel.cleanUp()
  })

  it('resets view hook state when the public wrapper replaces its model', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const firstModel = new FileTreeModel({
      initialSearchQuery: 'first',
      paths: ['first.ts'],
      search: true,
      searchBlurBehavior: 'retain',
    })
    const nextModel = new FileTreeModel({
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
          <FileTree aria-label='Files' model={firstModel} />
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
      expect(
        tree.querySelector('[data-file-tree-search-container]')?.getAttribute('data-open'),
      ).toBe('false')
    })

    flushSync(() =>
      root?.render(
        <>
          <button data-testid='outside' type='button'>
            Outside
          </button>
          <FileTree aria-label='Files' model={nextModel} />
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

    firstModel.cleanUp()
    nextModel.cleanUp()
  })

  it('keeps a right-click context menu mounted across incidental controller renders', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const openedItems: FileTreeContextMenuItem[] = []
    const openedContexts: FileTreeContextMenuOpenContext[] = []
    const renderMenu = vi.fn(
      (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
        const menu = document.createElement('div')
        menu.textContent = item.path
        openedItems.push(item)
        openedContexts.push(context)
        return menu
      },
    )
    const treeModel = new FileTreeModel({
      composition: {
        contextMenu: {
          enabled: true,
          render: renderMenu,
          triggerMode: 'both',
        },
      },
      initialExpansion: 'open',
      initialSelectedPaths: ['src/a.ts'],
      paths: ['src/', 'src/a.ts', 'src/b.ts'],
    })

    flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()
    rowButton(tree, 'src/a.ts').dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 37,
        clientY: 53,
        composed: true,
      }),
    )

    await vi.waitFor(() => {
      expect(renderMenu).toHaveBeenCalledTimes(1)
    })
    expect(openedItems).toEqual([{ kind: 'file', name: 'a.ts', path: 'src/a.ts' }])
    expect(openedContexts[0]?.anchorRect).toEqual({
      bottom: 53,
      height: 0,
      left: 37,
      right: 37,
      top: 53,
      width: 0,
      x: 37,
      y: 53,
    })

    treeModel.getItem('src/b.ts')?.select()
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/b.ts').getAttribute('aria-selected')).toBe('true')
    })
    expect(renderMenu).toHaveBeenCalledTimes(1)
    treeModel.cleanUp()
  })

  it('opens the focused row context menu from Shift+F10 and closes through its context', async () => {
    const container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
    const onClose = vi.fn()
    const openedContexts: FileTreeContextMenuOpenContext[] = []
    let menuAction: HTMLButtonElement | null = null
    const renderMenu = vi.fn(
      (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
        const menu = document.createElement('div')
        const action = document.createElement('button')
        action.textContent = item.path
        menu.append(action)
        menuAction = action
        openedContexts.push(context)
        return menu
      },
    )
    const treeModel = new FileTreeModel({
      composition: {
        contextMenu: {
          enabled: true,
          onClose,
          render: renderMenu,
          triggerMode: 'both',
        },
      },
      initialExpansion: 'open',
      initialSelectedPaths: ['src/a.ts'],
      paths: ['src/', 'src/a.ts'],
    })

    flushSync(() => root?.render(<FileTree aria-label='Files' model={treeModel} />))
    const tree = await waitForTree()
    const treeRoot = tree.querySelector<HTMLElement>('[role="tree"]')
    expect(treeRoot).not.toBeNull()
    treeRoot?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'F10',
        shiftKey: true,
      }),
    )

    await vi.waitFor(() => {
      expect(renderMenu).toHaveBeenCalledTimes(1)
    })
    expect(renderMenu.mock.calls[0]?.[0]).toEqual({
      kind: 'file',
      name: 'a.ts',
      path: 'src/a.ts',
    })
    expect(openedContexts[0]?.anchorElement.dataset.type).toBe('context-menu-trigger')
    expect(document.activeElement).toBe(menuAction)

    openedContexts[0]?.close({ restoreFocus: false })
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(
        tree.querySelector('[data-type="context-menu-trigger"]')?.getAttribute('aria-expanded'),
      ).toBe('false')
    })
    treeModel.cleanUp()
  })
})

function fileIconRemap(iconName: string): FileTreeIcons {
  return {
    remap: {
      'file-tree-icon-file': iconName,
    },
    set: 'none',
  }
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

function fileIconHref(tree: ParentNode, path: string) {
  const iconUse = rowButton(tree, path).querySelector<SVGUseElement>(
    '[data-item-section="icon"] use',
  )
  if (!iconUse) throw new Error(`missing file icon ${path}`)

  return iconUse.getAttribute('href')
}

function clickButton(testId: string) {
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!button) throw new Error(`missing button ${testId}`)

  button.click()
}
