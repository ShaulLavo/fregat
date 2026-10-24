import { expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import { createDiffEditorOptions, createDiffPlugin } from '../../diff/dist/index.js'
import '../src/style.css'
import '../../diff/src/style.css'

it('inherits diff color overrides into row elements and switches selection colors on blur', () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:400px;height:180px'
  document.body.append(host)
  const editor = new Editor(host, {
    ...createDiffEditorOptions(),
    defaultText: 'colored row',
    theme: {
      selectionColor: '#123456',
      inactiveSelectionColor: '#234567',
      colors: { 'diff.added.bg': '#abcdef' },
    },
  })
  try {
    const row = host.querySelector<HTMLElement>('.editor-virtualized-row')!
    row.classList.add('editor-diff-row', 'editor-diff-row-addition')
    expect(getComputedStyle(row).backgroundColor).toBe('rgb(171, 205, 239)')
    const selection = document.createElement('div')
    selection.className = 'editor-virtualized-selection-range'
    row.append(selection)
    editor.focus()
    expect(getComputedStyle(selection).backgroundColor).toBe('rgb(18, 52, 86)')
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    expect(getComputedStyle(selection).backgroundColor).toBe('rgb(35, 69, 103)')
    editor.setTheme({ colors: { 'diff.added.bg': '#fedcba' } })
    expect(getComputedStyle(row).backgroundColor).toBe('rgb(254, 220, 186)')
  } finally {
    editor.dispose()
    host.remove()
  }
})

function themeProbe(type: 'dark' | 'light') {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:400px;height:180px'
  document.body.append(host)
  const editor = new Editor(host, {
    ...createDiffEditorOptions(),
    defaultText: 'plain editor with diff plugin',
    plugins: [createDiffPlugin({ mode: 'document' })],
    theme: { type, backgroundColor: type === 'light' ? '#ffffff' : '#1e1e1e' },
  })
  const row = host.querySelector<HTMLElement>('.editor-virtualized-row')
  if (!row) throw new Error('Expected a mounted row')
  const probe = document.createElement('div')
  row.append(probe)
  return { host, editor, probe }
}

it('registers default diff paint through the public plugin factory without color overrides', () => {
  const { host, editor, probe } = themeProbe('dark')
  try {
    probe.className = 'editor-diff-row-hunk'
    expect(getComputedStyle(probe).color).toBe('rgb(156, 220, 254)')
    probe.className = 'editor-diff-row-empty'
    expect(getComputedStyle(probe).color).toBe('rgb(161, 161, 170)')
    probe.className = 'editor-diff-gutter'
    probe.dataset.diffTone = 'added'
    probe.classList.add('editor-diff-gutter-lane')
    expect(getComputedStyle(probe).color).toBe('rgb(94, 204, 113)')
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('uses readable light defaults and changes palette on the same editor', () => {
  const { host, editor, probe } = themeProbe('light')
  try {
    probe.className = 'editor-diff-row-placeholder'
    expect(getComputedStyle(probe).backgroundColor).toBe('color(srgb 0.92 0.92 0.92)')
    probe.className = 'editor-diff-row-hunk'
    expect(getComputedStyle(probe).color).toBe('rgb(3, 105, 161)')
    probe.className = 'editor-diff-row-empty'
    expect(getComputedStyle(probe).color).toBe('rgb(82, 82, 91)')
    probe.className = 'editor-diff-gutter-lane'
    probe.dataset.diffTone = 'added'
    expect(getComputedStyle(probe).color).toBe('rgb(22, 101, 52)')
    probe.dataset.diffTone = 'deleted'
    expect(getComputedStyle(probe).color).toBe('rgb(153, 27, 27)')
    editor.setTheme({ type: 'dark', backgroundColor: '#1e1e1e' })
    expect(getComputedStyle(probe).color).toBe('rgb(255, 103, 98)')
    editor.setTheme({ type: 'light', colors: { 'diff.deleted': '#123456' } })
    expect(getComputedStyle(probe).color).toBe('rgb(18, 52, 86)')
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('paints diff base colors through public EditorTheme fields and updates them in place', () => {
  const { host, editor, probe } = themeProbe('light')
  try {
    editor.setTheme({
      backgroundColor: '#f1f2f3',
      foregroundColor: '#123456',
      gutterBackgroundColor: '#d1d2d3',
    })
    const view = host.querySelector<HTMLElement>('.editor-virtualized')
    const gutter = host.querySelector<HTMLElement>('.editor-virtualized-gutter')
    if (!view || !gutter) throw new Error('Expected a mounted editor and gutter')
    expect(getComputedStyle(view).backgroundColor).toBe('rgb(241, 242, 243)')
    expect(getComputedStyle(probe).color).toBe('rgb(18, 52, 86)')
    expect(getComputedStyle(gutter).backgroundColor).toBe('rgb(209, 210, 211)')
    editor.setTheme({
      backgroundColor: '#212223',
      foregroundColor: '#abcdef',
      gutterBackgroundColor: '#313233',
    })
    expect(getComputedStyle(view).backgroundColor).toBe('rgb(33, 34, 35)')
    expect(getComputedStyle(probe).color).toBe('rgb(171, 205, 239)')
    expect(getComputedStyle(gutter).backgroundColor).toBe('rgb(49, 50, 51)')
  } finally {
    editor.dispose()
    host.remove()
  }
})
