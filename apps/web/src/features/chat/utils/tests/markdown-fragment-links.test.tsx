import { expect, test } from 'vitest'

import { findMarkdownFragmentTarget } from '@/features/chat/utils/markdown-fragment-links'

function message(html: string) {
  const root = document.createElement('div')
  root.dataset.chatMarkdown = ''
  root.innerHTML = html
  document.body.append(root)
  return root
}

test('a prefixed link finds the prefixed id, or the heading its slug names', () => {
  const root = message(
    '<h2>Next steps</h2><p id="user-content-fn-1">note</p><a href="#user-content-next-steps">x</a>',
  )
  const link = root.querySelector('a')
  if (!link) throw new TypeError('Missing link')

  expect(findMarkdownFragmentTarget(link, '#user-content-fn-1')?.textContent).toBe('note')
  expect(findMarkdownFragmentTarget(link, '#user-content-next-steps')?.tagName).toBe('H2')
  root.remove()
})
