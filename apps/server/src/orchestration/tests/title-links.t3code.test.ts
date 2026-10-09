import { expect, test } from 'vitest'
import { sessionTitleLinks, titleSourceLink } from '../title-links'
import { pinnedT3codeSource, requireT3codeReference } from '../../testing/t3code-reference'

const github = 'https://github.com/org/repo/pull/42'
const gitlab = 'https://gitlab.com/group/sub/repo/-/issues/7'

async function compile(source: string) {
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
}

test('pairs URL parsing with actual pinned provider resolver bodies', async ({ skip }) => {
  requireT3codeReference(skip)
  const resolvers = []
  for (const [kind, file] of [
    ['github', 'GitHub'],
    ['gitlab', 'GitLab'],
  ]) {
    const source = pinnedT3codeSource(
      `apps/server/src/sourceControl/${file}SourceControlProvider.ts`,
    )
    const start = source.indexOf('    resolveLink: (input) => {') + '    resolveLink: '.length
    const end = source.indexOf('\n    },\n    listChangeRequests', start) + '\n    }'.length
    expect(start).toBeGreaterThan(20)
    expect(end).toBeGreaterThan(start)
    resolvers.push(
      (
        await compile(
          `const readLinkSubject = (_input, endpoint) => ({ kind: ${JSON.stringify(kind)}, endpoint }); export const resolve = ${source.slice(start, end)};`,
        )
      ).resolve,
    )
  }
  const cases = [
    github,
    gitlab,
    'https://github.com/o/r/issues/2/comments',
    'https://github.com/o/r/pull/0',
    'https://github.com/o/r/pull/01',
    'https://github.com/o/r/commit/22',
    'https://gitlab.com/a/b/-/merge_requests/9',
    'https://gitlab.com/a/-/issues/1/notes',
    'https://gitlab.com/a/-/issues/0',
    'https://github.com:444/o/r/issues/1',
    'https://github.example/o/r/pull/1',
    'https://example.com/',
    'http://github.com/o/r/issues/2',
    'https://user:pass@github.com/o/r/issues/2',
  ]
  for (const text of cases) {
    const url = new URL(text)
    const eligible = url.protocol === 'https:' && !url.username && !url.password
    const expected = eligible
      ? resolvers.map((resolve) => resolve({ url })).find(Boolean)
      : undefined
    expect(titleSourceLink(url)).toEqual(expected)
  }
})

test('pairs scanning/budget with pinned ThreadTitleLinks loop', async ({ skip }) => {
  requireT3codeReference(skip)
  const source = pinnedT3codeSource('apps/server/src/textGeneration/ThreadTitleLinks.ts')
  const start = source.indexOf('  const links = new Map')
  const end = source.indexOf('  const subjects = yield*', start)
  const upstream = await compile(
    `export function scan(message, resolveLink) { const input = { message, cwd: '/' }; const providers = { resolveLink: ({ url }) => resolveLink(url) }; ${source.slice(start, end)} return [...links]; }`,
  )
  const cases = [
    '',
    'https://example.test/1 https://example.test/2 ' + github,
    `${github}?one=1 ${github}#two ${gitlab}`,
    `${github}). ${gitlab}!`,
    `${github} ${gitlab} https://github.com/third/repo/issues/1`,
    `https://bad[ ${github}`,
    'https://github.com:444/a/b/pull/1 ' + gitlab,
  ]
  for (const message of cases)
    expect([...sessionTitleLinks(message)]).toEqual(upstream.scan(message, titleSourceLink))
  expect([...sessionTitleLinks(cases[1]!)].length).toBe(1)
})
