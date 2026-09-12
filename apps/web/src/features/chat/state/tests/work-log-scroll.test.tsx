import { attachWorkLogScroll } from '@/features/chat/state/work-log-scroll'
import { workLogScrollElements } from '../../../../../test/factories/work-log-scroll'
import { expect, test } from '../../../../../test/fixtures'

test('reopening a group restores the visible command after earlier output grows while closed', () => {
  const heights = [40, 40, 40, 40, 40, 40]
  const { element, rows } = workLogScrollElements(heights)
  element.scrollTop = 85
  const first = attachWorkLogScroll(element, 'reopen-grown-group')
  first.update(rows.length)
  first.dispose()
  heights[0] = 200

  const reopened = attachWorkLogScroll(element, 'reopen-grown-group')
  expect(element.scrollTop).toBe(245)
  expect(rows[2]?.getBoundingClientRect().top).toBe(-5)
  reopened.dispose()
})

test('output sections retain their vertical and horizontal offsets without command anchors', () => {
  const element = document.createElement('pre')
  element.scrollTop = 45
  element.scrollLeft = 70
  const first = attachWorkLogScroll(element, 'reopen-output')
  first.dispose()
  element.scrollTop = 0
  element.scrollLeft = 0

  const reopened = attachWorkLogScroll(element, 'reopen-output')
  expect(element.scrollTop).toBe(45)
  expect(element.scrollLeft).toBe(70)
  reopened.dispose()
})
