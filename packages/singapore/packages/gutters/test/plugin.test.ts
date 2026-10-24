import { describe, expect, it, vi } from 'vitest'
import type { EditorGutterRowContext, EditorPluginContext } from '@singapore-editor/core/extensions'
import {
  createFoldGutterContribution,
  createFoldGutterPlugin,
  createLineGutterContribution,
  createLineGutterPlugin,
  type FoldGutterSvgIcon,
} from '../src/index'
import { createTestPluginContext } from '@singapore-editor/core/testing'

const foldSvgIcon = {
  kind: 'svg',
  viewBox: '0 0 16 16',
  path: 'M2 5L8 11L14 5Z',
} satisfies FoldGutterSvgIcon

describe('gutter plugins', () => {
  it('registers the line gutter contribution', () => {
    const registerGutterContribution = vi.fn<EditorPluginContext['registerGutterContribution']>(
      () => ({ dispose: vi.fn() }),
    )
    const plugin = createLineGutterPlugin()

    const disposable = plugin.activate(createContext(registerGutterContribution))

    expect(plugin.name).toBe('line-gutter')
    expect(disposable).toBeDefined()
    expect(registerGutterContribution).toHaveBeenCalledOnce()
    expect(registerGutterContribution.mock.calls[0]?.[0].id).toBe('line-gutter')
  })

  it('registers the fold gutter contribution', () => {
    const registerGutterContribution = vi.fn<EditorPluginContext['registerGutterContribution']>(
      () => ({ dispose: vi.fn() }),
    )
    const plugin = createFoldGutterPlugin()

    const disposable = plugin.activate(createContext(registerGutterContribution))

    expect(plugin.name).toBe('fold-gutter')
    expect(disposable).toBeDefined()
    expect(registerGutterContribution).toHaveBeenCalledOnce()
    expect(registerGutterContribution.mock.calls[0]?.[0].id).toBe('fold-gutter')
  })

  it('updates line gutter cells with CSS counters', () => {
    const contribution = createLineGutterContribution({ counterStyle: 'decimal-leading-zero' })
    const cell = contribution.createCell(document)

    contribution.updateCell(cell, {
      index: 0,
      bufferRow: 4,
      source: 'document',
      startOffset: 0,
      endOffset: 0,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: true,
      cursorLineHighlight: {
        gutterBackground: true,
        gutterNumber: true,
        rowBackground: true,
      },
      foldMarker: null,
      lineCount: 10,
      toggleFold: vi.fn(),
    })

    expect(cell.style.counterSet).toBe('editor-line 5')
    expect(cell.style.getPropertyValue('--editor-line-gutter-counter-style')).toBe(
      'decimal-leading-zero',
    )
    expect(cell.classList.contains('editor-virtualized-line-number-active')).toBe(true)

    const paint = contribution.snapshotRenderer?.capture(cell)
    const restored = contribution.createCell(document)
    expect(contribution.snapshotRenderer?.restore(restored, paint ?? '')).toBe(true)
    expect(restored.style.counterSet).toBe('editor-line 5')
    expect(restored.classList.contains('editor-virtualized-line-number-active')).toBe(true)
    expect(
      contribution.snapshotRenderer?.restore(
        restored,
        '{"counter":"url(evil)","hidden":false,"active":true}',
      ),
    ).toBe(false)
  })

  it('supports source line offsets and minimum digits', () => {
    const contribution = createLineGutterContribution({ minDigits: 4, startLine: 811 })
    const cell = contribution.createCell(document)

    contribution.updateCell(cell, {
      index: 0,
      bufferRow: 2,
      source: 'document',
      startOffset: 0,
      endOffset: 0,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: false,
      cursorLineHighlight: {
        gutterBackground: true,
        gutterNumber: true,
        rowBackground: true,
      },
      foldMarker: null,
      lineCount: 3,
      toggleFold: vi.fn(),
    })

    const width = contribution.width({
      lineCount: 3,
      metrics: { characterWidth: 7, rowHeight: 20 },
    })

    expect(cell.style.counterSet).toBe('editor-line 813')
    expect(width).toBeGreaterThanOrEqual(36)
  })

  it('renders custom line labels', () => {
    const contribution = createLineGutterContribution({
      labelForRow: (row) => (row.bufferRow === 1 ? null : 100 + row.bufferRow),
      minDigits: 3,
    })
    const cell = contribution.createCell(document)

    contribution.updateCell(cell, {
      index: 0,
      bufferRow: 0,
      source: 'document',
      startOffset: 0,
      endOffset: 0,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: true,
      cursorLineHighlight: {
        gutterBackground: true,
        gutterNumber: true,
        rowBackground: true,
      },
      foldMarker: null,
      lineCount: 3,
      toggleFold: vi.fn(),
    })

    expect(cell.textContent).toBe('100')
    expect(cell.style.counterSet).toBe('')
    expect(cell.classList.contains('editor-virtualized-line-number-active')).toBe(true)

    contribution.updateCell(cell, {
      index: 1,
      bufferRow: 1,
      source: 'document',
      startOffset: 0,
      endOffset: 0,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: true,
      cursorLineHighlight: {
        gutterBackground: true,
        gutterNumber: true,
        rowBackground: true,
      },
      foldMarker: null,
      lineCount: 3,
      toggleFold: vi.fn(),
    })

    expect(cell.hidden).toBe(true)
    expect(cell.textContent).toBe('')
    expect(cell.classList.contains('editor-virtualized-line-number-active')).toBe(false)
  })

  it('renders fold gutter icons from DOM factories', () => {
    const contribution = createFoldGutterContribution({
      icon: ({ document }) => {
        const icon = document.createElement('span')
        icon.dataset.testFoldIcon = 'custom'
        return icon
      },
    })
    const cell = contribution.createCell(document)
    const toggleFold = vi.fn()
    const button = cell.querySelector<HTMLButtonElement>('.editor-virtualized-fold-toggle')

    contribution.updateCell(cell, {
      index: 0,
      bufferRow: 0,
      source: 'document',
      startOffset: 0,
      endOffset: 0,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: false,
      cursorLineHighlight: {
        gutterBackground: true,
        gutterNumber: false,
        rowBackground: true,
      },
      foldMarker: {
        key: 'fold-0',
        startRow: 0,
        endRow: 3,
        startOffset: 0,
        endOffset: 12,
        collapsed: false,
      },
      lineCount: 4,
      toggleFold,
    })

    expect(button).not.toBeNull()
    expect(button?.hidden).toBe(false)
    expect(button?.dataset.editorFoldKey).toBe('fold-0')
    expect(cell.querySelector("[data-test-fold-icon='custom']")).not.toBeNull()
    button?.click()
    expect(toggleFold).toHaveBeenCalledOnce()
    expect(contribution.snapshotRenderer).toBeUndefined()
  })

  it.each([false, true])('restores SVG fold paint when collapsed is %s', (collapsed) => {
    const contribution = createFoldGutterContribution({
      icon: foldSvgIcon,
      iconClassName: 'custom-fold-icon',
    })
    const cell = contribution.createCell(document)
    const toggleFold = vi.fn()
    const row = createFoldRow(collapsed, toggleFold)
    contribution.updateCell(cell, row)

    const svg = cell.querySelector('svg')
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg?.getAttribute('viewBox')).toBe(foldSvgIcon.viewBox)
    expect(svg?.getAttribute('width')).toBe('100%')
    expect(svg?.getAttribute('height')).toBe('100%')
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    expect(svg?.getAttribute('focusable')).toBe('false')
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(foldSvgIcon.path)

    const paint = contribution.snapshotRenderer?.capture(cell)
    const restored = contribution.createCell(document)
    expect(contribution.snapshotRenderer?.restore(restored, paint ?? '')).toBe(true)
    expect(restored.querySelector('svg')?.outerHTML).toBe(svg?.outerHTML)
    expect(restored.querySelector('.custom-fold-icon')?.getAttribute('aria-hidden')).toBe('true')
    const button = restored.querySelector<HTMLButtonElement>('.editor-virtualized-fold-toggle')
    expect(button?.hidden).toBe(false)
    expect(button?.disabled).toBe(true)
    expect(button?.tabIndex).toBe(-1)
    expect(button?.dataset.editorFoldKey).toBeUndefined()
    expect(button?.dataset.editorFoldState).toBe(collapsed ? 'collapsed' : 'expanded')
    expect(button?.dataset.editorFoldIndicator).toBeUndefined()
    button?.click()
    expect(toggleFold).not.toHaveBeenCalled()

    const toggleCurrentFold = vi.fn()
    const currentRow = createFoldRow(!collapsed, toggleCurrentFold, 'current-fold')
    contribution.updateCell(restored, currentRow)
    expect(button?.disabled).toBe(false)
    expect(button?.tabIndex).toBe(0)
    expect(button?.dataset.editorFoldKey).toBe('current-fold')
    expect(button?.dataset.editorFoldState).toBe(collapsed ? 'expanded' : 'collapsed')
    button?.click()
    expect(toggleFold).not.toHaveBeenCalled()
    expect(toggleCurrentFold).toHaveBeenCalledWith(currentRow.foldMarker)

    const currentSvg = restored.querySelector('svg')
    contribution.updateCell(restored, createFoldRow(collapsed, toggleCurrentFold, 'current-fold'))
    expect(restored.querySelector('svg')).toBe(currentSvg)
  })

  it('restores state-specific SVG fold icons through the live renderer', () => {
    const collapsedIcon = { ...foldSvgIcon, path: 'M5 2L11 8L5 14Z' }
    const contribution = createFoldGutterContribution({
      expandedIcon: foldSvgIcon,
      collapsedIcon,
    })
    const cell = contribution.createCell(document)

    for (const collapsed of [false, true]) {
      contribution.updateCell(cell, createFoldRow(collapsed, vi.fn()))
      const expectedPath = collapsed ? collapsedIcon.path : foldSvgIcon.path
      expect(cell.querySelector('path')?.getAttribute('d')).toBe(expectedPath)
      const paint = contribution.snapshotRenderer?.capture(cell)
      const restored = contribution.createCell(document)
      expect(contribution.snapshotRenderer?.restore(restored, paint ?? '')).toBe(true)
      expect(restored.querySelector('svg')?.outerHTML).toBe(cell.querySelector('svg')?.outerHTML)
    }
  })

  it('includes SVG geometry in fold snapshot compatibility keys', () => {
    const original = createFoldGutterContribution({ icon: foldSvgIcon }).snapshotRenderer?.key
    expect(original).toBeDefined()
    expect(createFoldGutterContribution({ icon: { ...foldSvgIcon } }).snapshotRenderer?.key).toBe(
      original,
    )
    expect(
      createFoldGutterContribution({ icon: { ...foldSvgIcon, path: 'M0 0L8 8Z' } }).snapshotRenderer
        ?.key,
    ).not.toBe(original)
    expect(
      createFoldGutterContribution({ icon: { ...foldSvgIcon, viewBox: '0 0 24 24' } })
        .snapshotRenderer?.key,
    ).not.toBe(original)
  })

  it('restores fold paint without source identity or input handlers', () => {
    const contribution = createFoldGutterContribution({
      width: 16,
      expandedIndicator: '⌄',
      collapsedIndicator: '›',
      iconClassName: 'custom-fold-icon',
    })
    const cell = contribution.createCell(document)
    const toggleFold = vi.fn()
    const row = {
      index: 0,
      bufferRow: 0,
      source: 'document',
      startOffset: 0,
      endOffset: 12,
      text: '',
      kind: 'text',
      primaryText: true,
      cursorLine: false,
      cursorLineHighlight: { gutterBackground: true, gutterNumber: false, rowBackground: true },
      foldMarker: {
        key: 'live-fold',
        startRow: 0,
        endRow: 3,
        startOffset: 0,
        endOffset: 12,
        collapsed: true,
      },
      lineCount: 4,
      toggleFold,
    } satisfies Parameters<typeof contribution.updateCell>[1]
    contribution.updateCell(cell, row)
    const paint = contribution.snapshotRenderer?.capture(cell)
    const restored = contribution.createCell(document)
    expect(contribution.snapshotRenderer?.restore(restored, paint ?? '')).toBe(true)
    const button = restored.querySelector<HTMLButtonElement>('.editor-virtualized-fold-toggle')
    expect(button?.textContent).toBe('›')
    expect(button?.disabled).toBe(true)
    expect(button?.dataset.editorFoldKey).toBeUndefined()
    expect(button?.dataset.editorFoldState).toBe('collapsed')
    expect(restored.querySelector('.custom-fold-icon')).not.toBeNull()
    button?.click()
    expect(toggleFold).not.toHaveBeenCalled()
    expect(contribution.snapshotRenderer?.restore(restored, '<script>')).toBe(false)

    const toggleCurrentFold = vi.fn()
    contribution.updateCell(restored, {
      ...row,
      foldMarker: { ...row.foldMarker, key: 'current-fold', collapsed: false },
      toggleFold: toggleCurrentFold,
    })
    expect(restored.querySelector('.editor-virtualized-fold-toggle')).toBe(button)
    expect(button?.disabled).toBe(false)
    expect(button?.textContent).toBe('⌄')
    expect(button?.dataset.editorFoldKey).toBe('current-fold')
    button?.click()
    expect(toggleFold).not.toHaveBeenCalled()
    expect(toggleCurrentFold).toHaveBeenCalledWith(expect.objectContaining({ key: 'current-fold' }))
  })
})

function createFoldRow(
  collapsed: boolean,
  toggleFold: EditorGutterRowContext['toggleFold'],
  key = 'svg-fold',
): EditorGutterRowContext {
  return {
    index: 0,
    bufferRow: 0,
    source: 'document',
    startOffset: 0,
    endOffset: 12,
    text: '',
    kind: 'text',
    primaryText: true,
    cursorLine: false,
    cursorLineHighlight: { gutterBackground: true, gutterNumber: false, rowBackground: true },
    foldMarker: {
      key,
      startRow: 0,
      endRow: 3,
      startOffset: 0,
      endOffset: 12,
      collapsed,
    },
    lineCount: 4,
    toggleFold,
  }
}

function createContext(
  registerGutterContribution: EditorPluginContext['registerGutterContribution'],
): EditorPluginContext {
  return createTestPluginContext({
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerViewContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution,
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
  })
}
