import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'

import { FileTree } from './FileTree'
import type { FileTreeSearchBlurBehavior } from '../utils/model/publicTypes'
import { FileTree as FileTreeModel } from '../utils/render/FileTree'

let root: Root | null = null
let model: FileTreeModel | null = null

afterEach(() => {
  model?.cleanUp()
  model = null
  flushSync(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('FileTree browser behavior', () => {
  it('renders rows, scrolls, keeps sticky rows, handles keyboard focus, and starts rename', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const firstRow = rowButton(shadowRoot, 'src/features/')
    expect(firstRow.getAttribute('role')).toBe('treeitem')

    const changedRow = rowButton(shadowRoot, 'src/features/a-3.ts')
    expect(changedRow.dataset.itemGitStatus).toBe('modified')

    firstRow.focus()
    firstRow.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))

    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/a-0.ts')
    })

    const scrollElement = virtualScroll(shadowRoot)
    scrollElement.scrollTop = 120
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('[data-file-tree-sticky-path="src/features/"]')).toBeTruthy()
      expect(virtualRoot(shadowRoot).dataset.scrollAtTop).toBeUndefined()
    })

    currentModel.startRenaming('src/features/a-3.ts')

    await vi.waitFor(() => {
      const input = shadowRoot.querySelector<HTMLInputElement>('[data-item-rename-input]')
      expect(input?.value).toBe('a-3.ts')
    })
  })

  it('preserves scroll position when selecting a visible row by pointer', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const scrollElement = virtualScroll(shadowRoot)
    scrollElement.scrollTop = 120
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    const selectedRow = rowButton(shadowRoot, 'src/features/a-3.ts')

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
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const host = document.querySelector<HTMLElement>('file-tree-container')
    const scrollElement = virtualScroll(shadowRoot)

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
      const visibleRow = shadowRoot.querySelector<HTMLButtonElement>(
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
      expect(activePath(shadowRoot)).toBe('src/features/a-27.ts')
    })
    scrollElement.scrollTop = compactScrollTop
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))

    await vi.waitFor(() => {
      expect(scrollElement.scrollTop).toBe(compactScrollTop)
      expect(shadowRoot.querySelector('[data-file-tree-sticky-path="src/features/"]')).toBeTruthy()
    })

    currentModel.setDensity('compact', 24)

    await vi.waitFor(() => {
      const expectedScrollTop = Math.round(compactScrollTop * (24 / 20))
      expect(scrollElement.scrollTop).toBe(expectedScrollTop)
      expect(scrollElement.scrollTop).toBeGreaterThan(compactMaxScrollTop)
      expect(activePath(shadowRoot)).toBe('src/features/a-27.ts')
    })
    const directory = currentModel.getItem('src/features/')
    expect(directory != null && 'isExpanded' in directory && directory.isExpanded()).toBe(true)
    expect(currentModel.getFocusedPath()).toBe('src/features/a-27.ts')
    expect(currentModel.getSelectedPaths()).toEqual(['src/features/a-3.ts', 'src/features/a-27.ts'])
  })

  it('preserves keyboard branch order for rename, selection, and directional navigation', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const directoryRow = rowButton(shadowRoot, 'src/features/')
    directoryRow.focus()

    dispatchTreeKey(directoryRow, 'F2')
    await vi.waitFor(() => {
      expect(shadowRoot.querySelector<HTMLInputElement>('[data-item-rename-input]')?.value).toBe(
        'features',
      )
    })
    const renameInput = shadowRoot.querySelector<HTMLInputElement>('[data-item-rename-input]')
    expect(renameInput).not.toBeNull()
    dispatchRenameKey(renameInput as HTMLInputElement, 'Escape')

    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull()
    })
    const restoredDirectoryRow = rowButton(shadowRoot, 'src/features/')
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
      expect(activePath(shadowRoot)).toBe('src/features/a-27.ts')
    })
    dispatchTreeKey(rowButton(shadowRoot, 'src/features/a-27.ts'), 'Home')
    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/')
    })

    currentModel.focusPath('src/features/')
    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/')
    })
    dispatchTreeKey(rowButton(shadowRoot, 'src/features/'), 'ArrowLeft')
    await vi.waitFor(() => {
      expect(rowButton(shadowRoot, 'src/features/').getAttribute('aria-expanded')).toBe('false')
    })
    dispatchTreeKey(rowButton(shadowRoot, 'src/features/'), 'ArrowRight')
    await vi.waitFor(() => {
      expect(rowButton(shadowRoot, 'src/features/').getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('cancels an earlier smooth reveal when the new target is already visible', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const scrollElement = virtualScroll(shadowRoot)

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
      rowButton(shadowRoot, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('settles a late scroll event after cancelling a reveal already in view', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(shadowRoot)
    await startSmoothReveal(currentModel, shadowRoot)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    // Chromium can deliver one queued compositor step after same-offset cancellation.
    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBeLessThanOrEqual(20)
    expect(
      rowButton(shadowRoot, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('invalidates a cancelled reveal when projection order changes its row', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(shadowRoot)
    await startSmoothReveal(currentModel, shadowRoot)
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.resetPaths([...browserPaths(80), 'src/features/0-before.ts'])
    })
    const rows = shadowRoot.querySelectorAll<HTMLButtonElement>('button[data-item-path]')
    expect(rows[1]?.dataset.itemPath).toBe('src/features/0-before.ts')
    expect(rows[2]?.dataset.itemPath).toBe('src/features/a-0.ts')

    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(24)
    expect(
      rowButton(shadowRoot, 'src/features/a-0.ts').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top)
  })

  it('discards a cancelled reveal when its path is removed', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(shadowRoot)
    await startSmoothReveal(currentModel, shadowRoot)
    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    flushSync(() => {
      currentModel.remove('src/features/a-0.ts')
    })
    expect(currentModel.getItem('src/features/a-0.ts')).toBeNull()
    const rows = shadowRoot.querySelectorAll<HTMLButtonElement>('button[data-item-path]')
    expect(rows[1]?.dataset.itemPath).toBe('src/features/a-1.ts')

    scrollElement.scrollTop = 24
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(24)
  })

  it('a missing scroll row does not suppress an explicit focus request', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree({ pathCount: 80 })
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
    expect(activePath(shadowRoot)).toBe('src/features/a-0.ts')
  })

  it('a cancelled reveal cannot overwrite a newer scroll request', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(shadowRoot)
    await startSmoothReveal(currentModel, shadowRoot)

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
    const { model: currentModel, shadowRoot } = await mountBrowserTree({
      pathCount: 80,
      stickyFolders: false,
    })
    const scrollElement = virtualScroll(shadowRoot)
    await startSmoothReveal(currentModel, shadowRoot)

    flushSync(() => {
      currentModel.scrollToPath('src/features/a-0.ts', { behavior: 'smooth', focus: false })
    })
    scrollElement.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }))
    scrollElement.scrollTop = 200
    await threeAnimationFrames()

    expect(scrollElement.scrollTop).toBe(200)
  })

  it('settles controller scroll requests and opens search from a printable row key', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const directoryRow = rowButton(shadowRoot, 'src/features/')
    directoryRow.focus()
    const scrollElement = virtualScroll(shadowRoot)

    currentModel.scrollToPath('src/features/a-20.ts', { focus: false, offset: 'center' })
    await vi.waitFor(() => {
      expect(scrollElement.scrollTop).toBeGreaterThan(0)
    })
    expect(currentModel.getFocusedPath()).toBe('src/features/')
    expect(activePath(shadowRoot)).toBe('src/features/')

    currentModel.scrollToPath('src/features/a-20.ts', { offset: 'nearest' })
    await vi.waitFor(() => {
      expect(currentModel.getFocusedPath()).toBe('src/features/a-20.ts')
      expect(activePath(shadowRoot)).toBeNull()
    })

    currentModel.cleanUp()
    model = null
    flushSync(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
    const searchTree = await mountSearchTree('retain')
    const searchRow = rowButton(searchTree.shadowRoot, 'README.md')
    searchRow.focus()
    dispatchTreeKey(searchRow, 'w')

    await vi.waitFor(() => {
      expect(searchTree.model.isSearchOpen()).toBe(true)
      expect(searchTree.model.getSearchValue()).toBe('w')
      expect(searchTree.shadowRoot.activeElement).toBe(
        searchTree.shadowRoot.querySelector('[data-file-tree-search-input]'),
      )
    })
  })

  it('moves DOM focus only for explicit focus requests, including virtualized rows', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const scrollElement = virtualScroll(shadowRoot)

    outsideButton.focus()
    currentModel.focusPath('src/features/a-20.ts')
    await vi.waitFor(() => {
      expect(currentModel.getFocusedPath()).toBe('src/features/a-20.ts')
    })
    expect(document.activeElement).toBe(outsideButton)

    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/a-20.ts')
      expect(scrollElement.scrollTop).toBeGreaterThan(0)
    })

    outsideButton.focus()
    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/a-20.ts')
    })
  })

  it('does not replay a consumed focus request after remount', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, shadowRoot } = await mountBrowserTree()

    currentModel.focusPath('src/features/a-3.ts')
    currentModel.focus()
    await vi.waitFor(() => {
      expect(activePath(shadowRoot)).toBe('src/features/a-3.ts')
    })

    flushSync(() => root?.unmount())
    root = null
    outsideButton.focus()
    const remountedShadowRoot = await renderBrowserTree(currentModel)

    expect(document.activeElement).toBe(outsideButton)
    expect(activePath(remountedShadowRoot)).toBeNull()
  })

  it('retains an engaged search across blur and refocuses it without clearing the query', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    document.body.prepend(outsideButton)
    const { model: currentModel, shadowRoot } = await mountSearchTree('retain')
    const searchInput = await openSearch(currentModel, shadowRoot, 'worker')

    outsideButton.focus()
    await vi.waitFor(() => {
      expect(shadowRoot.activeElement).not.toBe(searchInput)
    })
    expect(currentModel.isSearchOpen()).toBe(true)
    expect(currentModel.getSearchValue()).toBe('worker')

    currentModel.openSearch()
    await vi.waitFor(() => {
      expect(shadowRoot.activeElement).toBe(searchInput)
    })
    expect(currentModel.getSearchValue()).toBe('worker')
  })

  it('inherits the consuming light color scheme for search colors', async () => {
    const { shadowRoot } = await mountSearchTree('retain', 'light')
    const host = document.querySelector<HTMLElement>('file-tree-container')
    const searchInput = shadowRoot.querySelector<HTMLInputElement>('[data-file-tree-search-input]')

    expect(host).not.toBeNull()
    expect(searchInput).not.toBeNull()
    expect(getComputedStyle(host!).colorScheme).toBe('light')
    expect(getComputedStyle(searchInput!).backgroundColor).toBe('rgb(248, 248, 248)')
  })

  it('keeps rename active for composing keys and commits on ordinary Enter', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const input = await beginRename(currentModel, shadowRoot, 'src/features/a-3.ts')
    setRenameValue(input, 'renamed.ts')

    dispatchRenameKey(input, 'Enter', { isComposing: true })
    await expectRenameToRemainActive(shadowRoot)

    dispatchRenameKey(input, 'Escape', { legacyComposition: true })
    await expectRenameToRemainActive(shadowRoot)

    dispatchRenameKey(input, 'Enter')
    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull()
      expect(currentModel.getItem('src/features/renamed.ts')).not.toBeNull()
    })
  })

  it('keeps rename active for legacy composition and cancels on ordinary Escape', async () => {
    const { model: currentModel, shadowRoot } = await mountBrowserTree()
    const input = await beginRename(currentModel, shadowRoot, 'src/features/a-3.ts')
    setRenameValue(input, 'should-not-land.ts')

    dispatchRenameKey(input, 'Escape', { isComposing: true })
    await expectRenameToRemainActive(shadowRoot)

    dispatchRenameKey(input, 'Enter', { legacyComposition: true })
    await expectRenameToRemainActive(shadowRoot)

    dispatchRenameKey(input, 'Escape')
    await vi.waitFor(() => {
      expect(shadowRoot.querySelector('[data-item-rename-input]')).toBeNull()
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
      const { model: currentModel, shadowRoot } = await mountSearchTree(searchBlurBehavior)
      const searchInput = await openSearch(currentModel, shadowRoot, 'worker')
      const focusedPathBeforeEnter = currentModel.getFocusedPath()
      expect(focusedPathBeforeEnter).not.toBeNull()

      dispatchSearchKey(searchInput, 'Enter')
      await vi.waitFor(() => {
        expect(currentModel.getSelectedPaths()).toEqual([focusedPathBeforeEnter])
        expect(currentModel.isSearchOpen()).toBe(keepsSearchOpen)
      })
      if (keepsSearchOpen) {
        expect(shadowRoot.activeElement).toBe(searchInput)
      } else {
        expect(activePath(shadowRoot)).toBe(focusedPathBeforeEnter)
      }

      const reopenedInput = await openSearch(currentModel, shadowRoot, 'worker')
      const clickedResult = rowButton(shadowRoot, 'src/utils/worker-b.ts')
      clickedResult.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }),
      )
      clickedResult.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

      await vi.waitFor(() => {
        expect(currentModel.getSelectedPaths()).toEqual(['src/utils/worker-b.ts'])
        expect(currentModel.isSearchOpen()).toBe(keepsSearchOpen)
      })
      if (keepsSearchOpen) {
        expect(shadowRoot.activeElement).toBe(reopenedInput)
      }

      const escapeInput = await openSearch(currentModel, shadowRoot, 'worker')
      dispatchSearchKey(escapeInput, 'Escape')
      await vi.waitFor(() => {
        expect(currentModel.isSearchOpen()).toBe(false)
      })
    },
  )
})

