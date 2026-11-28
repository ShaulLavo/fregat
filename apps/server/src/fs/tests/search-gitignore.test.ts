import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../path'
import { workspaceGitIgnoreMatcher } from '../search/gitignore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace gitignore matcher', () => {
  it('applies a nested gitignore to paths beneath it', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'packages', 'app'), { recursive: true })
    await writeFile(path.join(root, 'packages', '.gitignore'), 'generated.ts\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('packages/app/generated.ts')).toBe(true)
    expect(matcher.ignores('packages/app/kept.ts')).toBe(false)
    expect(matcher.ignores('generated.ts')).toBe(false)
  })

  it('lets a nested gitignore re-include what the root ignored', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), '*.md\n')
    await writeFile(path.join(root, 'docs', '.gitignore'), '!keep.md\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('README.md')).toBe(true)
    expect(matcher.ignores('docs/other.md')).toBe(true)
    expect(matcher.ignores('docs/keep.md')).toBe(false)
  })

  it('ignores everything beneath an ignored directory', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, '.gitignore'), 'build/\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('build', true)).toBe(true)
    expect(matcher.ignores('build/nested/deep/file.ts')).toBe(true)
  })

  it('does not let a deeper negation escape an ignored directory', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'build'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), 'build/\n')
    await writeFile(path.join(root, 'build', '.gitignore'), '!keep.ts\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('build/keep.ts')).toBe(true)
  })

  it('separates a directory-only pattern from a file of the same name', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, '.gitignore'), 'dist/\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('dist', true)).toBe(true)
    expect(matcher.ignores('dist', false)).toBe(false)
  })

  it('reads .ignore files as well as .gitignore', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, '.ignore'), 'notes.txt\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('notes.txt')).toBe(true)
  })

  it('gives .ignore precedence over .gitignore, the way ripgrep does', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, '.gitignore'), 'secret.txt\n')
    await writeFile(path.join(root, '.ignore'), '!secret.txt\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('secret.txt')).toBe(false)
  })

  it('reads .git/info/exclude', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, '.git', 'info'), { recursive: true })
    await writeFile(path.join(root, '.git', 'info', 'exclude'), 'local-only.ts\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('local-only.ts')).toBe(true)
  })

  it('lets a repository gitignore override .git/info/exclude', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, '.git', 'info'), { recursive: true })
    await writeFile(path.join(root, '.git', 'info', 'exclude'), 'shared.ts\n')
    await writeFile(path.join(root, '.gitignore'), '!shared.ts\n')

    const matcher = await matcherFor(root)

    expect(matcher.ignores('shared.ts')).toBe(false)
  })

  it('treats a workspace with no ignore files as ignoring nothing', async () => {
    const root = await fixtureRoot()

    const matcher = await matcherFor(root)

    expect(matcher.ignores('src/app.ts')).toBe(false)
    expect(matcher.ignores('')).toBe(false)
  })

  it('supports anchored, comment, and glob patterns', async () => {
    const root = await fixtureRoot()
    await writeFile(
      path.join(root, '.gitignore'),
      '# a comment\n/root-only.txt\n*.log\nsrc/**/tmp\n',
    )

    const matcher = await matcherFor(root)

    expect(matcher.ignores('root-only.txt')).toBe(true)
    expect(matcher.ignores('nested/root-only.txt')).toBe(false)
    expect(matcher.ignores('deep/nested/debug.log')).toBe(true)
    expect(matcher.ignores('src/a/b/tmp', true)).toBe(true)
  })
})

async function matcherFor(root: string) {
  // Deterministic: never read the developer's global git excludes.
  return workspaceGitIgnoreMatcher(createWorkspacePaths(root), { globalExcludes: false })
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-gitignore-'))
  roots.push(root)
  return root
}
