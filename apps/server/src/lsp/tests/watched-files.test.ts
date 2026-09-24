import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../../fs/path'
import { treeWatchSource } from '../../fs/tree-watch'
import { FileChangeHub } from '../../fs/watch'
import { fileUriForPath } from '../language'
import {
  boundedWatch,
  compileWatchers,
  LspWatchedFiles,
  mergeChange,
  type FileEvent,
} from '../watched-files'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('watched-file patterns', () => {
  const root = '/work/project'

  it('bounds what is watched without changing what matches', () => {
    expect(boundedWatch('/work', root)).toEqual({ depth: 'recursive', path: root })
    expect(boundedWatch('/work/project/src', root)).toEqual({
      depth: 'recursive',
      path: '/work/project/src',
    })
    expect(boundedWatch('/work/other/src', root)).toEqual({
      depth: 'recursive',
      path: '/work/other/src',
    })
    expect(boundedWatch('/work/project/node_modules/.bun/ts/lib', root)).toEqual({
      depth: 'shallow',
      path: '/work/project/node_modules',
    })
  })

  it('reads absolute, relative and base-relative patterns', () => {
    const [absolute, exact, relative, based] = compileWatchers(
      {
        watchers: [
          { globPattern: '/work/project/src/**/*.ts', kind: 2 },
          { globPattern: '/work/project/tsconfig.json' },
          { globPattern: '**/package.json' },
          { globPattern: { baseUri: { uri: 'file:///work', name: 'work' }, pattern: '**/*' } },
        ],
      },
      root,
    )
    expect(absolute).toMatchObject({ base: '/work/project/src', kind: 2 })
    expect(absolute?.glob.match('a/b.ts')).toBe(true)
    expect(exact).toMatchObject({ base: '/work/project', kind: 7 })
    expect(exact?.glob.match('tsconfig.json')).toBe(true)
    expect(relative).toMatchObject({ base: root })
    expect(based).toMatchObject({ base: '/work', watch: { depth: 'recursive', path: root } })
    expect(() => compileWatchers({}, root)).toThrow()
  })

  it('merges a burst into the final state of each file', () => {
    expect(mergeChange(undefined, 1)).toBe(1)
    expect(mergeChange(1, 2)).toBe(1)
    expect(mergeChange(1, 3)).toBe(3)
    expect(mergeChange(3, 1)).toBe(2)
    expect(mergeChange(2, 1)).toBe(2)
    expect(mergeChange(2, 3)).toBe(3)
  })
})

describe.runIf(process.platform === 'linux')('watched files on a real hub', () => {
  it('describes a replaced file as deleted then created', async () => {
    const { changes, root, watched } = await fixture()
    const file = path.join(root, 'dependency.ts')
    await writeFile(file, 'export const value = 1\n')
    await watched.register('all', { watchers: [{ globPattern: `${root}/**/*` }] })

    await writeFile(`${file}.next`, 'export const value = 2\n')
    await rename(`${file}.next`, file)

    const uri = fileUriForPath(file)
    await expect
      .poll(() => changes.filter((change) => change.uri === uri), { timeout: 3000 })
      .toEqual([
        { uri, type: 3 },
        { uri, type: 1 },
      ])
  })

  it('sees packages arrive in node_modules without crawling them', async () => {
    const { changes, hub, root, watched } = await fixture()
    await mkdir(path.join(root, 'node_modules/existing'), { recursive: true })
    await watched.register('modules', {
      watchers: [{ globPattern: `${root}/node_modules/**/*` }],
    })
    expect(hub.info()).toMatchObject({ nativeWatcherCount: 0, shallowWatcherCount: 1 })

    await writeFile(path.join(root, 'node_modules/existing/index.d.ts'), 'export {}\n')
    await mkdir(path.join(root, 'node_modules/installed'))
    const installed = fileUriForPath(path.join(root, 'node_modules/installed'))
    await expect
      .poll(() => changes.map((change) => change.uri), { timeout: 3000 })
      .toContain(installed)
    expect(changes.some((change) => change.uri.endsWith('index.d.ts'))).toBe(false)

    await watched.unregister('modules')
    expect(hub.info().shallowWatcherCount).toBe(0)
  })

  it('watches a directory that does not exist yet from its parent', async () => {
    const outside = await directory()
    const { changes, watched } = await fixture()
    await watched.register('later', { watchers: [{ globPattern: `${outside}/later/**/*` }] })

    await mkdir(path.join(outside, 'later'))
    const file = path.join(outside, 'later/file.ts')
    let revision = 0
    await expect
      .poll(
        async () => {
          await writeFile(file, `export const revision = ${revision++}\n`)
          return changes.map((change) => change.uri)
        },
        { timeout: 3000, interval: 100 },
      )
      .toContain(fileUriForPath(file))
  })
})

async function fixture() {
  const root = await directory()
  const paths = createWorkspacePaths('/')
  const hub = new FileChangeHub(paths, { enabled: true })
  cleanups.push(() => hub.close())
  const changes: FileEvent[] = []
  const watched = new LspWatchedFiles(root, treeWatchSource(hub, paths), (batch) =>
    changes.push(...batch),
  )
  cleanups.push(() => watched.dispose())
  return { changes, hub, root, watched }
}

async function directory() {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-watched-files-')))
  cleanups.push(() => rm(created, { recursive: true, force: true }))
  return created
}
