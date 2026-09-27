import '@workspace/ui/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'

import { settleLayout } from '../../../../test/env/settle-layout'
import { TreeHost } from '@/features/workspace/components/tree-host'
import type {
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeSearchBlurBehavior,
} from '@workspace/tree'
import { TreeViewModel } from '@/features/workspace/state/tree-model'

let root: Root | null = null
let model: TreeViewModel | null = null

afterEach(() => {
  model?.cleanUp()
  model = null
  flushSync(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('tree view browser behavior', () => {
  it('restores the initial virtual window and reports user scrolling', async () => {
    const onScrollTopChange = vi.fn()
    const { tree } = await mountBrowserTree({ initialScrollTop: 480, onScrollTopChange })
    const scroll = virtualScroll(tree)
    expect(scroll.scrollTop).toBe(480)
    expect(rowButton(tree, 'src/features/a-20.ts')).toBeTruthy()
    scroll.scrollTop = 360
    scroll.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(onScrollTopChange).toHaveBeenLastCalledWith(360))
  })
  it.each(['right-click', 'both'] as const)(
    'does not render rows on hover in %s mode',
    async (triggerMode) => {
      const renderRowDecoration = vi.fn(() => null)
      const renderMenu = vi.fn(
        (item: FileTreeContextMenuItem, _context: FileTreeContextMenuOpenContext) => {
          const menu = document.createElement('div')
          menu.textContent = item.path
          return menu
        },
      )
      const { tree } = await mountBrowserTree({
        composition: { contextMenu: { enabled: true, triggerMode, render: renderMenu } },
        renderRowDecoration,
      })
      await settleLayout(virtualScroll(tree))
      renderRowDecoration.mockClear()

      for (const path of ['src/features/a-0.ts', 'src/features/a-1.ts', 'src/features/a-2.ts']) {
        rowButton(tree, path).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        await settleBrowserFrames()
        if (triggerMode === 'right-click') continue
        const anchor = tree.querySelector<HTMLElement>('[data-type="context-menu-anchor"]')
        expect(anchor?.getBoundingClientRect().top).toBeCloseTo(
          rowButton(tree, path).getBoundingClientRect().top,
          1,
        )
      }
      expect(renderRowDecoration.mock.calls.length).toBe(0)

      const trigger = tree.querySelector<HTMLButtonElement>('[data-type="context-menu-trigger"]')
      expect(trigger?.dataset.visible).toBe(triggerMode === 'both' ? 'true' : 'false')
      rowButton(tree, 'src/features/a-2.ts').dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
      )
      await settleBrowserFrames()
      expect(
        tree.querySelector<HTMLElement>('[data-type="context-menu-anchor"]')?.dataset.visible,
      ).toBe('false')
      expect(renderRowDecoration.mock.calls.length).toBe(0)
      rowButton(tree, 'src/features/a-2.ts').dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true }),
      )
      await settleBrowserFrames()
      if (triggerMode === 'both') {
        trigger?.click()
      } else {
        rowButton(tree, 'src/features/a-2.ts').dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true }),
        )
      }
      await vi.waitFor(() => expect(renderMenu).toHaveBeenCalledTimes(1))
      expect(renderMenu.mock.calls[0]?.[0].path).toBe('src/features/a-2.ts')
      renderMenu.mock.calls[0]?.[1].close({ restoreFocus: false })
      await settleBrowserFrames()
      const keyboardRow = rowButton(tree, 'src/features/a-1.ts')
      keyboardRow.focus()
      keyboardRow.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true }),
      )
      await vi.waitFor(() => expect(renderMenu).toHaveBeenCalledTimes(2))
      expect(renderMenu.mock.calls[1]?.[0].path).toBe('src/features/a-1.ts')
      expect(renderMenu.mock.calls[1]?.[1].anchorRect?.top).toBeCloseTo(
        keyboardRow.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(trigger!).marginTop),
        1,
      )
    },
  )

  it('positions the menu button on the hovered sticky row without rendering rows', async () => {
    const renderRowDecoration = vi.fn(() => null)
    const renderMenu = vi.fn((item: FileTreeContextMenuItem) => {
      const menu = document.createElement('div')
      menu.textContent = item.path
      return menu
    })
    const { tree } = await mountBrowserTree({
      composition: { contextMenu: { enabled: true, triggerMode: 'both', render: renderMenu } },
      renderRowDecoration,
    })
    const scroll = virtualScroll(tree)
    scroll.scrollTop = 120
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    await vi.waitFor(() => expect(virtualRoot(tree).hasAttribute('data-is-scrolling')).toBe(false))
    await settleBrowserFrames()
    renderRowDecoration.mockClear()
    const stickyRow = tree.querySelector<HTMLElement>(
      '[data-file-tree-sticky-path="src/features/"]',
    )
    expect(stickyRow).not.toBeNull()
    stickyRow!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await settleBrowserFrames()
    const anchor = tree.querySelector<HTMLElement>('[data-type="context-menu-anchor"]')
    expect(anchor?.getBoundingClientRect().top).toBeCloseTo(
      stickyRow!.getBoundingClientRect().top,
      1,
    )
    expect(renderRowDecoration.mock.calls.length).toBe(0)
    tree.querySelector<HTMLButtonElement>('[data-type="context-menu-trigger"]')?.click()
    await vi.waitFor(() => expect(renderMenu).toHaveBeenCalledTimes(1))
    expect(renderMenu.mock.calls[0]?.[0].path).toBe('src/features/')
    expect(scroll.scrollTop).toBe(120)
  })

  it('renders rows, scrolls, keeps sticky rows, handles keyboard focus, and starts rename', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const firstRow = rowButton(tree, 'src/features/')
    expect(firstRow.getAttribute('role')).toBe('treeitem')

    const changedRow = rowButton(tree, 'src/features/a-3.ts')
    expect(changedRow.dataset.itemGitStatus).toBe('modified')

    firstRow.focus()
    firstRow.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))

    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-0.ts')
    })

    const scrollElement = virtualScroll(tree)
    scrollElement.scrollTop = 120
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    await vi.waitFor(() => {
      expect(tree.querySelector('[data-file-tree-sticky-path="src/features/"]')).toBeTruthy()
      expect(virtualRoot(tree).dataset.scrollAtTop).toBeUndefined()
    })

    currentModel.startRenaming('src/features/a-3.ts')

    await vi.waitFor(() => {
      const input = tree.querySelector<HTMLInputElement>('[data-item-rename-input]')
      expect(input?.value).toBe('a-3.ts')
    })
  })

  it('preserves scroll position when selecting a visible row by pointer', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const scrollElement = virtualScroll(tree)
    scrollElement.scrollTop = 120
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    const selectedRow = rowButton(tree, 'src/features/a-3.ts')

    const previousScrollTop = scrollElement.scrollTop
    selectedRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }))
    selectedRow.focus()
    selectedRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    await vi.waitFor(() => {
      expect(currentModel.getSelectedPaths()).toEqual(['src/features/a-3.ts'])
      expect(currentModel.getFocusedPath()).toBe('src/features/a-3.ts')
    })
    expect(scrollElement.scrollTop).toBe(previousScrollTop)
  })

  it('changes density in place while preserving tree state and the logical scroll anchor', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const host = document.querySelector<HTMLElement>('[data-file-tree]')
    const scrollElement = virtualScroll(tree)

    currentModel.focusPath('src/features/a-3.ts')
    currentModel.getItem('src/features/a-3.ts')?.select()
    scrollElement.scrollTop = 120
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    await vi.waitFor(() => {
      expect(currentModel.getFocusedPath()).toBe('src/features/a-3.ts')
      expect(currentModel.getSelectedPaths()).toEqual(['src/features/a-3.ts'])
      expect(scrollElement.scrollTop).toBe(120)
    })

    currentModel.setDensity('compact', 20)

    await vi.waitFor(() => {
      const visibleRow = tree.querySelector<HTMLButtonElement>(
        'button[data-item-path]:not([data-file-tree-sticky-row="true"])',
      )
      expect(host?.style.getPropertyValue('--trees-item-height')).toBe('20px')
      expect(visibleRow?.style.minHeight).toBe('20px')
      expect(scrollElement.scrollTop).toBeCloseTo(100, 5)
    })

    const compactMaxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight
    const compactScrollTop = compactMaxScrollTop - 7
    currentModel.focusPath('src/features/a-27.ts')
    currentModel.getItem('src/features/a-27.ts')?.select()
    currentModel.focus()

    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-27.ts')
    })
    scrollElement.scrollTop = compactScrollTop
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    await vi.waitFor(() => {
      expect(scrollElement.scrollTop).toBe(compactScrollTop)
      expect(tree.querySelector('[data-file-tree-sticky-path="src/features/"]')).toBeTruthy()
    })

    currentModel.setDensity('compact', 24)

    await vi.waitFor(() => {
      const expectedScrollTop = Math.round(compactScrollTop * (24 / 20))
      expect(scrollElement.scrollTop).toBe(expectedScrollTop)
      expect(scrollElement.scrollTop).toBeGreaterThan(compactMaxScrollTop)
      expect(activePath(tree)).toBe('src/features/a-27.ts')
    })
    const directory = currentModel.getItem('src/features/')
    expect(directory != null && 'isExpanded' in directory && directory.isExpanded()).toBe(true)
    expect(currentModel.getFocusedPath()).toBe('src/features/a-27.ts')
    expect(currentModel.getSelectedPaths()).toEqual(['src/features/a-3.ts', 'src/features/a-27.ts'])
  })

  it('preserves keyboard branch order for rename, selection, and directional navigation', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const directoryRow = rowButton(tree, 'src/features/')
    directoryRow.focus()

    dispatchTreeKey(directoryRow, 'F2')
    await vi.waitFor(() => {
      expect(tree.querySelector<HTMLInputElement>('[data-item-rename-input]')?.value).toBe(
        'features',
      )
    })
    const renameInput = tree.querySelector<HTMLInputElement>('[data-item-rename-input]')
    expect(renameInput).not.toBeNull()
    dispatchRenameKey(renameInput as HTMLInputElement, 'Escape')

    await vi.waitFor(() => {
      expect(tree.querySelector('[data-item-rename-input]')).toBeNull()
    })
    const restoredDirectoryRow = rowButton(tree, 'src/features/')
    dispatchTreeKey(restoredDirectoryRow, 'a', { ctrlKey: true })
    await vi.waitFor(() => {
      expect(currentModel.getSelectedPaths().length).toBeGreaterThan(2)
    })
    dispatchTreeKey(restoredDirectoryRow, ' ', { code: 'Space', ctrlKey: true })
    await vi.waitFor(() => {
      expect(currentModel.getSelectedPaths()).not.toContain('src/features/')
    })

    dispatchTreeKey(restoredDirectoryRow, 'End')
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-27.ts')
    })
    dispatchTreeKey(rowButton(tree, 'src/features/a-27.ts'), 'Home')
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/')
    })

    currentModel.focusPath('src/features/')
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/')
    })
    dispatchTreeKey(rowButton(tree, 'src/features/'), 'ArrowLeft')
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/features/').getAttribute('aria-expanded')).toBe('false')
    })
    dispatchTreeKey(rowButton(tree, 'src/features/'), 'ArrowRight')
    await vi.waitFor(() => {
      expect(rowButton(tree, 'src/features/').getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('cancels an earlier smooth reveal when the new target is already visible', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const scrollElement = virtualScroll(tree)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-20.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    for (let frame = 0; frame < 3; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }

    expect(scrollElement.scrollTop).toBe(0)
    expect(
      rowButton(tree, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('settles a late scroll event after cancelling a reveal already in view', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(tree)
    await startSmoothReveal(currentModel, tree)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    // Chromium can deliver one queued compositor step after same-offset cancellation.
    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBeLessThanOrEqual(20)
    expect(
      rowButton(tree, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('invalidates a cancelled reveal when projection order changes its row', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(tree)
    await startSmoothReveal(currentModel, tree)
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.resetPaths([...browserPaths(80), 'src/features/0-before.ts'])
    })
    const rows = tree.querySelectorAll<HTMLButtonElement>('button[data-item-path]')
    expect(rows[1]?.dataset.itemPath).toBe('src/features/0-before.ts')
    expect(rows[2]?.dataset.itemPath).toBe('src/features/a-0.ts')

    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(24)
    expect(
      rowButton(tree, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('discards a cancelled reveal when its path is removed', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(tree)
    await startSmoothReveal(currentModel, tree)
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.remove('src/features/a-0.ts')
    })
    expect(currentModel.getItem('src/features/a-0.ts')).toBeNull()
    const rows = tree.querySelectorAll<HTMLButtonElement>('button[data-item-path]')
    expect(rows[1]?.dataset.itemPath).toBe('src/features/a-1.ts')

    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(24)
  })

  it('a missing scroll row does not suppress an explicit focus request', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({ pathCount: 80 })
    const outsideButton = document.createElement('button')
    document.body.prepend(outsideButton)
    outsideButton.focus()

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-79.ts', { focus: false })
      currentModel.resetPaths(browserPaths(4))
      currentModel.focusPath('src/features/a-0.ts')
      currentModel.focus()
    })

    expect(currentModel.getItem('src/features/a-79.ts')).toBeNull()
    expect(currentModel.getFocusedPath()).toBe('src/features/a-0.ts')
    expect(activePath(tree)).toBe('src/features/a-0.ts')
  })

  it('a cancelled reveal cannot overwrite a newer scroll request', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(tree)
    await startSmoothReveal(currentModel, tree)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-20.ts', { focus: false, offset: 'top' })
    })
    const requestedTop = scrollElement.scrollTop
    await threeAnimationFrames()

    expect(requestedTop).toBeGreaterThan(20)
    expect(scrollElement.scrollTop).toBe(requestedTop)
  })

  it('a cancelled reveal yields to subsequent user scrolling', async () => {
    const { model: currentModel, tree } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(tree)
    await startSmoothReveal(currentModel, tree)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    scrollElement.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }))
    scrollElement.scrollTop = 200
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(200)
  })

  it('settles controller scroll requests and opens search from a printable row key', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const directoryRow = rowButton(tree, 'src/features/')
    directoryRow.focus()
    const scrollElement = virtualScroll(tree)

    currentModel.scrollToPath('src/features/a-20.ts', { focus: false, offset: 'center' })
    await vi.waitFor(() => {
      expect(scrollElement.scrollTop).toBeGreaterThan(0)
    })
    expect(currentModel.getFocusedPath()).toBe('src/features/')
    expect(activePath(tree)).toBe('src/features/')

    // An outside control makes the no-focus-transfer check independent of row virtualization.
    const outsideButton = document.createElement('button')
    document.body.prepend(outsideButton)
    outsideButton.focus()

    currentModel.scrollToPath('src/features/a-20.ts', { offset: 'nearest' })
    await vi.waitFor(() => {
      expect(currentModel.getFocusedPath()).toBe('src/features/a-20.ts')
      expect(document.activeElement).toBe(outsideButton)
    })

    currentModel.cleanUp()
    model = null
    flushSync(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
    const searchTree = await mountSearchTree('retain')
    const searchRow = rowButton(searchTree.tree, 'README.md')
    searchRow.focus()
    dispatchTreeKey(searchRow, 'w')

    await vi.waitFor(() => {
      expect(searchTree.model.isSearchOpen()).toBe(true)
      expect(searchTree.model.getSearchValue()).toBe('w')
      expect(focusedIn(searchTree.tree)).toBe(
        searchTree.tree.querySelector('[data-file-tree-search-input]'),
      )
    })
  })

  it('moves DOM focus only for explicit focus requests, including virtualized rows', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, tree } = await mountBrowserTree()
    const scrollElement = virtualScroll(tree)

    outsideButton.focus()
    currentModel.focusPath('src/features/a-20.ts')
    await vi.waitFor(() => {
      expect(currentModel.getFocusedPath()).toBe('src/features/a-20.ts')
    })
    expect(document.activeElement).toBe(outsideButton)

    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-20.ts')
      expect(scrollElement.scrollTop).toBeGreaterThan(0)
    })

    outsideButton.focus()
    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-20.ts')
    })
  })

  it('does not replay a consumed focus request after remount', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, tree } = await mountBrowserTree()

    currentModel.focusPath('src/features/a-3.ts')
    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(tree)).toBe('src/features/a-3.ts')
    })

    flushSync(() => root?.unmount())
    root = null
    outsideButton.focus()
    const remountedTree = await renderBrowserTree(currentModel)

    expect(document.activeElement).toBe(outsideButton)
    expect(activePath(remountedTree)).toBeNull()
  })

  it('retains an engaged search across blur and refocuses it without clearing the query', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, tree } = await mountSearchTree('retain')
    const searchInput = await openSearch(currentModel, tree, 'worker')

    outsideButton.focus()
    await vi.waitFor(() => {
      expect(focusedIn(tree)).not.toBe(searchInput)
    })
    expect(currentModel.isSearchOpen()).toBe(true)
    expect(currentModel.getSearchValue()).toBe('worker')

    currentModel.openSearch()
    await vi.waitFor(() => {
      expect(focusedIn(tree)).toBe(searchInput)
    })
    expect(currentModel.getSearchValue()).toBe('worker')
  })

  it('uses the shared filter group in the consuming light color scheme', async () => {
    const { tree } = await mountSearchTree('retain', 'light')
    const host = document.querySelector<HTMLElement>('[data-file-tree]')
    const searchInput = tree.querySelector<HTMLInputElement>('[data-file-tree-search-input]')

    expect(host).not.toBeNull()
    expect(searchInput).not.toBeNull()
    expect(getComputedStyle(host!).colorScheme).toBe('light')
    expect(searchInput!.closest('[data-slot="input-group"]')).not.toBeNull()
    expect(getComputedStyle(searchInput!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('keeps rename active for composing keys and commits on ordinary Enter', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const input = await beginRename(currentModel, tree, 'src/features/a-3.ts')
    setRenameValue(input, 'renamed.ts')

    dispatchRenameKey(input, 'Enter', { isComposing: true })
    await expectRenameToRemainActive(tree)

    dispatchRenameKey(input, 'Escape', { legacyComposition: true })
    await expectRenameToRemainActive(tree)

    dispatchRenameKey(input, 'Enter')
    await vi.waitFor(() => {
      expect(tree.querySelector('[data-item-rename-input]')).toBeNull()
      expect(currentModel.getItem('src/features/renamed.ts')).not.toBeNull()
    })
  })

  it('keeps rename active for legacy composition and cancels on ordinary Escape', async () => {
    const { model: currentModel, tree } = await mountBrowserTree()
    const input = await beginRename(currentModel, tree, 'src/features/a-3.ts')
    setRenameValue(input, 'should-not-land.ts')

    dispatchRenameKey(input, 'Escape', { isComposing: true })
    await expectRenameToRemainActive(tree)

    dispatchRenameKey(input, 'Enter', { legacyComposition: true })
    await expectRenameToRemainActive(tree)

    dispatchRenameKey(input, 'Escape')
    await vi.waitFor(() => {
      expect(tree.querySelector('[data-item-rename-input]')).toBeNull()
      expect(currentModel.getItem('src/features/a-3.ts')).not.toBeNull()
      expect(currentModel.getItem('src/features/should-not-land.ts')).toBeNull()
    })
  })

  it.each([
    { keepsSearchOpen: false, searchBlurBehavior: 'close' as const },
    { keepsSearchOpen: true, searchBlurBehavior: 'retain' as const },
  ])(
    'applies $searchBlurBehavior policy to search Enter, click, Escape, and focus',
    async ({ keepsSearchOpen, searchBlurBehavior }) => {
      const { model: currentModel, tree } = await mountSearchTree(searchBlurBehavior)
      const searchInput = await openSearch(currentModel, tree, 'worker')
      const focusedPathBeforeEnter = currentModel.getFocusedPath()
      expect(focusedPathBeforeEnter).not.toBeNull()

      dispatchSearchKey(searchInput, 'Enter')
      await vi.waitFor(() => {
        expect(currentModel.getSelectedPaths()).toEqual([focusedPathBeforeEnter])
        expect(currentModel.isSearchOpen()).toBe(keepsSearchOpen)
      })
      if (keepsSearchOpen) {
        expect(focusedIn(tree)).toBe(searchInput)
      } else {
        expect(activePath(tree)).toBe(focusedPathBeforeEnter)
      }

      const reopenedInput = await openSearch(currentModel, tree, 'worker')
      const clickedResult = rowButton(tree, 'src/utils/worker-b.ts')
      clickedResult.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }),
      )
      clickedResult.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

      await vi.waitFor(() => {
        expect(currentModel.getSelectedPaths()).toEqual(['src/utils/worker-b.ts'])
        expect(currentModel.isSearchOpen()).toBe(keepsSearchOpen)
      })
      if (keepsSearchOpen) {
        expect(focusedIn(tree)).toBe(reopenedInput)
      }

      const escapeInput = await openSearch(currentModel, tree, 'worker')
      dispatchSearchKey(escapeInput, 'Escape')
      await vi.waitFor(() => {
        expect(currentModel.isSearchOpen()).toBe(false)
      })
    },
  )
})

