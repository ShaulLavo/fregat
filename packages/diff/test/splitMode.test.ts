import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  createDiffRegionStore,
  createTextDiff,
  joinRenderLines,
} from '../src'
import type { DiffFile, DiffGutterSide, DiffPlugin, DiffRegionStore } from '../src'
import { installHighlightPolyfill } from './support/highlightPolyfill'

/**
 * §C7 — the split alignment invariant, which is the one property split mode exists to hold.
 *
 * `leftRows[i]` and `rightRows[i]` share a visual band only while the two panes agree on how many
 * rows there are. The projection guarantees equal counts by pushing the same separator object into
 * both arrays, but that guarantee is per *projection* — and split mode runs two of them, one per
 * plugin. Expansion is what can pull them apart, because it changes the row count.
 */
describe('split mode alignment (§C7)', () => {
  const mounted: { editor: Editor; host: HTMLElement }[] = []

  beforeAll(() => {
    installHighlightPolyfill()
  })

  afterEach(() => {
    for (const entry of mounted.splice(0)) {
      entry.editor.dispose()
      entry.host.remove()
    }
  })

  it('keeps both sides equal when one side expands a region', () => {
    const regions = createDiffRegionStore()
    const file = prefixSkippedDiff()
    const left = mount('old', file, regions)
    const right = mount('new', file, regions)

    expect(left.plugin.getRows()).toHaveLength(right.plugin.getRows().length)

    // A gutter click on the left pane only. Before the shared store, this produced left=4 right=2
    // and every row below the region was misaligned.
    const view = left.host.querySelector<HTMLElement>('.editor-virtualized')!
    view.dispatchEvent(pointerEvent('mousedown', 0))
    view.dispatchEvent(pointerEvent('click', 0))

    expect(left.plugin.getRows().map((row) => row.text)).toContain('Hide 2 unmodified lines')
    expect(right.plugin.getRows()).toHaveLength(left.plugin.getRows().length)
    expect(right.plugin.getExpandedRegions()).toEqual(left.plugin.getExpandedRegions())
  })

  it('re-renders the sibling pane, not just its row model', () => {
    const regions = createDiffRegionStore()
    const file = prefixSkippedDiff()
    const left = mount('old', file, regions)
    const right = mount('new', file, regions)

    regions.toggleRegion(left.plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)

    // The host pushes rows on `onDidChangeRows`, so a shared toggle has to reach that listener on
    // both sides or the right pane's editor keeps rendering the old text.
    expect(right.host.textContent).toContain('alpha')
    expect(right.host.textContent).toContain('beta')
  })

  it('gives each plugin its own store when the host does not share one', () => {
    const file = prefixSkippedDiff()
    const left = mount('old', file)
    const right = mount('new', file)

    left.plugin.toggleRegion(left.plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)

    // Not an endorsement of building a split view this way — it is the documented failure, pinned
    // so the shared-store option cannot quietly stop being the thing that fixes it.
    expect(right.plugin.getExpandedRegions().size).toBe(0)
    expect(left.plugin.getRows().length).not.toBe(right.plugin.getRows().length)
  })

  it('drops expansion when the same path is re-diffed with different content', () => {
    const regions = createDiffRegionStore()
    const left = mount('old', prefixSkippedDiff(), regions)
    left.plugin.toggleRegion(left.plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)
    expect(left.plugin.getExpandedRegions().size).toBe(1)

    // A refetch of the same path with a line inserted above renumbers every region, so the retained
    // key would match nothing and the region would re-collapse anyway. Resetting says so out loud.
    left.plugin.setFile(
      createTextDiff({
        contextLines: 0,
        oldFile: { path: 'note.txt', text: 'new\nalpha\nbeta\ngamma\n' },
        newFile: { path: 'note.txt', text: 'new\nalpha\nbeta\nGAMMA\n' },
      }),
    )

    expect(left.plugin.getExpandedRegions().size).toBe(0)
  })

  it('still hears a toggle after the editor that hosted it was torn down and rebuilt', () => {
    // React StrictMode makes mount -> unmount -> mount the *normal* development path, and a host
    // holding the plugin in a `useMemo` re-activates the same instance against a fresh editor. The
    // region subscription is torn down with the activation, so if it is only ever created in the
    // constructor the second mount renders correctly and is deaf to every gutter click after it.
    const regions = createDiffRegionStore()
    const file = prefixSkippedDiff()
    const plugin = createDiffPlugin({
      mode: 'document',
      side: 'stacked',
      regions,
      syntaxHighlight: false,
    })
    plugin.setFile(file)
    remount(plugin).editor.dispose()
    const second = remount(plugin)

    regions.toggleRegion(plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)

    expect(plugin.getRows().map((row) => row.text)).toContain('Hide 2 unmodified lines')
    expect(second.host.textContent).toContain('alpha')
  })

  it('keeps expansion when the identical file is pushed again', () => {
    const left = mount('old', prefixSkippedDiff())
    const key = left.plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!
    left.plugin.toggleRegion(key)

    left.plugin.setFile(prefixSkippedDiff())

    // Same path, same content, same hunks — a plain re-push must not close what the reader opened.
    expect([...left.plugin.getExpandedRegions()]).toEqual([key])
  })

  /** Mounts an existing plugin instance on a fresh editor, the way a remount does. */
  function remount(plugin: DiffPlugin): { editor: Editor; host: HTMLElement } {
    const host = document.createElement('div')
    host.className = 'editor-diff-view'
    document.body.appendChild(host)

    const editor = createVisibleEditor(host, {
      ...createDiffEditorOptions(),
      plugins: [plugin],
    })
    mounted.push({ editor, host })
    plugin.onDidChangeRows(() => {
      editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
    })
    editor.setText(joinRenderLines(plugin.getRows()))
    return { editor, host }
  }

  function mount(
    side: DiffGutterSide,
    file: DiffFile,
    regions?: DiffRegionStore,
  ): { host: HTMLElement; plugin: DiffPlugin } {
    const host = document.createElement('div')
    host.className = 'editor-diff-view'
    document.body.appendChild(host)

    const plugin = createDiffPlugin({ mode: 'document', side, regions, syntaxHighlight: false })
    const editor = createVisibleEditor(host, {
      ...createDiffEditorOptions(),
      plugins: [plugin],
    })
    mounted.push({ editor, host })
    plugin.onDidChangeRows(() => {
      editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
    })
    plugin.setFile(file)
    return { host, plugin }
  }
})

function prefixSkippedDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.txt', text: 'alpha\nbeta\ngamma\n' },
    newFile: { path: 'note.txt', text: 'alpha\nbeta\nGAMMA\n' },
  })
}

function pointerEvent(type: string, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientY, detail: 1 })
}
