import { expect, test } from 'vitest'

import { createRemarkReplay, observeHast, readyRemarkExtensions } from '../../../test/qualification'
import { createMarkdownSession } from '../session'

test('a delayed raw HTML stage publishes the same safe source after it loads', async () => {
  const source = '<details><summary>More</summary>\n\nSafe **answer**.\n\n</details>'
  const bare = createRemarkReplay({ extensions: { raw: null, math: null } })
  expect(
    observeHast(bare.update(source, false)).elements.some((element) => element.tag === 'details'),
  ).toBe(false)
  const loaded = createRemarkReplay({ extensions: await readyRemarkExtensions() })
  const observation = observeHast(loaded.update(source, false))
  expect(observation.elements.filter((element) => element.tag === 'details')).toHaveLength(1)
  expect(observation.elements.find((element) => element.tag === 'strong')?.text).toBe('answer')
})

test('loaded KaTeX replaces fallback code while retaining exact source math and safe markup', async () => {
  const source = 'Before $$x + y$$ after.'
  const fallback = createRemarkReplay({ extensions: { raw: null, math: null } })
  expect(
    observeHast(fallback.update(source, false)).elements.find((element) => element.tag === 'code')
      ?.text,
  ).toBe('x + y')
  const loaded = createRemarkReplay({ extensions: await readyRemarkExtensions() })
  const observation = observeHast(loaded.update(source, false))
  expect(observation.elements.some((element) => element.attributes.class === 'katex')).toBe(true)
  expect(observation.elements.find((element) => element.tag === 'annotation')?.text).toBe('x + y')
  expect(observation.elements.some((element) => element.tag === 'script')).toBe(false)
})

test('settled code identities survive unrelated appends, repeated updates and completion', () => {
  const session = createMarkdownSession()
  const prefix = '```ts\nconst answer = 1\n```\n\n'
  const first = session.update(prefix + 'A live tail', { heal: true })
  const appended = session.update(prefix + 'A live tail grows', { heal: true })
  const repeated = session.update(prefix + 'A live tail grows', { heal: true })
  const completed = session.update(prefix + 'A live tail grows', { heal: false })
  expect(first[0]?.settled).toBe(true)
  expect(appended[0]).toBe(first[0])
  expect(repeated).toBe(appended)
  expect(completed[0]).toBe(first[0])
})

test('source replacement and healing-mode changes invalidate only eligible session state', () => {
  const session = createMarkdownSession()
  const live = session.update('Read **unfinished', { heal: true })
  const complete = session.update('Read **unfinished', { heal: false })
  expect(complete).not.toBe(live)
  expect(complete).toEqual(createMarkdownSession().update('Read **unfinished', { heal: false }))
  const replaced = session.update('# New document', { heal: false })
  expect(replaced).toEqual(createMarkdownSession().update('# New document', { heal: false }))
})
