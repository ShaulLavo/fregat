import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CONTENT_INDEX_RG_EXCLUDE_GLOB_LIMIT,
  DiskWorkspaceSearchProvider,
  contentSearchRgArgs,
  findInWorkspace,
  findInWorkspaceStream,
  type SearchStreamEvent,
} from '../search'
import { createWorkspacePaths, defaultIgnoredNames } from '../path'
import { readLines } from '../search-line-decoder'
import { WorkspaceIndex, buildWorkspaceIndex } from '../workspace-index'

// Tests must not depend on whatever the developer has in their global git
// excludes file, which production deliberately does read.
const TEST_INDEX_OPTIONS = { ignore: { globalExcludes: false } } as const

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace disk search provider', () => {
  it('finds filename and content matches by default with disk source metadata', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'button.ts'), 'export const Button = 1')
    await writeFile(path.join(root, 'src', 'other.ts'), 'button content')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'button',
    })

    expect(result.matches).toContainEqual(
      expect.objectContaining({
        kind: 'name',
        path: 'src/button.ts',
        source: 'disk',
      }),
    )
    expect(result.matches).toContainEqual(
      expect.objectContaining({
        column: 1,
        endColumn: 7,
        kind: 'content',
        path: 'src/other.ts',
        source: 'disk',
      }),
    )
  })

  it('can search content without returning filename matches', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle-name.ts'), 'no match here')
    await writeFile(path.join(root, 'src', 'content.ts'), 'needle content')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'content',
        path: 'src/content.ts',
        source: 'disk',
      }),
    ])
  })

  it('emits exact content ranges for each match on a line', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'many.ts'), 'needle and needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    const contentMatches = result.matches.filter(
      (match) => match.kind === 'content' && match.path === 'many.ts',
    )

    expect(contentMatches).toEqual([
      expect.objectContaining({ column: 1, endColumn: 7 }),
      expect.objectContaining({ column: 12, endColumn: 18 }),
    ])
  })

  it('converts ripgrep utf-8 byte ranges to content columns', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'unicode.md'), 'before — needle\nemoji 😀 needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        column: 10,
        endColumn: 16,
        line: 1,
        path: 'unicode.md',
        preview: 'before — needle',
      }),
      expect.objectContaining({
        column: 10,
        endColumn: 16,
        line: 2,
        path: 'unicode.md',
        preview: 'emoji 😀 needle',
      }),
    ])

    const emojiResult = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: '😀',
    })

    expect(emojiResult.matches).toEqual([
      expect.objectContaining({
        column: 7,
        endColumn: 9,
        line: 2,
        path: 'unicode.md',
        preview: 'emoji 😀 needle',
      }),
    ])
  })

  it('treats query spaces as part of the content search text', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'spaces.ts'), 'needle here\nneedlehere')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle ',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        column: 1,
        endColumn: 8,
        path: 'spaces.ts',
      }),
    ])
  })

  it('keeps long-line previews anchored around the match', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'long.ts'), `${'x'.repeat(320)}needle${'y'.repeat(20)}`)

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toContainEqual(
      expect.objectContaining({
        column: 321,
        endColumn: 327,
        preview: expect.stringContaining('needle'),
        previewStartColumn: expect.any(Number),
      }),
    )
  })

  it('strips line terminators from content previews', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'line.ts'), 'const needle = true\n')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })
    const match = result.matches.find((candidate) => candidate.kind === 'content')

    expect(match).toMatchObject({
      column: 7,
      endColumn: 13,
      path: 'line.ts',
      preview: 'const needle = true',
    })
  })

  it('respects case-sensitive content search', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'case.ts'), 'needle Needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      caseSensitive: true,
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        column: 1,
        endColumn: 7,
        path: 'case.ts',
      }),
    ])
  })

  it('supports regex content search', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'regex.ts'), 'needle useful unused')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      matchMode: 'regex',
      maxContentBytes: 1_000_000,
      path: '',
      query: 'usef\\w+',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        column: 8,
        endColumn: 14,
        path: 'regex.ts',
      }),
    ])
  })

  it('supports whole-word content search', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'words.ts'), 'needle needleness xneedle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
      wholeWord: true,
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        column: 1,
        endColumn: 7,
        path: 'words.ts',
      }),
    ])
  })

  it('filters content search with include and exclude globs', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(root, 'tests'), { recursive: true })
    await writeFile(path.join(root, 'src', 'match.ts'), 'needle')
    await writeFile(path.join(root, 'src', 'skip.test.ts'), 'needle')
    await writeFile(path.join(root, 'tests', 'match.ts'), 'needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      excludeGlobs: ['*.test.ts'],
      includeContent: true,
      includeGlobs: ['src/*.ts'],
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        path: 'src/match.ts',
      }),
    ])
  })

  it('builds stable literal ripgrep args with config disabled and expanded globs', () => {
    const args = contentSearchRgArgs({
      contentExcludeGlobs: ['!pixel.png'],
      options: {
        caseSensitive: false,
        excludeGlobs: ['*.test.ts'],
        includeContent: true,
        includeGlobs: ['src/*.ts'],
        includeNames: false,
        limit: 20,
        maxContentBytes: 12_345,
        maxDepth: 2,
        path: '',
        query: 'needle',
        wholeWord: true,
      },
      query: 'needle',
      rootSearchPath: '.',
    })

    expect(args).toEqual([
      '--json',
      '--follow',
      '--hidden',
      '--no-config',
      '--no-require-git',
      '--max-filesize',
      '12345',
      '--fixed-strings',
      '--ignore-case',
      '--word-regexp',
      '--max-depth',
      '2',
      ...defaultRgIgnoredGlobArgs(),
      '--glob',
      'src/*.ts',
      '--glob',
      '!*.test.ts',
      '--glob',
      '!**/*.test.ts',
      '--glob',
      '!pixel.png',
      '--regexp',
      'needle',
      '.',
    ])
  })

  it('caps index-derived ripgrep exclude globs', () => {
    const contentExcludeGlobs = Array.from(
      { length: CONTENT_INDEX_RG_EXCLUDE_GLOB_LIMIT + 2 },
      (_, index) => `!asset-${index}.png`,
    )

    const args = contentSearchRgArgs({
      contentExcludeGlobs,
      options: {
        includeContent: true,
        includeNames: false,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      },
      query: 'needle',
      rootSearchPath: '.',
    })
    const globValues = args.flatMap((arg, index) => {
      if (arg !== '--glob') return []

      return [args[index + 1]]
    })
    const contentExcludeValues = globValues.filter((value) => value?.startsWith('!asset-'))

    expect(contentExcludeValues).toHaveLength(CONTENT_INDEX_RG_EXCLUDE_GLOB_LIMIT)
    expect(contentExcludeValues.at(-1)).toBe(
      `!asset-${CONTENT_INDEX_RG_EXCLUDE_GLOB_LIMIT - 1}.png`,
    )
  })

  it('builds regex ripgrep args with CRLF anchors and automatic regex engine', () => {
    const args = contentSearchRgArgs({
      options: {
        caseSensitive: true,
        includeContent: true,
        includeNames: false,
        limit: 20,
        matchMode: 'regex',
        maxContentBytes: 1_000_000,
        path: '',
        query: '^needle$',
      },
      query: '^needle$',
      rootSearchPath: '.',
    })

    expect(args).toEqual([
      '--json',
      '--follow',
      '--hidden',
      '--no-config',
      '--no-require-git',
      '--max-filesize',
      '1000000',
      '--crlf',
      '--engine',
      'auto',
      ...defaultRgIgnoredGlobArgs(),
      '--regexp',
      '^needle$',
      '.',
    ])
  })

  it('keeps slash-containing exclude globs anchored for content search', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'packages/foo/src'), { recursive: true })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'packages/foo/src/app.ts'), 'needle')
    await writeFile(path.join(root, 'src/app.ts'), 'needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      excludeGlobs: ['src/*.ts'],
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'content',
        path: 'packages/foo/src/app.ts',
      }),
    ])
  })

  it('warns instead of failing when the query spans lines', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'match.txt'), 'needle\nagain')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: true,
        includeNames: false,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle\nagain',
      }),
    )

    expect(warningCodes(events)).toEqual(['multiline-query-unsupported'])
    expect(events.filter((event) => event.type === 'match')).toEqual([])
    expect(doneEvent(events)).toMatchObject({ count: 0 })
  })

  it('does not fail a name-and-content search when the query spans lines', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'needle.txt'), 'unrelated')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: true,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle\nagain',
      }),
    )

    expect(warningCodes(events)).toEqual(['multiline-query-unsupported'])
    expect(nameMatchPaths(events)).toEqual([])
  })

  // Running as root makes every path readable, so the failure this covers cannot
  // be produced. Skipping beats a test that silently proves nothing.
  it.skipIf(process.getuid?.() === 0)(
    'warns that content results are incomplete when ripgrep cannot read part of the tree',
    async () => {
      const root = await fixtureRoot()
      await mkdir(path.join(root, 'locked'), { recursive: true })
      await writeFile(path.join(root, 'locked', 'hidden.txt'), 'needle')
      await writeFile(path.join(root, 'visible.txt'), 'needle')
      await chmod(path.join(root, 'locked'), 0o000)

      try {
        const events = await collectEvents(
          findInWorkspaceStream(createWorkspacePaths(root), {
            includeContent: true,
            includeNames: false,
            limit: 20,
            maxContentBytes: 1_000_000,
            path: '',
            query: 'needle',
          }),
        )

        expect(contentMatchPaths(events)).toEqual(['visible.txt'])
        expect(warningCodes(events)).toEqual(['content-tool-partial-failure'])
      } finally {
        await chmod(path.join(root, 'locked'), 0o700)
      }
    },
  )

  it('stops at the file limit and says so', async () => {
    const root = await fixtureRoot()
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        writeFile(path.join(root, `file-${index}.txt`), 'needle\nneedle'),
      ),
    )

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        fileLimit: 2,
        includeContent: true,
        includeNames: false,
        limit: 100,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )

    const done = doneEvent(events)
    expect(done).toMatchObject({ fileCount: 2, truncated: true })
    expect(warningCodes(events)).toEqual(['file-limit-reached'])
    expect(new Set(contentMatchPaths(events)).size).toBe(2)
  })

  it('reports every match in a file that is already inside the file limit', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'only.txt'), 'needle\nneedle\nneedle')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        fileLimit: 1,
        includeContent: true,
        includeNames: false,
        limit: 100,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )

    expect(contentMatchPaths(events)).toEqual(['only.txt', 'only.txt', 'only.txt'])
    expect(warningCodes(events)).toEqual([])
    expect(doneEvent(events)).toMatchObject({ fileCount: 1, truncated: false })
  })

  it('respects project gitignore files for content search', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'ignored'), { recursive: true })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n')
    await writeFile(path.join(root, 'ignored', 'skip.txt'), 'needle')
    await writeFile(path.join(root, 'src', 'match.txt'), 'needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'content',
        path: 'src/match.txt',
      }),
    ])
  })

  it('does not search content when the requested root is gitignored', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'ignored'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n')
    await writeFile(path.join(root, 'ignored', 'skip.txt'), 'needle')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: 'ignored',
      query: 'needle',
    })

    expect(result.matches).toEqual([])
  })

  it('respects project gitignore files for filename search', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'ignored'), { recursive: true })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n')
    await writeFile(path.join(root, 'ignored', 'needle.txt'), '')
    await writeFile(path.join(root, 'src', 'needle.txt'), '')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'name',
        path: 'src/needle.txt',
      }),
    ])
  })

  it('keeps partial rg results when ripgrep exits with a nonfatal filesystem error', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'match.txt'), 'needle')
    await symlink('.', path.join(root, 'loop'))

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toContainEqual(
      expect.objectContaining({
        kind: 'content',
        path: 'match.txt',
      }),
    )
  })

  it('does not ask ripgrep to follow broken symlinks in ignored directories', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'apps/web/node_modules/pkg'), {
      recursive: true,
    })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src/match.txt'), 'needle')
    await symlink(
      path.join(root, 'apps/web/node_modules/missing'),
      path.join(root, 'apps/web/node_modules/broken'),
    )
    await symlink(
      path.join(root, 'apps/web/node_modules/missing'),
      path.join(root, 'apps/web/node_modules/pkg/broken'),
    )
    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: true,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    expect(result.matches).toContainEqual(
      expect.objectContaining({
        kind: 'content',
        path: 'src/match.txt',
      }),
    )
  })

  it('reports truncation when the limit is reached', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'alpha.txt'), 'needle')
    await writeFile(path.join(root, 'beta.txt'), 'needle')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: false,
        limit: 1,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'txt',
      }),
    )
    const done = events.find((event) => event.type === 'done')

    expect(done).toMatchObject({ count: 1, truncated: true })
  })

  it('emits provider timing and stat counts on the done event', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle.txt'), '')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: false,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )
    const done = events.find((event) => event.type === 'done')

    expect(done?.measurement).toEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        firstResultMs: expect.any(Number),
        providerSources: expect.any(Array),
        providers: expect.any(Array),
        statCallCount: expect.any(Number),
        statDurationMs: expect.any(Number),
        statPathCount: expect.any(Number),
        topStatPaths: expect.any(Array),
      }),
    )
    expect(done?.measurement?.providerSources.length).toBeGreaterThan(0)
    expect(done?.measurement?.providers[0]).toEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        firstResultMs: expect.any(Number),
        resultCount: expect.any(Number),
        source: expect.stringMatching(/^(fallback|fd)$/u),
        statCallCount: expect.any(Number),
        statDurationMs: expect.any(Number),
      }),
    )
    expect(done?.measurement?.statCallCount).toBeGreaterThan(0)
    expect(done?.measurement?.statDurationMs).toBeGreaterThanOrEqual(0)
    expect(done?.measurement?.topStatPaths).toContainEqual(
      expect.objectContaining({
        count: expect.any(Number),
        durationMs: expect.any(Number),
        path: 'src/needle.txt',
      }),
    )
  })

  it('uses a ready workspace index for filename search metadata', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )
    const done = doneEvent(events)
    const provider = done?.measurement?.providers.find((run) => run.source === 'index')

    expect(events).toContainEqual({
      match: expect.objectContaining({
        kind: 'name',
        path: 'src/needle.txt',
        source: 'disk',
        type: 'file',
      }),
      type: 'match',
    })
    expect(done?.measurement?.providerSources).toEqual(['index'])
    expect(provider).toEqual(
      expect.objectContaining({
        resultCount: 1,
        source: 'index',
        statCallCount: 0,
        statDurationMs: 0,
      }),
    )
    expect(done?.measurement?.statCallCount).toBe(1)
  })

  it('finds names behind a symlinked directory the index does not scan, including new ones', async () => {
    const root = await fixtureRoot()
    const workspaceRoot = path.join(root, 'workspace')
    const linkedRoot = path.join(root, 'linked-package')
    await mkdir(path.join(workspaceRoot, 'packages'), { recursive: true })
    await mkdir(path.join(linkedRoot, 'src'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'needle-local.ts'), '')
    await writeFile(path.join(linkedRoot, 'src', 'needle-linked.ts'), '')
    await symlink(linkedRoot, path.join(workspaceRoot, 'packages', 'linked'))
    await symlink('.', path.join(workspaceRoot, 'loop'))
    const paths = createWorkspacePaths(workspaceRoot)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)
    await writeFile(path.join(linkedRoot, 'src', 'needle-created-later.ts'), '')

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          entryType: 'file',
          includeContent: false,
          limit: 20,
          matchMode: 'fuzzy',
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )

    expect(nameMatchPaths(events).toSorted()).toEqual([
      'needle-local.ts',
      'packages/linked/src/needle-created-later.ts',
      'packages/linked/src/needle-linked.ts',
    ])
    expect(doneEvent(events)?.measurement?.providerSources).toEqual(['index'])
  })

  it('uses an index scoped below the filesystem root and returns filesystem-relative paths', async () => {
    const root = await fixtureRoot()
    const workspaceRoot = path.join(root, 'workspace')
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'src', 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(createWorkspacePaths(workspaceRoot), TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: 'workspace',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )

    expect(nameMatchPaths(events)).toEqual(['workspace/src/needle.txt'])
    expect(doneEvent(events)?.measurement?.providerSources).toEqual(['index'])
  })

  it('rejects a ready index for another root and matches the workspace fallback baseline', async () => {
    const root = await fixtureRoot()
    const workspaceA = path.join(root, 'a')
    const workspaceB = path.join(root, 'b')
    await mkdir(workspaceA, { recursive: true })
    await mkdir(workspaceB, { recursive: true })
    await writeFile(path.join(workspaceA, 'only-a.ts'), '')
    await writeFile(path.join(workspaceB, 'only-b.ts'), '')
    const paths = createWorkspacePaths(root)
    const staleIndex = await buildWorkspaceIndex(
      createWorkspacePaths(workspaceA),
      TEST_INDEX_OPTIONS,
    )
    const options = {
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: 'b',
      query: 'only',
    }
    const baseline = await collectEvents(
      findInWorkspaceStream(paths, { ...options, useWorkspaceIndex: false }),
    )

    const events = await collectEvents(
      findInWorkspaceStream(paths, options, undefined, {
        workspaceIndex: staleIndex,
      }),
    )
    const done = doneEvent(events)

    expect(nameMatchPaths(events)).toEqual(nameMatchPaths(baseline))
    expect(nameMatchPaths(events)).toEqual(['b/only-b.ts'])
    expect(done?.measurement?.workspaceIndex).toMatchObject({
      fallbackReason: 'root-mismatch',
      readiness: 'ready',
      used: false,
    })
    expect(done?.measurement?.providerSources).not.toContain('index')
  })

  it('keeps system-scope opt-out searches isolated from an active subfolder index', async () => {
    const root = await fixtureRoot()
    const workspaceRoot = path.join(root, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(path.join(workspaceRoot, 'inside-target.ts'), '')
    await writeFile(path.join(root, 'system-target.ts'), '')
    const paths = createWorkspacePaths(root)
    const workspaceIndex = await buildWorkspaceIndex(
      createWorkspacePaths(workspaceRoot),
      TEST_INDEX_OPTIONS,
    )
    const options = {
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'target',
      useWorkspaceIndex: false,
    }
    const baseline = await collectEvents(findInWorkspaceStream(paths, options))

    const events = await collectEvents(
      findInWorkspaceStream(paths, options, undefined, { workspaceIndex }),
    )
    const done = doneEvent(events)

    expect(nameMatchPaths(events)).toEqual(nameMatchPaths(baseline))
    expect(nameMatchPaths(events)).toContain('system-target.ts')
    expect(done?.measurement?.workspaceIndex).toMatchObject({
      fallbackReason: 'disabled',
      used: false,
    })
    expect(done?.measurement?.providerSources).not.toContain('index')
  })

  it('keeps the existing filename search fallback while the workspace index is cold', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = new WorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )
    const sources = doneEvent(events)?.measurement?.providerSources ?? []

    expect(sources).not.toContain('index')
    expect(sources.some((source) => source === 'fd' || source === 'fallback')).toBe(true)
    expect(nameMatchPaths(events)).toContain('src/needle.txt')
  })

  it('matches the disk baseline while a ready index is rebuilding', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle.txt'), '')
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        writeFile(path.join(root, 'src', `scan-${String(index).padStart(3, '0')}.txt`), ''),
      ),
    )
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)
    const options = {
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    }
    const baseline = await collectEvents(
      findInWorkspaceStream(paths, { ...options, useWorkspaceIndex: false }),
    )
    const rebuild = index.rebuild({ reason: 'test-rebuild' })

    expect(index.status().readiness).toBe('building')
    const events = await collectEvents(
      findInWorkspaceStream(paths, options, undefined, {
        workspaceIndex: index,
      }),
    )
    await rebuild

    expect(nameMatchPaths(events)).toEqual(nameMatchPaths(baseline))
    expect(doneEvent(events)?.measurement?.workspaceIndex).toMatchObject({
      fallbackReason: 'building',
      readiness: 'building',
      used: false,
    })
    expect(doneEvent(events)?.measurement?.providerSources).not.toContain('index')
  })

  it('falls back for filename search while created index paths are coalescing', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    await writeFile(path.join(root, 'src', 'new-file.txt'), '')
    index.markCreatedPathPending('src/new-file.txt')

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'new-file',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )
    const done = doneEvent(events)
    const sources = done?.measurement?.providerSources ?? []

    expect(done?.measurement?.workspaceIndex).toMatchObject({
      fallbackReason: 'stale',
      pendingCreatedPathCount: 1,
      readiness: 'stale',
      used: false,
    })
    expect(sources).not.toContain('index')
    expect(sources.some((source) => source === 'fd' || source === 'fallback')).toBe(true)
    expect(nameMatchPaths(events)).toContain('src/new-file.txt')
  })

  it('skips a ready workspace index when the query opts out', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
          useWorkspaceIndex: false,
        },
        undefined,
        { workspaceIndex: index },
      ),
    )
    const sources = doneEvent(events)?.measurement?.providerSources ?? []

    expect(sources).not.toContain('index')
    expect(sources.some((source) => source === 'fd' || source === 'fallback')).toBe(true)
    expect(nameMatchPaths(events)).toContain('src/needle.txt')
  })

  it('uses the ready workspace index for fuzzy filename queries containing slashes', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'app.ts'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          matchMode: 'fuzzy',
          maxContentBytes: 1_000_000,
          path: '',
          query: 'src/app',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )

    expect(doneEvent(events)?.measurement?.providerSources).toContain('index')
    expect(nameMatchPaths(events)).toEqual(['src/app.ts'])
  })

  it('keeps invalid regex filename queries on the existing fd or fallback path', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)
    const events: SearchStreamEvent[] = []
    let error: unknown

    try {
      for await (const event of findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          matchMode: 'regex',
          maxContentBytes: 1_000_000,
          path: '',
          query: '[',
        },
        undefined,
        { workspaceIndex: index },
      )) {
        events.push(event)
      }
    } catch (caught) {
      error = caught
    }

    if (error) {
      expect(String(error)).toContain('fd exited')
      return
    }

    expect(doneEvent(events)?.measurement?.providerSources).not.toContain('index')
  })

  it('keeps regex filename queries on the existing fd or fallback path', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'needle.txt'), '')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: false,
          limit: 20,
          matchMode: 'regex',
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )

    expect(doneEvent(events)?.measurement?.providerSources).not.toContain('index')
    expect(nameMatchPaths(events)).toContain('needle.txt')
  })

  it('matches current fd filename ranking when using a ready workspace index', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await mkdir(path.join(root, 'ignored'), { recursive: true })
    await mkdir(path.join(root, 'node_modules/pkg'), { recursive: true })
    await mkdir(path.join(root, 'src/deep'), { recursive: true })
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n')
    await writeFile(path.join(root, 'docs', 'search-file.md'), '')
    await writeFile(path.join(root, 'ignored', 'search-file.ts'), '')
    await writeFile(path.join(root, 'node_modules/pkg', 'search-file.ts'), '')
    await writeFile(path.join(root, 'src', 'search-file.test.ts'), '')
    await writeFile(path.join(root, 'src', 'search-file.ts'), '')
    await writeFile(path.join(root, 'src/deep', 'search-file-helper.ts'), '')
    const paths = createWorkspacePaths(root)
    const options = {
      entryType: 'file' as const,
      excludeGlobs: ['*.test.ts'],
      includeContent: false,
      includeGlobs: ['src/**'],
      limit: 20,
      matchMode: 'fuzzy' as const,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'sfile',
    }

    const baselineEvents = await collectEvents(findInWorkspaceStream(paths, options))
    const baselineDone = doneEvent(baselineEvents)
    if (!baselineDone?.measurement?.providerSources.includes('fd')) return

    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)
    const indexedEvents = await collectEvents(
      findInWorkspaceStream(paths, options, undefined, {
        workspaceIndex: index,
      }),
    )

    expect(doneEvent(indexedEvents)?.measurement?.providerSources).toContain('index')
    expect(nameMatchPaths(indexedEvents)).toEqual(nameMatchPaths(baselineEvents))
  })

  it('emits content provider timing and stat counts on the done event', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'content.txt'), 'needle content')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: true,
        includeNames: false,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )
    const done = events.find((event) => event.type === 'done')
    const sources = done?.measurement?.providerSources ?? []

    expect(sources.some((source) => source === 'fallback' || source === 'rg')).toBe(true)
    expect(done?.measurement?.providers).toContainEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        firstResultMs: expect.any(Number),
        resultCount: expect.any(Number),
        source: expect.stringMatching(/^(fallback|rg)$/u),
        statCallCount: expect.any(Number),
        statDurationMs: expect.any(Number),
      }),
    )
    expect(done?.measurement?.statCallCount).toBeGreaterThan(0)
    expect(done?.measurement?.statDurationMs).toBeGreaterThanOrEqual(0)
    expect(done?.measurement?.topStatPaths).toContainEqual(
      expect.objectContaining({
        count: expect.any(Number),
        durationMs: expect.any(Number),
        path: 'src/content.txt',
      }),
    )
  })

  it('caches file stats for repeated content matches in one search', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'multi.txt'), 'needle one\nneedle two\n')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: true,
        includeNames: false,
        limit: 20,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )
    const done = doneEvent(events)
    const contentMatches = events.filter(
      (event) => event.type === 'match' && event.match.kind === 'content',
    )
    const multiStats = done?.measurement?.topStatPaths.find((entry) => entry.path === 'multi.txt')

    expect(contentMatches).toHaveLength(2)
    expect(multiStats).toEqual(expect.objectContaining({ count: 1 }))
    expect(done?.measurement?.repeatedStatPathCount).toBe(0)
  })

  it('uses ready workspace index metadata to skip image-like content candidates', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'match.txt'), 'needle')
    await writeFile(path.join(root, 'pixel.png'), 'needle')
    await symlink('pixel.png', path.join(root, 'linked.png'))
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: true,
          includeNames: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )
    const contentPaths = events.flatMap((event) => {
      if (event.type !== 'match') return []
      if (event.match.kind !== 'content') return []

      return [event.match.path]
    })

    expect(doneEvent(events)?.measurement?.providerSources).toContain('rg')
    expect(contentPaths).toEqual(['match.txt'])
    expect(doneEvent(events)?.measurement?.topStatPaths).not.toContainEqual(
      expect.objectContaining({ path: 'pixel.png' }),
    )
    expect(doneEvent(events)?.measurement?.topStatPaths).not.toContainEqual(
      expect.objectContaining({ path: 'linked.png' }),
    )
  })

  it('keeps known text files with ANSI escape bytes searchable with index metadata', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'ansi.log'), '\u001b[31mneedle\u001b[0m\n')
    const paths = createWorkspacePaths(root)
    const index = await buildWorkspaceIndex(paths, TEST_INDEX_OPTIONS)

    const events = await collectEvents(
      findInWorkspaceStream(
        paths,
        {
          includeContent: true,
          includeNames: false,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        undefined,
        { workspaceIndex: index },
      ),
    )

    expect(events).toContainEqual({
      match: expect.objectContaining({
        kind: 'content',
        path: 'ansi.log',
      }),
      type: 'match',
    })
  })

  it('truncates content matches at the result limit without promising path order', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'z.ts'), 'needle')
    await writeFile(path.join(root, 'src', 'a.ts'), 'needle')

    const events = await collectEvents(
      findInWorkspaceStream(createWorkspacePaths(root), {
        includeContent: true,
        includeNames: false,
        limit: 1,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      }),
    )
    const contentPaths = events.flatMap((event) => {
      if (event.type !== 'match') return []
      if (event.match.kind !== 'content') return []

      return [event.match.path]
    })

    expect(contentPaths).toHaveLength(1)
    expect(['src/a.ts', 'src/z.ts']).toContain(contentPaths[0])
    expect(doneEvent(events)).toMatchObject({ count: 1, truncated: true })
  })

  it('ranks filename matches before applying the result limit', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'deep'), { recursive: true })
    await writeFile(path.join(root, 'deep', 'zz-search-result.ts'), '')
    await writeFile(path.join(root, 'search.ts'), '')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: false,
      limit: 1,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'search',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'name',
        path: 'search.ts',
      }),
    ])
  })

  it('supports fuzzy filename quick-open matches across workspace paths', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'apps/web/src/components'), {
      recursive: true,
    })
    await mkdir(path.join(root, 'apps/web/src/lib'), {
      recursive: true,
    })
    await writeFile(path.join(root, 'apps/web/src/components/command-palette.tsx'), '')
    await writeFile(path.join(root, 'apps/web/src/lib/client.ts'), '')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: false,
      limit: 20,
      matchMode: 'fuzzy',
      maxContentBytes: 1_000_000,
      path: '',
      query: 'cmdp',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'name',
        path: 'apps/web/src/components/command-palette.tsx',
      }),
    ])
  })

  it('supports fuzzy filename quick-open queries split across directories', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'apps/web/src/components'), {
      recursive: true,
    })
    await mkdir(path.join(root, 'apps/server/src'), {
      recursive: true,
    })
    await writeFile(path.join(root, 'apps/web/src/components/command-palette.tsx'), '')
    await writeFile(path.join(root, 'apps/server/src/command.ts'), '')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: false,
      limit: 20,
      matchMode: 'fuzzy',
      maxContentBytes: 1_000_000,
      path: '',
      query: 'components palette',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'name',
        path: 'apps/web/src/components/command-palette.tsx',
      }),
    ])
  })

  it('uses a deterministic path tie-breaker for equal filename matches', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'a'), { recursive: true })
    await mkdir(path.join(root, 'b'), { recursive: true })
    await writeFile(path.join(root, 'b', 'search.ts'), '')
    await writeFile(path.join(root, 'a', 'search.ts'), '')

    const result = await findInWorkspace(createWorkspacePaths(root), {
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'search',
    })

    expect(result.matches.map((match) => match.path)).toEqual(['a/search.ts', 'b/search.ts'])
  })

  it('keeps early name streaming opt-in while supporting fully ranked fuzzy names', async () => {
    const root = await fixtureRoot()
    await writeWeakFuzzyNameMatches(root)
    await writeFile(path.join(root, 'zz-ab.ts'), '')
    const paths = createWorkspacePaths(root)
    const options = {
      includeContent: false,
      limit: 5,
      matchMode: 'fuzzy' as const,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'ab',
      useWorkspaceIndex: false,
    }

    const earlyEvents = await withSortedFd(() =>
      collectEvents(findInWorkspaceStream(paths, options)),
    )
    const earlyDone = doneEvent(earlyEvents)
    if (!earlyDone?.measurement?.providerSources.includes('fd')) return

    const earlyPaths = nameMatchPaths(earlyEvents)
    expect(earlyPaths[0]).not.toBe('zz-ab.ts')
    expect(earlyPaths).toContain('zz-ab.ts')

    const rankedEvents = await collectEvents(
      findInWorkspaceStream(paths, {
        ...options,
        streamNameMatchesEarly: false,
      }),
    )

    expect(nameMatchPaths(rankedEvents)[0]).toBe('zz-ab.ts')
  })

  it('returns symlink name matches when filtering by symlink type', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'target.ts'), '')
    await symlink('target.ts', path.join(root, 'search-link.ts'))

    const result = await findInWorkspace(createWorkspacePaths(root), {
      entryType: 'symlink',
      includeContent: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'search',
    })

    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: 'name',
        path: 'search-link.ts',
        targetType: 'file',
        type: 'symlink',
      }),
    ])
  })

  it('returns no events when aborted before search starts', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'alpha.txt'), 'needle')
    const controller = new AbortController()
    controller.abort()
    const provider = new DiskWorkspaceSearchProvider(createWorkspacePaths(root))

    const events = await collectEvents(
      provider.search(
        {
          includeContent: true,
          limit: 20,
          maxContentBytes: 1_000_000,
          path: '',
          query: 'needle',
        },
        controller.signal,
      ),
    )

    expect(events).toEqual([])
  })
})

describe('search line decoder', () => {
  it('preserves utf-8 characters split across stream chunks', async () => {
    const bytes = Buffer.from('café\nemoji 😀\n')
    const chunks = [bytes.subarray(0, 4), bytes.subarray(4, 13), bytes.subarray(13)]

    const lines = await collectEvents(readLines(Readable.from(chunks)))

    expect(lines).toEqual(['café', 'emoji 😀'])
  })
})

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-search-'))
  roots.push(root)
  return root
}

/**
 * fd sorts what it finds within its first 100 ms and streams in directory order after that, so a
 * loaded runner changes which names an early batch sees. Pin the sorted order the fixture assumes.
 */
async function withSortedFd<T>(run: () => Promise<T>) {
  const fd = Bun.which('fd')
  if (!fd) return run()
  const bin = await fixtureRoot()
  await writeFile(path.join(bin, 'fd'), `#!/bin/sh\n'${fd}' "$@" | sort\n`)
  await chmod(path.join(bin, 'fd'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}${path.delimiter}${previous}`
  try {
    return await run()
  } finally {
    process.env.PATH = previous
  }
}

async function writeWeakFuzzyNameMatches(root: string) {
  const writes = Array.from({ length: 80 }, (_, index) =>
    writeFile(path.join(root, `aa-${String(index).padStart(3, '0')}-b.ts`), ''),
  )

  await Promise.all(writes)
}

async function collectEvents<T>(events: AsyncIterable<T>) {
  const result: T[] = []
  for await (const event of events) result.push(event)

  return result
}

function doneEvent(events: readonly SearchStreamEvent[]) {
  return events.find((event) => event.type === 'done')
}

function warningCodes(events: readonly SearchStreamEvent[]) {
  return events.flatMap((event) => (event.type === 'warning' ? [event.code] : []))
}

function contentMatchPaths(events: readonly SearchStreamEvent[]) {
  return events.flatMap((event) => {
    if (event.type !== 'match') return []
    if (event.match.kind !== 'content') return []

    return [event.match.path]
  })
}

function nameMatchPaths(events: readonly SearchStreamEvent[]) {
  return events.flatMap((event) => {
    if (event.type !== 'match') return []
    if (event.match.kind !== 'name') return []

    return [event.match.path]
  })
}

function defaultRgIgnoredGlobArgs() {
  return defaultIgnoredNames.flatMap((name) => [
    '--glob',
    `!${name}`,
    '--glob',
    `!${name}/**`,
    '--glob',
    `!**/${name}`,
    '--glob',
    `!**/${name}/**`,
  ])
}
