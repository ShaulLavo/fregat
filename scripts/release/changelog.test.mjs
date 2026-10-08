import { afterEach, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import changelog from '@changesets/changelog-github'

const config = JSON.parse(
  await readFile(new URL('../../.changeset/config.json', import.meta.url), 'utf8'),
)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test.each([
  ['a'.repeat(40), 933],
  ['b'.repeat(40), null],
])('links GitHub metadata for commit %s and PR %s', async (commit, pull) => {
  expect(config.changelog[0]).toBe('@changesets/changelog-github')
  expect(config.changelog[1]).toEqual({ repo: 'ShaulLavo/fregat', disableThanks: true })
  vi.stubEnv('GITHUB_TOKEN', 'fixture-token')
  vi.stubEnv('GITHUB_GRAPHQL_URL', 'https://api.github.com/graphql')
  vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com')
  const commitUrl = `https://github.com/ShaulLavo/fregat/commit/${commit}`
  const pullUrl = `https://github.com/ShaulLavo/fregat/pull/${pull}`
  const fetch = vi.fn(async (url, request) => {
    expect(url).toBe('https://api.github.com/graphql')
    expect(request.headers.Authorization).toBe('Token fixture-token')
    const { query } = JSON.parse(request.body)
    expect(query).toContain('owner: "ShaulLavo"')
    expect(query).toContain('name: "fregat"')
    expect(query).toContain(`expression: "${commit}"`)
    return Response.json({
      data: {
        repo__0: {
          [`commit__${commit}`]: {
            commitUrl,
            author: { user: { login: 'fixture-author', url: 'https://github.com/fixture-author' } },
            associatedPullRequests: {
              nodes: pull
                ? [{ number: pull, url: pullUrl, mergedAt: '2026-10-08T00:00:00Z', author: null }]
                : [],
            },
          },
        },
      },
    })
  })
  vi.stubGlobal('fetch', fetch)
  const changeset = { id: `fixture-${commit}`, commit, summary: 'Fixed terminal glyph uploads.' }
  const line = await changelog.getReleaseLine(changeset, 'patch', config.changelog[1])
  expect(line).toContain(changeset.summary)
  expect(line).toContain(`(https://github.com/ShaulLavo/fregat/commit/${commit})`)
  if (pull) expect(line).toContain(`[#${pull}](${pullUrl})`)
  else expect(line).not.toContain('/pull/')
  expect(line).not.toContain('Thanks')
  const dependencies = await changelog.getDependencyReleaseLine(
    [changeset],
    [{ name: '@singapore-editor/textbuffer', newVersion: '0.2.7' }],
    config.changelog[1],
  )
  expect(dependencies).toContain(commitUrl)
  expect(dependencies).toContain('@singapore-editor/textbuffer@0.2.7')
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('uncommitted changesets generate summaries without GitHub lookup', async () => {
  vi.stubEnv('GITHUB_TOKEN', '')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const line = await changelog.getReleaseLine(
    { id: 'uncommitted', summary: 'Added the `DEFAULT_OVERSCAN` export.' },
    'patch',
    config.changelog[1],
  )
  expect(line.trim()).toBe('- Added the `DEFAULT_OVERSCAN` export.')
  expect(fetch).not.toHaveBeenCalled()
})
