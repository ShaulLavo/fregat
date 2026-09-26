/** @jsxImportSource react */
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { expect, vi } from 'vitest'
import { commands } from 'vitest/browser'

import { FileTree } from '../components/FileTree'
import type {
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeOptions,
  FileTreeRenameEvent,
} from '../utils/model/publicTypes'
import { FileTree as FileTreeModel } from '../utils/render/FileTree'

type Point = { readonly x: number; readonly y: number }
type MouseOptions = {
  readonly button?: 'left' | 'middle' | 'right'
  readonly clickCount?: number
  readonly modifiers?: readonly ('Alt' | 'ControlOrMeta' | 'Shift')[]
  readonly steps?: number
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    treeMouse(
      action: 'click' | 'down' | 'move' | 'up',
      point: Point | null,
      options?: MouseOptions,
    ): Promise<void>
    treeReducedMotion(reduce: boolean): Promise<void>
    treeWheel(point: Point, deltaY: number): Promise<void>
    treeTouch(
      type: 'touchCancel' | 'touchEnd' | 'touchMove' | 'touchStart',
      point: Point,
    ): Promise<void>
  }
}

const TREE_LABEL = 'Parity tree'
export const ROW_HEIGHT = 24

/**
 * The parity paths: a flattened chain, nested folders, a long folder for scrolling and sticky rows.
 * Folders end in `/`, as the app passes them.
 */
const PARITY_PATHS = [
  'README.md',
  'chain/',
  'chain/of/',
  'chain/of/one/',
  'chain/of/one/end.txt',
  'docs/',
  'docs/guide.md',
  'docs/notes.md',
  'src/',
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/lib/',
  'src/lib/x.ts',
  'src/lib/y.ts',
  ...Array.from({ length: 40 }, (_, index) => `src/lib/z-${String(index).padStart(2, '0')}.ts`),
  'zeta.ts',
] as const

type ParityEvents = {
  readonly drops: FileTreeDropResult[]
  readonly dropChecks: FileTreeDropContext[]
  readonly renames: FileTreeRenameEvent[]
  readonly selections: (readonly string[])[]
  readonly menus: { item: FileTreeContextMenuItem; context: FileTreeContextMenuOpenContext }[]
  readonly menuCloses: number[]
}

type Mounted = { readonly model: FileTreeModel; readonly events: ParityEvents }

let root: Root | null = null
let mounted: FileTreeModel | null = null

export function unmountParityTree() {
  mounted?.cleanUp()
  mounted = null
  flushSync(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
}

/**
 * Mounts the tree with the options the app passes (`tree-pane.tsx`): flattened chains, sticky
 * folders, a retained filter, rename, drag and a right-click menu.
 */
export async function mountParityTree(
  options: Partial<FileTreeOptions> & { readonly height?: number } = {},
): Promise<Mounted> {
  const events: ParityEvents = {
    drops: [],
    dropChecks: [],
    renames: [],
    selections: [],
    menus: [],
    menuCloses: [],
  }
  const { height = 360, ...modelOptions } = options
  const model = new FileTreeModel({
    flattenEmptyDirectories: true,
    initialExpansion: 'closed',
    itemHeight: ROW_HEIGHT,
    paths: PARITY_PATHS,
    search: true,
    searchBlurBehavior: 'retain',
    stickyFolders: true,
    dragAndDrop: {
      canDrop: (context) => {
        events.dropChecks.push(context)
        return true
      },
      onDropComplete: (result) => events.drops.push(result),
    },
    renaming: { onRename: (event) => events.renames.push(event) },
    onSelectionChange: (paths) => events.selections.push(paths),
    ...modelOptions,
  })
  mounted = model
  const container = document.createElement('main')
  container.style.height = `${height}px`
  container.style.width = '360px'
  document.body.append(container)
  root = createRoot(container)
  flushSync(() => {
    root?.render(
      <FileTree
        aria-label={TREE_LABEL}
        model={model}
        renderContextMenu={(item, context) => {
          events.menus.push({ item, context })
          return (
            <div role='menu' aria-label='Row menu'>
              <button type='button' onClick={() => context.close()}>
                Close menu
              </button>
            </div>
          )
        }}
        style={{ display: 'block', height: `${height}px`, width: '360px' }}
      />,
    )
  })
  await vi.waitFor(() => expect(row('README.md')).toBeTruthy())
  return { model, events }
}

/** The tree's content root: its shadow root while it has one, the host itself after. */
export function treeScope(): ParentNode & { activeElement?: Element | null } {
  const host = document.querySelector<HTMLElement>(`[aria-label="${TREE_LABEL}"]`)
  if (!host) throw new Error('missing parity tree')
  return host.shadowRoot ?? host
}

export function row(path: string): HTMLElement {
  const element = treeScope().querySelector<HTMLElement>(
    `[role="treeitem"][data-item-path="${path}"]`,
  )
  if (!element) throw new Error(`missing row ${path}`)
  return element
}

export function hasRow(path: string) {
  return treeScope().querySelector(`[role="treeitem"][data-item-path="${path}"]`) !== null
}

export function stickyRow(path: string): HTMLElement {
  const element = treeScope().querySelector<HTMLElement>(
    `[data-file-tree-sticky-row="true"][data-file-tree-sticky-path="${path}"]`,
  )
  if (!element) throw new Error(`missing sticky row ${path}`)
  return element
}

export function scroller(): HTMLElement {
  const element = treeScope().querySelector<HTMLElement>('[data-file-tree-virtualized-scroll]')
  if (!element) throw new Error('missing tree scroller')
  return element
}

export function filterInput(): HTMLInputElement {
  const element = treeScope().querySelector<HTMLInputElement>('[data-file-tree-search-input]')
  if (!element) throw new Error('missing filter input')
  return element
}

export function renameInput(): HTMLInputElement | null {
  return treeScope().querySelector<HTMLInputElement>('[data-item-rename-input]')
}

/** The path of the row holding DOM focus, or null. */
export function focusedRowPath(): string | null {
  const active = treeScope().activeElement ?? document.activeElement
  if (!(active instanceof HTMLElement)) return null
  return active.dataset.itemPath ?? null
}

export function center(element: Element): Point {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height / 2 }
}

export async function frames(count = 2) {
  for (let index = 0; index < count; index += 1)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/** Expands `paths` through the model, as a restored workspace does, and waits for their rows. */
export async function expandPaths(model: FileTreeModel, paths: readonly string[]) {
  for (const path of paths) {
    const item = model.getItem(path)
    if (item && 'expand' in item) item.expand()
  }
  await frames()
}

export async function mouse(
  action: 'click' | 'down' | 'move' | 'up',
  point: Point | null = null,
  options: MouseOptions = {},
) {
  await commands.treeMouse(action, point, options)
}

/** A real click on the row's name, which a sticky copy of the row cannot intercept. */
export async function clickRow(path: string, options: MouseOptions = {}) {
  await mouse('click', center(row(path)), options)
}