async function beginRename(
  currentModel: FileTreeModel,
  shadowRoot: ShadowRoot,
  path: string,
): Promise<HTMLInputElement> {
  currentModel.startRenaming(path)
  await vi.waitFor(() => {
    expect(shadowRoot.querySelector('[data-item-rename-input]')).not.toBeNull()
  })

  const input = shadowRoot.querySelector<HTMLInputElement>('[data-item-rename-input]')
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

async function expectRenameToRemainActive(shadowRoot: ShadowRoot): Promise<void> {
  await vi.waitFor(() => {
    expect(shadowRoot.querySelector('[data-item-rename-input]')).not.toBeNull()
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

async function mountBrowserTree(options: { pathCount?: number; stickyFolders?: boolean } = {}) {
  const mountedModel = new FileTreeModel({
    gitStatus: [{ path: 'src/features/a-3.ts', status: 'modified' }],
    initialExpansion: 'open',
    initialVisibleRowCount: 6,
    itemHeight: 24,
    paths: browserPaths(options.pathCount),
    renaming: true,
    stickyFolders: options.stickyFolders ?? true,
  })
  model = mountedModel

  return { model: mountedModel, shadowRoot: await renderBrowserTree(mountedModel) }
}

async function renderBrowserTree(mountedModel: FileTreeModel) {
  const container = document.createElement('main')
  container.style.height = '180px'
  container.style.width = '360px'
  document.body.append(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <FileTree
        aria-label='Files'
        model={mountedModel}
        style={{ display: 'block', height: '180px', width: '360px' }}
      />,
    )
  })

  return await waitForShadowRoot()
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
  const mountedModel = new FileTreeModel({
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
    root?.render(<FileTree aria-label='Search files' model={mountedModel} />)
  })

  return { model: mountedModel, shadowRoot: await waitForShadowRoot() }
}

async function openSearch(
  currentModel: FileTreeModel,
  shadowRoot: ShadowRoot,
  query: string,
): Promise<HTMLInputElement> {
  if (!currentModel.isSearchOpen()) {
    currentModel.openSearch(query)
  }

  const input = shadowRoot.querySelector<HTMLInputElement>('[data-file-tree-search-input]')
  expect(input).not.toBeNull()
  await vi.waitFor(() => {
    expect(currentModel.isSearchOpen()).toBe(true)
    expect(input?.value).toBe(query)
    expect(shadowRoot.activeElement).toBe(input)
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

async function waitForShadowRoot() {
  await vi.waitFor(() => {
    expect(document.querySelector('file-tree-container')?.shadowRoot).toBeTruthy()
  })

  const shadowRoot = document.querySelector('file-tree-container')?.shadowRoot
  if (!shadowRoot) throw new Error('missing file tree shadow root')

  return shadowRoot
}

function rowButton(shadowRoot: ShadowRoot, path: string) {
  const button = shadowRoot.querySelector<HTMLButtonElement>(
    `button[data-item-path="${path}"]:not([data-file-tree-sticky-row="true"])`,
  )
  if (!button) throw new Error(`missing row ${path}`)

  return button
}

function activePath(shadowRoot: ShadowRoot) {
  const activeElement = shadowRoot.activeElement
  if (!(activeElement instanceof HTMLElement)) return null

  return activeElement.dataset.itemPath ?? null
}

function virtualRoot(shadowRoot: ShadowRoot) {
  const rootElement = shadowRoot.querySelector<HTMLElement>(
    '[data-file-tree-virtualized-root="true"]',
  )
  if (!rootElement) throw new Error('missing virtual root')

  return rootElement
}

function virtualScroll(shadowRoot: ShadowRoot) {
  const scrollElement = shadowRoot.querySelector<HTMLElement>(
    '[data-file-tree-virtualized-scroll="true"]',
  )
  if (!scrollElement) throw new Error('missing virtual scroll')

  return scrollElement
}

async function startSmoothReveal(currentModel: FileTreeModel, shadowRoot: ShadowRoot) {
  currentModel.setDensity('compact', 20)
  await expect
    .poll(() => rowButton(shadowRoot, 'src/features/a-0.ts').getBoundingClientRect().height)
    .toBe(20)
  const scrollElement = virtualScroll(shadowRoot)
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
