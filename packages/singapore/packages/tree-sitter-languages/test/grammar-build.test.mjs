import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratchDirectories = []
// The PATH fixture is a POSIX executable; Windows needs a native command fixture.
const skipExecutableFixture = process.platform === 'win32'

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

it('ordinary installs exclude the native grammar compiler', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    expect(manifest[section]?.['tree-sitter-cli'], section).toBeUndefined()
  }
  let directory = root
  while (!existsSync(resolve(directory, 'bun.lock')) && dirname(directory) !== directory) {
    directory = dirname(directory)
  }
  expect(existsSync(resolve(directory, 'bun.lock')), 'workspace install lock').toBe(true)
  expect(await readFile(resolve(directory, 'bun.lock'), 'utf8')).not.toContain('tree-sitter-cli')
})

it.skipIf(skipExecutableFixture)(
  'forwards compiler arguments, output and working directory',
  async () => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'grammar-cli-test-'))
    scratchDirectories.push(scratch)
    const calls = resolve(scratch, 'calls.json')
    await writeFile(
      resolve(scratch, 'bun'),
      `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\nconsole.log('compiled');\n`,
      { mode: 0o755 },
    )
    const module = pathToFileURL(resolve(root, 'scripts/tree-sitter-cli.mjs')).href
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { runTreeSitter } from ${JSON.stringify(module)}; console.log(runTreeSitter(['build', '--wasm', '.', '-o', 'grammar.wasm'], process.cwd()));`,
      ],
      {
        cwd: scratch,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PATH: `${scratch}${delimiter}${process.env.PATH}` },
      },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('compiled')
    expect(JSON.parse(await readFile(calls, 'utf8'))).toEqual({
      args: [
        'x',
        '--package',
        'tree-sitter-cli@0.27.0',
        'tree-sitter',
        'build',
        '--wasm',
        '.',
        '-o',
        'grammar.wasm',
      ],
      cwd: await realpath(scratch),
    })
  },
)

it('reports a missing Bun launcher before invoking the compiler', () => {
  const module = pathToFileURL(resolve(root, 'scripts/tree-sitter-cli.mjs')).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { runTreeSitter } from ${JSON.stringify(module)}; runTreeSitter(['--version'], process.cwd());`,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: '' },
    },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('ENOENT')
})

it.skipIf(skipExecutableFixture).each(['build-sql.mjs', 'build-mdx.mjs', 'build-grammars.mjs'])(
  '%s requests the pinned compiler before fetching grammar sources',
  async (script) => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'grammar-cli-test-'))
    scratchDirectories.push(scratch)
    const calls = resolve(scratch, 'calls.json')
    await writeFile(
      resolve(scratch, 'bun'),
      `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\nconsole.log('tree-sitter 0.26.0');\n`,
      { mode: 0o755 },
    )
    const result = spawnSync(process.execPath, [resolve(root, 'scripts', script)], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, TMPDIR: scratch, PATH: `${scratch}${delimiter}${process.env.PATH}` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unexpected compiler: tree-sitter 0.26.0')
    expect(JSON.parse(await readFile(calls, 'utf8'))).toEqual([
      'x',
      '--package',
      'tree-sitter-cli@0.27.0',
      'tree-sitter',
      '--version',
    ])
  },
)

it.skipIf(skipExecutableFixture).each(['build-sql.mjs', 'build-mdx.mjs', 'build-grammars.mjs'])(
  '%s stops when on-demand acquisition fails',
  async (script) => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'grammar-cli-test-'))
    scratchDirectories.push(scratch)
    await writeFile(
      resolve(scratch, 'bun'),
      `#!${process.execPath}\nconsole.error('compiler acquisition failed');\nprocess.exit(17);\n`,
      { mode: 0o755 },
    )
    const result = spawnSync(process.execPath, [resolve(root, 'scripts', script)], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, TMPDIR: scratch, PATH: `${scratch}${delimiter}${process.env.PATH}` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('compiler acquisition failed')
  },
)
