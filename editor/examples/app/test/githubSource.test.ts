import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRepositorySource, isSourceTextPath, sourceFileRawUrl } from '../src/githubSource.ts'

describe('githubSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the GitHub tree and raw text files', async () => {
    const fetchMock = vi.fn(fetchResponse)
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchRepositorySource()

    expect(snapshot.commitSha).toBe('commit-sha')
    expect(snapshot.treeSha).toBe('tree-sha')
    expect(snapshot.files.map((file) => file.path)).toEqual(['README.md', 'src/app.ts'])
    expect(snapshot.files.map((file) => file.text)).toEqual(['# Editor', 'console.log(1);'])
  })

  it('rejects truncated GitHub tree responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/commits/')) return commitResponse()
        return jsonResponse({ sha: 'tree-sha', truncated: true, tree: [] })
      }),
    )

    await expect(fetchRepositorySource()).rejects.toThrow('truncated')
  })

  it('identifies text source paths and encodes raw URLs', () => {
    expect(isSourceTextPath('src/app.ts')).toBe(true)
    expect(isSourceTextPath('.gitignore')).toBe(true)
    expect(isSourceTextPath('image.png')).toBe(false)
    expect(sourceFileRawUrl('docs/a file.md')).toContain('docs/a%20file.md')
  })
})

async function fetchResponse(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.includes('/commits/')) return commitResponse()
  if (url.includes('/git/trees/')) return treeResponse()
  if (url.endsWith('/README.md')) return textResponse('# Editor')
  if (url.endsWith('/src/app.ts')) return textResponse('console.log(1);')
  return new Response('not found', { status: 404 })
}

function commitResponse(): Response {
  return jsonResponse({
    sha: 'commit-sha',
    commit: { tree: { sha: 'tree-sha' } },
  })
}

function treeResponse(): Response {
  return jsonResponse({
    sha: 'tree-sha',
    truncated: false,
    tree: [
      { path: 'src', type: 'tree', sha: 'dir-sha' },
      { path: 'src/app.ts', type: 'blob', sha: 'app-sha', size: 15 },
      { path: 'README.md', type: 'blob', sha: 'readme-sha', size: 8 },
      { path: 'image.png', type: 'blob', sha: 'image-sha', size: 4 },
    ],
  })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200 })
}