async function beginRename(
  currentModel: TreeViewModel,
  tree: ParentNode,
  path: string,
): Promise<HTMLInputElement> {
  currentModel.startRenaming(path)
  await vi.waitFor(() => {
    expect(tree.querySelector('[data-item-rename-input]')).not.toBeNull()
  })

  const input = tree.querySelector<HTMLInputElement>('[data-item-rename-input]')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

function setRenameValue(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function dispatchRenameKey(
  input: HTMLInputElement,
  key: 'Enter' | 'Escape',
  options: { isComposing?: boolean; legacyComposition?: boolean } = {},
): void {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    isComposing: options.isComposing,
    key,
  })
  if (options.legacyComposition === true) {
    Object.defineProperty(event, 'keyCode', { value: 229 })
  }
  input.dispatchEvent(event)
}

async function expectRenameToRemainActive(tree: ParentNode): Promise<void> {
  await vi.waitFor(() => {
    expect(tree.querySelector('[data-item-rename-input]')).not.toBeNull()
  })
}

function dispatchSearchKey(input: HTMLInputElement, key: 'Enter' | 'Escape'): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
}

function dispatchTreeKey(
  element: HTMLElement,
  key: string,
  options: { code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      code: options.code,
      ctrlKey: options.ctrlKey,
      key,
      metaKey: options.metaKey,
      shiftKey: options.shiftKey,
    }),
  )
}

