import { afterEach, assert, expect, test } from 'vitest'
import { commands } from 'vitest/browser'

import { VirtualizedTextView } from '../src/virtualization'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofRowScreenshot: (hostId: string) => Promise<string>
  }
}

const views: VirtualizedTextView[] = []
const elements: HTMLElement[] = []
const text = 'syntax token and search match'
const tokenColor = 'rgb(255, 0, 0)'
const otherTokenColor = 'rgb(0, 128, 0)'
const matchColor = 'rgb(0, 0, 255)'

afterEach(() => {
  for (const view of views.splice(0)) view.dispose()
  for (const element of elements.splice(0)) element.remove()
})

test('scopes syntax to editor rows and match styles to their owning view', async () => {
  const owner = mount('scoped-highlight-owner')
  const other = mount('scoped-highlight-other')
  other.host.style.setProperty('--scoped-syntax-color', otherTokenColor)
  const unrelated = document.createElement('p')
  unrelated.textContent = 'Unrelated application text'
  document.body.append(unrelated)
  elements.push(unrelated)

  const matchName = 'scoped-highlight-search-match'
  owner.view.setRangeHighlight(matchName, [{ start: 0, end: text.length }], {
    backgroundColor: matchColor,
  })
  const tokenName = tokenHighlightName(owner.host)
  expect(tokenName).not.toBe('')
  expect(tokenHighlightName(other.host)).toBe(tokenName)

  for (const element of [owner.row, owner.chunk]) {
    expect(getComputedStyle(element, `::highlight(${tokenName})`).color).toBe(tokenColor)
    expect(getComputedStyle(element, `::highlight(${matchName})`).backgroundColor).toBe(matchColor)
  }
  expect(getComputedStyle(other.chunk, `::highlight(${tokenName})`).color).toBe(otherTokenColor)
  expect(getComputedStyle(unrelated, `::highlight(${tokenName})`).color).not.toBe(tokenColor)
  for (const element of [other.row, other.chunk, unrelated]) {
    expect(getComputedStyle(element, `::highlight(${matchName})`).backgroundColor).not.toBe(
      matchColor,
    )
  }

  const painted = await rowPixels(owner.host.id)
  expect(painted.red).toBeGreaterThan(20)
  expect(painted.blue).toBeGreaterThan(100)

  owner.view.clearRangeHighlight(matchName)
  expect(CSS.highlights.has(matchName)).toBe(false)
  const cleared = await rowPixels(owner.host.id)
  expect(cleared.red).toBeGreaterThan(20)
  expect(cleared.blue).toBe(0)
})

function mount(id: string) {
  const host = document.createElement('div')
  host.id = id
  host.style.cssText = 'height:80px;width:400px;background:white;color:black'
  host.style.setProperty('--scoped-syntax-color', tokenColor)
  document.body.append(host)
  elements.push(host)
  const view = new VirtualizedTextView(host, {
    rowHeight: 20,
    overscan: 0,
    longLineChunkThreshold: 1,
    longLineChunkSize: 8,
  })
  views.push(view)
  view.setText(text)
  view.setScrollMetrics(0, 80, 400)
  view.setTokens([{ start: 0, end: text.length, style: { color: 'var(--scoped-syntax-color)' } }])
  const row = view.getState().mountedRows[0]?.element
  assert(row, 'The editor has a mounted text row')
  const chunk = row.querySelector('.editor-virtualized-row-chunk')
  assert(chunk, 'The row contains nested text chunks')
  return { view, host, row, chunk }
}

function tokenHighlightName(host: HTMLElement) {
  return (
    Array.from(CSS.highlights.entries()).find(
      ([name, highlight]) =>
        name.startsWith('editor-shared-token-') &&
        Array.from(highlight).some((range) => host.contains(range.startContainer)),
    )?.[0] ?? ''
  )
}

async function rowPixels(hostId: string) {
  const screenshot = await commands.proofRowScreenshot(hostId)
  const bytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  assert(context)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let red = 0
  let blue = 0
  for (let index = 0; index < data.length; index += 4) {
    if (data[index]! > 150 && data[index + 1]! < 100 && data[index + 2]! < 100) red++
    if (data[index]! < 100 && data[index + 1]! < 100 && data[index + 2]! > 150) blue++
  }
  return { red, blue }
}
