import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')

test.each([
  ['editor', 'array'],
  ['singapore', 'array'],
  ['nested', 'array'],
  ['editor', 'catalog'],
  ['singapore', 'catalog'],
  ['nested', 'catalog'],
])('Editor scripts find their workspace in %s with a %s manifest', (layout, shape) => {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-editor-root-'))
  const family = path.join(root, layout === 'nested' ? 'editor' : layout)
  const parserSource = 'github:ShaulLavo/tree-sitter-x#' + '1'.repeat(40)
  const workspaces =
    shape === 'array'
      ? ['packages/*']
      : { packages: ['packages/*'], catalog: { '@fregat/hotkeys': '0.0.2' } }
  const manifest = { workspaces, name: 'editor-workspace', parserSource }
  mkdirSync(path.join(family, 'scripts'), { recursive: true })
  mkdirSync(path.join(family, 'packages'), { recursive: true })
  writeFileSync(path.join(family, 'package.json'), JSON.stringify(manifest))
  writeFileSync(path.join(family, 'turbo.json'), JSON.stringify({ tasks: {} }))
  // A lockfile beside a standalone checkout does not make its parent the workspace.
  writeFileSync(path.join(root, 'bun.lock'), '{}')
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['other/*'], parserSource }),
  )
  if (layout === 'nested') {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['editor/packages/*', 'editor/examples/*'] },
        parserSource,
      }),
    )
    writeFileSync(path.join(root, 'turbo.json'), JSON.stringify({ tasks: {} }))
  }
  const scripts = ['check-turbo-inputs.mjs', 'workspace-root.ts']
  for (const file of scripts) {
    copyFileSync(path.join(repository, 'editor/scripts', file), path.join(family, 'scripts', file))
  }
  try {
    const check = Bun.spawnSync(['bun', 'scripts/check-turbo-inputs.mjs'], { cwd: family })
    expect(check.exitCode, check.stderr.toString()).toBe(0)
    const result = Bun.spawnSync(
      [
        'bun',
        '-e',
        'import { workspaceRoot } from "./scripts/workspace-root.ts"; console.log(workspaceRoot)',
      ],
      { cwd: family },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(path.resolve(result.stdout.toString().trim())).toBe(layout === 'nested' ? root : family)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const runtime = 'f73fbfd866b94a33791afff08a7278546b1771a2'
const markdown = '4505683e843b71ef2d0cb3938eb0c9a503c28147'
const nextRuntime = 'a'.repeat(40)
const nextMarkdown = 'b'.repeat(40)
const runtimeSpec = (revision: string) => `github:ShaulLavo/tree-sitter-x#${revision}`
const markdownSpec = (revision: string) => `github:ShaulLavo/tree-sitter-md#${revision}`

async function withUpdater(
  latestRuntime: string,
  latestMarkdown: string,
  peer: string,
  check: (fixture: { root: string; run: () => void; files: string[] }) => Promise<void>,
  layout: 'nested' | 'standalone' = 'nested',
  runtimeVersion = '0.28.1',
) {
  const root = await mkdtemp(path.join(tmpdir(), 'editor-runtime-update-'))
  const family = layout === 'nested' ? 'editor' : 'singapore'
  const editor = path.join(root, family)
  const scripts = path.join(editor, 'scripts')
  const bin = path.join(root, 'bin')
  const files: string[] = []
  try {
    await mkdir(scripts, { recursive: true })
    await mkdir(bin)
    for (const name of ['update-tree-sitter-x.ts', 'workspace-root.ts']) {
      await writeFile(
        path.join(scripts, name),
        await readFile(path.resolve(import.meta.dirname, '../editor/scripts', name)),
      )
    }
    await writeFile(
      path.join(editor, 'package.json'),
      JSON.stringify({
        workspaces: ['packages/*'],
        overrides: { 'web-tree-sitter': runtimeSpec(runtime) },
      }),
    )
    const manifests: Record<string, unknown> = {
      'package.json': {
        workspaces: layout === 'nested' ? ['editor/packages/*'] : ['other/*'],
        overrides: { 'web-tree-sitter': runtimeSpec(runtime) },
      },
      'scripts/release/editor-fixture.json': {
        packages: [
          { dependencies: { 'web-tree-sitter': runtimeSpec(runtime) } },
          { dependencies: { 'tree-sitter-md': markdownSpec(markdown) } },
        ],
      },
      [`${family}/packages/tree-sitter-languages/languages.json`]: {
        sources: { 'tree-sitter-md': { revision: markdown, version: '0.1.2' } },
      },
    }
    for (const name of ['editor', 'markdown', 'tree-sitter', 'tree-sitter-languages']) {
      const dependencies: Record<string, string> = { 'tree-sitter-md': markdownSpec(markdown) }
      if (name.startsWith('tree-sitter')) dependencies['web-tree-sitter'] = runtimeSpec(runtime)
      manifests[`${family}/packages/${name}/package.json`] = { dependencies }
    }
    for (const [relative, manifest] of Object.entries(manifests)) {
      const file = path.join(root, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
      files.push(file)
    }
    await writeFile(
      path.join(bin, 'git'),
      `#!/bin/sh\ncase "$*" in\n  *tree-sitter-md*) printf '%s\\tHEAD\\n' '${latestMarkdown}' ;;\n  *) printf '%s\\trefs/heads/web-tree-sitter\\n' '${latestRuntime}' ;;\nesac\n`,
      { mode: 0o755 },
    )
    await writeFile(
      path.join(bin, 'bun'),
      `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd -P)" "$*" >> '${path.join(root, 'commands')}'\nif [ "$1" = "$(cat '${path.join(root, 'fail-step')}' 2>/dev/null)" ]; then exit 1; fi\n`,
      { mode: 0o755 },
    )
    const preload = path.join(root, 'fetch.mjs')
    await writeFile(
      preload,
      `globalThis.fetch = async (url) => {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(${JSON.stringify(path.join(root, 'requested-url'))}, String(url));
        if (String(url).includes('/tree-sitter-x/')) return Response.json(${JSON.stringify({ version: runtimeVersion })});
        return Response.json(${JSON.stringify({
          version: '0.1.2',
          peerDependencies: { 'web-tree-sitter': peer },
        })});
      };\n`,
    )
    const run = () => {
      execFileSync(
        process.execPath,
        ['--preload', preload, path.join(scripts, 'update-tree-sitter-x.ts')],
        {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          stdio: 'pipe',
        },
      )
    }
    await check({ root, run, files })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('an unchanged artifact preserves full SHAs and skips installation', async () => {
  await withUpdater(runtime, markdown, '^0.28.1', async ({ root, run, files }) => {
    const before = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    run()
    expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before)
    await expect(readFile(path.join(root, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

test('a matching Markdown source advances full host, peer, catalog, and fixture pins together', async () => {
  await withUpdater(nextRuntime, nextMarkdown, '^0.28.1', async ({ root, run, files }) => {
    run()
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    for (const text of contents) {
      expect(text).not.toContain(runtime)
      expect(text).not.toContain(markdown)
    }
    const host = JSON.parse(contents[0]!)
    expect(host.overrides['web-tree-sitter']).toBe(runtimeSpec(nextRuntime))
    expect(
      JSON.parse(await readFile(path.join(root, 'editor/package.json'), 'utf8')).overrides[
        'web-tree-sitter'
      ],
    ).toBe(runtimeSpec(nextRuntime))
    const fixture = JSON.parse(contents[1]!)
    expect(fixture.packages[0].dependencies['web-tree-sitter']).toBe(runtimeSpec(nextRuntime))
    expect(fixture.packages[1].dependencies['tree-sitter-md']).toBe(markdownSpec(nextMarkdown))
    expect(JSON.parse(contents[2]!).sources['tree-sitter-md'].revision).toBe(nextMarkdown)
    for (const text of contents.slice(3)) {
      const dependencies = JSON.parse(text).dependencies
      expect(dependencies['tree-sitter-md']).toBe(markdownSpec(nextMarkdown))
      if (dependencies['web-tree-sitter']) {
        expect(dependencies['web-tree-sitter']).toBe(runtimeSpec(nextRuntime))
      }
    }
    expect(await readFile(path.join(root, 'requested-url'), 'utf8')).toBe(
      `https://raw.githubusercontent.com/ShaulLavo/tree-sitter-x/${nextRuntime}/package.json`,
    )
    expect(await readFile(path.join(root, 'commands'), 'utf8')).toBe(
      `${root}|install\n${path.join(root, 'editor')}|run --cwd packages/tree-sitter-languages languages:generate\n`,
    )
  })
})

test.each([runtimeSpec(runtime), runtimeSpec(nextRuntime.slice(0, 7)), '^0.29.0', '=0.28.0'])(
  'an incompatible Markdown peer %s stops before any writes or installation',
  async (peer) => {
    await withUpdater(nextRuntime, nextMarkdown, peer, async ({ root, run, files }) => {
      const before = await Promise.all(files.map((file) => readFile(file, 'utf8')))
      expect(run).toThrow()
      expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before)
      await expect(readFile(path.join(root, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  },
)

test('a compatible runtime update preserves the Markdown source revision', async () => {
  await withUpdater(
    nextRuntime,
    markdown,
    '^0.28.1',
    async ({ root, run, files }) => {
      run()
      expect(JSON.parse(await readFile(files[0]!, 'utf8')).overrides['web-tree-sitter']).toBe(
        runtimeSpec(nextRuntime),
      )
      for (const text of await Promise.all(files.slice(3).map((file) => readFile(file, 'utf8')))) {
        expect(JSON.parse(text).dependencies['tree-sitter-md']).toBe(markdownSpec(markdown))
      }
      expect(await readFile(path.join(root, 'commands'), 'utf8')).toContain('install')
    },
    'nested',
    '0.28.2',
  )
})

test('a Markdown-only update advances the merged source at an unchanged runtime', async () => {
  await withUpdater(runtime, nextMarkdown, '^0.28.1', async ({ root, run, files }) => {
    run()
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    expect(JSON.parse(contents[0]!).overrides['web-tree-sitter']).toBe(runtimeSpec(runtime))
    for (const text of contents) expect(text).not.toContain(markdown)
    expect(await readFile(path.join(root, 'commands'), 'utf8')).toContain('install')
  })
})

test('standalone updates leave the parent graph whole and install inside the family', async () => {
  await withUpdater(
    nextRuntime,
    nextMarkdown,
    '^0.28.1',
    async ({ root, run, files }) => {
      const before = await Promise.all(files.slice(0, 2).map((file) => readFile(file, 'utf8')))
      run()
      expect(await Promise.all(files.slice(0, 2).map((file) => readFile(file, 'utf8')))).toEqual(
        before,
      )
      const editor = path.join(root, 'singapore')
      expect(await readFile(path.join(root, 'commands'), 'utf8')).toBe(
        `${editor}|install\n${editor}|run --cwd packages/tree-sitter-languages languages:generate\n`,
      )
      for (const file of files.slice(3)) {
        expect(JSON.parse(await readFile(file, 'utf8')).dependencies['tree-sitter-md']).toBe(
          markdownSpec(nextMarkdown),
        )
      }
    },
    'standalone',
  )
})

test('artifacts with a shared seven-character prefix still update the full pin', async () => {
  const revision = runtime.slice(0, 7) + 'c'.repeat(33)
  await withUpdater(revision, nextMarkdown, '^0.28.1', async ({ run, files }) => {
    run()
    expect(JSON.parse(await readFile(files[0]!, 'utf8')).overrides['web-tree-sitter']).toBe(
      runtimeSpec(revision),
    )
  })
})

test('an abbreviated remote SHA fails before writing the graph', async () => {
  await withUpdater('1234567', nextMarkdown, runtimeSpec('1234567'), async ({ run, files }) => {
    const before = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    expect(run).toThrow()
    expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before)
  })
})

test('authored host, Markdown, catalog, and release fixture pins agree with the required peer', () => {
  const read = (relative: string) =>
    JSON.parse(readFileSync(path.join(repository, relative), 'utf8'))
  const host = read('editor/packages/tree-sitter/package.json').dependencies
  const runtimePin = host['web-tree-sitter']
  const markdownPin = host['tree-sitter-md']
  expect(runtimePin).toMatch(/^github:ShaulLavo\/tree-sitter-x#[0-9a-f]{40}$/)
  expect(markdownPin).toMatch(/^github:ShaulLavo\/tree-sitter-md#[0-9a-f]{40}$/)
  expect(read('package.json').overrides['web-tree-sitter']).toBe(runtimePin)
  expect(read('editor/package.json').overrides['web-tree-sitter']).toBe(runtimePin)
  expect(read('editor/site/package.json').devDependencies['web-tree-sitter']).toBeUndefined()
  const require = createRequire(path.join(repository, 'editor/packages/tree-sitter/package.json'))
  const markdownName = Object.keys(host).find((name) => host[name] === markdownPin)
  const peer = JSON.parse(readFileSync(require.resolve(`${markdownName}/package.json`), 'utf8'))
  const runtimeName = Object.keys(host).find((name) => host[name] === runtimePin)
  expect(runtimeName).toBeDefined()
  const runtimeEntry = require.resolve(`${runtimeName}`)
  const runtimeManifest = JSON.parse(
    readFileSync(path.join(path.dirname(runtimeEntry), 'package.json'), 'utf8'),
  )
  expect(peer.peerDependencies['web-tree-sitter']).toMatch(/^\^\d+\.\d+\.\d+$/)
  expect(
    Bun.semver.satisfies(runtimeManifest.version, peer.peerDependencies['web-tree-sitter']),
  ).toBe(true)
  expect(peer.dependencies?.['web-tree-sitter']).toBeUndefined()
  const fixtures = read('scripts/release/editor-fixture.json').packages
  for (const name of ['editor', 'markdown', 'tree-sitter', 'tree-sitter-languages']) {
    const relative = `editor/packages/${name}/package.json`
    for (const manifest of [read(relative), fixtures[relative]]) {
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
      expect(dependencies['tree-sitter-md']).toBe(markdownPin)
      if (dependencies['web-tree-sitter']) {
        expect(dependencies['web-tree-sitter']).toBe(runtimePin)
      }
    }
  }
  const catalog = read('editor/packages/tree-sitter-languages/languages.json')
  expect(catalog.sources['tree-sitter-md'].revision).toBe(markdownPin.split('#')[1])
})

test.each(['install', 'run'])(
  'a failed %s restores source pins and retries the same pair',
  async (step) => {
    await withUpdater(nextRuntime, nextMarkdown, '^0.28.1', async ({ root, run, files }) => {
      const before = await Promise.all(files.map((file) => readFile(file, 'utf8')))
      const failure = path.join(root, 'fail-step')
      await writeFile(failure, step)
      expect(run).toThrow()
      expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before)
      await rm(failure)
      run()
      expect(JSON.parse(await readFile(files[0]!, 'utf8')).overrides['web-tree-sitter']).toBe(
        runtimeSpec(nextRuntime),
      )
      expect(JSON.parse(await readFile(files[2]!, 'utf8')).sources['tree-sitter-md'].revision).toBe(
        nextMarkdown,
      )
      expect(await readFile(path.join(root, 'commands'), 'utf8')).toContain(
        `${root}|install\n${path.join(root, 'editor')}|run --cwd packages/tree-sitter-languages languages:generate\n`,
      )
    })
  },
)
