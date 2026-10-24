import { expect, test } from 'vitest'
import { observeHast, renderRemark } from '../../../test/qualification'

test.each([
  ['**outside *inside', 'outside inside', 'strong', 'em'],
  ['Prefix **outside *inside', 'Prefix outside inside', 'strong', 'em'],
  ['__outside _inside', 'outside inside', 'strong', 'em'],
  ['**outside `inside` tail', 'outside inside tail', 'strong', 'code'],
])(
  'a live outer strong span includes completed nested content: %s',
  (source, text, outer, inner) => {
    const view = observeHast(renderRemark(source, true))
    expect(view.text).toBe(text)
    expect(view.elements.filter((node) => node.tag === outer)).toHaveLength(1)
    expect(view.elements.find((node) => node.tag === inner)?.parents).toContain(outer)
  },
)

test.each([
  '**closed *inside* already**',
  '`**outside *inside`',
  '\\*\\*outside *inside*',
  'a__literal *inside*',
  '```text\n**outside *inside',
])('healing keeps completed, escaped, intraword and literal syntax: %s', (source) => {
  const live = observeHast(renderRemark(source, true))
  const completed = observeHast(renderRemark(source, false))
  expect(live.text).toBe(completed.text)
  const content = (view: typeof live) =>
    view.elements.map(({ tag, text, parents }) => ({ tag, text, parents }))
  expect(content(live)).toEqual(content(completed))
})

test.each([
  '**outside *inside* ',
  '**outside *inside*\n',
  '**outside *inside*\n\n',
  '> **outside *inside*\n',
])('nested strong repair closes before trailing whitespace: %s', (source) => {
  const view = observeHast(renderRemark(source, true))
  expect(view.text).toContain('outside inside')
  expect(view.text).not.toContain('**')
  expect(view.elements.filter((node) => node.tag === 'strong')).toHaveLength(1)
  expect(view.elements.find((node) => node.tag === 'em')?.parents).toContain('strong')
})

test.each(['**outside *inside*\\ ', '**outside *inside*\\\n', '__outside _inside_\\ '])(
  'nested repair preserves authored trailing backslashes: %s',
  (source) => {
    const live = observeHast(renderRemark(source, true))
    const authored = observeHast(renderRemark(source, false))
    expect(live.text).toBe(authored.text.replace(/\*\*|__/gu, ''))
    expect(live.elements.filter((node) => node.tag === 'strong')).toHaveLength(1)
    expect(live.elements.find((node) => node.tag === 'em')?.parents).toContain('strong')
  },
)
