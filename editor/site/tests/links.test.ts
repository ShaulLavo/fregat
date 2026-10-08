import { test, expect } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkInternalLinks } from '../scripts/links'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'singapore-doc-links-'))
  try {
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(
      join(root, 'docs/index.html'),
      '<h1 id="install">Install</h1><a href="../">Home</a>',
    )
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('checks generated HTML links and heading anchors under a base path', async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, 'index.html'),
      '<a href="/singapore/docs/#install">Start</a><a href="https://example.com/missing">External</a>',
    )
    const result = await checkInternalLinks(root, '/singapore/')
    expect(result).toEqual({ pages: 2, checked: 2, problems: [] })
  })
})

test('rejects missing routes and anchors emitted by Astro components', async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, 'index.html'),
      '<a href="/gone/">Gone</a><a href="/docs/#gone">Wrong heading</a>',
    )
    const result = await checkInternalLinks(root)
    expect(result.problems).toEqual([
      'index.html: missing page /gone/',
      'index.html: missing anchor /docs/#gone',
    ])
  })
})
