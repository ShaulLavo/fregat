import { test, expect } from '../../../../test/fixtures'
import { itemHighlights, searchPdf, pdfPageText } from '@/lib/pdf-viewer/search'

test('search preserves explicit spaces, split words, inferred gaps and original item offsets', () => {
  const page = pdfPageText([
    { str: 'hel', width: 3, height: 10, transform: [10, 0, 0, 10, 0, 0], hasEOL: false },
    { str: 'lo', width: 2, height: 10, transform: [10, 0, 0, 10, 3, 0], hasEOL: false },
    { str: ' ', width: 2, height: 10, transform: [10, 0, 0, 10, 5, 0], hasEOL: false },
    { str: 'world', width: 5, height: 10, transform: [10, 0, 0, 10, 7, 0], hasEOL: false },
    { str: 'again', width: 5, height: 10, transform: [10, 0, 0, 10, 16, 0], hasEOL: false },
  ])
  expect(page.text).toBe('hello world again')
  const matches = searchPdf([page], 'hello world')
  expect(matches).toEqual([{ page: 0, start: 0, end: 11 }])
  expect(itemHighlights(page, matches, 0, matches[0])).toEqual([
    [{ start: 0, end: 3, selected: true }],
    [{ start: 0, end: 2, selected: true }],
    [{ start: 0, end: 1, selected: true }],
    [{ start: 0, end: 5, selected: true }],
    [],
  ])
  expect(searchPdf([page, page], 'world').map((match) => match.page)).toEqual([0, 1])
  expect(searchPdf([page], '   ')).toEqual([])
  expect(searchPdf([page], 'missing')).toEqual([])
})

test('literal search keeps original Unicode offsets and treats regex punctuation as text', () => {
  expect(searchPdf([{ text: 'İ Unicode [PDF]', items: [{ start: 0, end: 15 }] }], '[pdf]')).toEqual(
    [{ page: 0, start: 10, end: 15 }],
  )
})