async function settleBrowserFrames() {
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
}

async function mountBrowserTree(
  options: Pick<
    ConstructorParameters<typeof TreeViewModel>[0],
    | 'composition'
    | 'renderRowDecoration'
    | 'stickyFolders'
    | 'initialScrollTop'
    | 'onScrollTopChange'
  > & { pathCount?: number } = {},
) {
  const mountedModel = new TreeViewModel({
    composition: options.composition,
    renderRowDecoration: options.renderRowDecoration,
    gitStatus: [{ path: 'src/features/a-3.ts', status: 'modified' }],
    initialExpansion: 'open',
    initialVisibleRowCount: 6,
    initialScrollTop: options.initialScrollTop,
    onScrollTopChange: options.onScrollTopChange,
    itemHeight: 24,
    paths: browserPaths(options.pathCount),
    renaming: true,
    stickyFolders: options.stickyFolders ?? true,
  })
  model = mountedModel

  return { model: mountedModel, tree: await renderBrowserTree(mountedModel) }
}

async function renderBrowserTree(mountedModel: TreeViewModel) {
  const container = document.createElement('main')
  container.style.height = '180px'
  container.style.width = '360px'
  document.body.append(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <TreeHost
        aria-label='Files'
        model={mountedModel}
        style={{ display: 'block', height: '180px', width: '360px' }}
      />,
    )
  })

  return await waitForTree()
}

