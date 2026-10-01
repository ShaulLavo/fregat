import { test, expect } from '../../../../test/fixtures'
import { itemHighlights, searchPdf } from '@/lib/pdf-viewer/search'

test('search spans text runs and counts repeated matches across pages', () => {
  const pages = [['PDF', 'verification', 'PDF verification'], ['Another PDF verification page']]
  const matches = searchPdf(pages, 'PDF verification')
  expect(matches.map((match) => match.page)).toEqual([0, 0, 1])
  expect(itemHighlights(pages[0]!, matches, 0)).toEqual([
    [{ start: 0, end: 3 }],
    [{ start: 0, end: 12 }],
    [{ start: 0, end: 16 }],
  ])
  expect(searchPdf(pages, '   ')).toEqual([])
  expect(searchPdf(pages, 'missing')).toEqual([])
})

test('literal search keeps original Unicode offsets and treats regex punctuation as text', () => {
  expect(searchPdf([['İ Unicode [PDF]']], '[pdf]')).toEqual([{ page: 0, start: 10, end: 15 }])
})
