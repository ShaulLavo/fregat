import { cleanup, render } from '@testing-library/react'
import type { Root } from 'mdast'
import { afterEach, expect, test } from 'vitest'
import { visit } from 'unist-util-visit'

import { MarkdownSessionContext } from '../../providers/session-context'
import { createMarkdownSession, type MarkdownSessionFactory } from '../../utils/session'
import { Markdown } from '../markdown'

afterEach(cleanup)

const labelledSession: MarkdownSessionFactory = (options = {}) =>
  createMarkdownSession({
    remarkPlugins: (options.remarkPlugins ?? []).concat([
      () => (tree: Root) => {
        visit(tree, 'text', (node) => {
          node.value = `Scoped ${node.value}`
        })
      },
    ]),
  })

test('a scoped factory reaches Markdown while siblings use the production default', () => {
  const view = render(
    <>
      <MarkdownSessionContext value={labelledSession}>
        <Markdown text='**answer**' />
      </MarkdownSessionContext>
      <Markdown text='**answer**' />
    </>,
  )
  expect(Array.from(view.container.querySelectorAll('strong'), (node) => node.textContent)).toEqual(
    ['Scoped answer', 'answer'],
  )
})

test('changing the scoped factory replaces its parse cache and keeps the current source', () => {
  const view = render(
    <MarkdownSessionContext value={labelledSession}>
      <Markdown text='**answer**' />
    </MarkdownSessionContext>,
  )
  expect(view.container.querySelector('strong')?.textContent).toBe('Scoped answer')
  view.rerender(
    <MarkdownSessionContext value={createMarkdownSession}>
      <Markdown text='**answer**' />
    </MarkdownSessionContext>,
  )
  expect(view.container.querySelector('strong')?.textContent).toBe('answer')
})