async function mountSearchTree(
  searchBlurBehavior: FileTreeSearchBlurBehavior,
  colorScheme?: 'dark' | 'light',
) {
  const container = document.createElement('main')
  container.style.height = '240px'
  container.style.width = '360px'
  if (colorScheme) container.style.colorScheme = colorScheme
  document.body.append(container)
  root = createRoot(container)
  const mountedModel = new TreeViewModel({
    fileTreeSearchMode: 'hide-non-matches',
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    initialVisibleRowCount: 10,
    paths: ['README.md', 'src/utils/stream.ts', 'src/utils/worker-a.ts', 'src/utils/worker-b.ts'],
    search: true,
    searchBlurBehavior,
  })
  model = mountedModel

  flushSync(() => {
    root?.render(<TreeHost aria-label='Search files' model={mountedModel} />)
  })

  return { model: mountedModel, tree: await waitForTree() }
}

async function openSearch(
  currentModel: TreeViewModel,
  tree: ParentNode,
  query: string,
): Promise<HTMLInputElement> {
  if (!currentModel.isSearchOpen()) {
    currentModel.openSearch(query)
  }

  const input = tree.querySelector<HTMLInputElement>('[data-file-tree-search-input]')
  expect(input).not.toBeNull()
  await vi.waitFor(() => {
    expect(currentModel.isSearchOpen()).toBe(true)
    expect(input?.value).toBe(query)
    expect(focusedIn(tree)).toBe(input)
  })

  return input as HTMLInputElement
}

function browserPaths(pathCount = 28) {
  const paths = ['src/', 'src/features/']

  for (let index = 0; index < pathCount; index += 1) {
    paths.push(`src/features/a-${index}.ts`)
  }

  return paths
}

async function waitForTree() {
  await vi.waitFor(() => {
    expect(document.querySelector('[data-file-tree] [role="tree"]')).toBeTruthy()
  })

  const tree = document.querySelector<HTMLElement>('[data-file-tree]')
  if (!tree) throw new Error('missing file tree')

  return tree
}

/** The focused element when it is inside `tree`. */
function focusedIn(tree: ParentNode) {
  const active = document.activeElement
  return active && tree.contains(active) ? active : null
}

function rowButton(tree: ParentNode, path: string) {
  const button = tree.querySelector<HTMLButtonElement>(
    `button[data-item-path="${path}"]:not([data-file-tree-sticky-row="true"])`,
  )
  if (!button) throw new Error(`missing row ${path}`)

  return button
}

function activePath(tree: ParentNode) {
  const activeElement = focusedIn(tree)
  if (!(activeElement instanceof HTMLElement)) return null

  return activeElement.dataset.itemPath ?? null
}

function virtualRoot(tree: ParentNode) {
  const rootElement = tree.querySelector<HTMLElement>('[data-file-tree-virtualized-root="true"]')
  if (!rootElement) throw new Error('missing virtual root')

  return rootElement
}

function virtualScroll(tree: ParentNode) {
  const scrollElement = tree.querySelector<HTMLElement>(
    '[data-file-tree-virtualized-scroll="true"]',
  )
  if (!scrollElement) throw new Error('missing virtual scroll')

  return scrollElement
}

async function startSmoothReveal(currentModel: TreeViewModel, tree: ParentNode) {
  currentModel.setDensity('compact', 20)
  await expect
    .poll(() => rowButton(tree, 'src/features/a-0.ts').getBoundingClientRect().height)
    .toBe(20)
  const scrollElement = virtualScroll(tree)
  scrollElement.scrollTop = 10
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  flushSync(() => {
    currentModel.scrollToPath('src/features/a-79.ts', {
      behavior: 'smooth',
      focus: false,
      offset: 'top',
    })
  })
  expect(scrollElement.scrollTop).toBe(10)
}

async function threeAnimationFrames() {
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
