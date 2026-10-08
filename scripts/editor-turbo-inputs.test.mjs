import { expect, test } from 'vitest'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { withWorkspace } from './release/fixture.mjs'

async function withEditor(run, { standalone = false } = {}) {
  await withWorkspace(async ({ root, put }) => {
    const editor = join(root, 'editor')
    const packageDirectory = join(editor, 'packages/reader')
    await put('editor', { workspaces: ['packages/*'] })
    if (!standalone) await put('.', { workspaces: ['editor/packages/*'] })
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        build: 'vite build',
        test: 'vitest run',
        'test:browser': 'vitest run --config vitest.browser.config.ts',
        'test:server': 'bun --bun vitest run --config vitest.server.config.ts',
      },
    })
    await mkdir(join(editor, 'scripts'), { recursive: true })
    for (const file of ['check-turbo-inputs.mjs', 'workspace-root.ts']) {
      await copyFile(
        new URL(`../editor/scripts/${file}`, import.meta.url),
        join(editor, 'scripts', file),
      )
    }
    const write = async (file, contents) => {
      await mkdir(dirname(join(editor, file)), { recursive: true })
      await writeFile(join(editor, file), contents)
    }
    await write('shared.ts', 'export const shared = true\n')
    const turboRoot = standalone ? editor : root
    const configure = async (tasks) => {
      await writeFile(join(turboRoot, 'turbo.json'), JSON.stringify({ tasks }))
    }
    await configure({ test: {}, 'test:browser': {}, 'test:server': {} })
    const check = () =>
      spawnSync('bun', [join(editor, 'scripts/check-turbo-inputs.mjs')], {
        cwd: packageDirectory,
        encoding: 'utf8',
      })
    await run({ write, configure, check, put })
  })
}

const externalRead = "import { shared } from '../../shared.ts'\n"

test.each(['vitest.config.ts', 'vite.config.ts'])(
  'default config %s still rejects undeclared outside-workspace reads',
  async (config) => {
    await withEditor(async ({ write, check }) => {
      await write(`packages/reader/${config}`, externalRead)
      const result = check()
      expect(result.status, result.stdout + result.stderr).toBe(1)
      expect(result.stderr).toContain(`${config} reads shared.ts`)
      expect(result.stderr).toMatch(/cached by (?:build, )?test\n/)
    })
  },
)

test.each([
  ['vitest.browser.config.ts', 'test:browser'],
  ['vitest.server.config.ts', 'test:server'],
])('split config %s is checked against %s', async (config, task) => {
  await withEditor(async ({ write, configure, check }) => {
    await write(`packages/reader/${config}`, externalRead)
    await configure({ test: { cache: false }, [task]: {} })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain(`${config} reads shared.ts`)
    expect(result.stderr).toContain(`cached by ${task}\n`)
  })
})

test.each([false, true])(
  'explicit split-config input passes with caching enabled, standalone=%s',
  async (standalone) => {
    await withEditor(
      async ({ write, configure, check }) => {
        await write('packages/reader/vitest.browser.config.ts', externalRead)
        await configure({
          test: {},
          'test:browser': {
            inputs: ['$TURBO_DEFAULT$', `$TURBO_ROOT$/${standalone ? '' : 'editor/'}shared.ts`],
          },
        })
        const result = check()
        expect(result.status, result.stdout + result.stderr).toBe(0)
        expect(result.stdout).toContain('every cross-package read is hashed')
      },
      { standalone },
    )
  },
)

test('a default config is only read by the scripts that load it', async () => {
  await withEditor(async ({ write, configure, check }) => {
    await write('packages/reader/vitest.config.ts', externalRead)
    await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] } })
    expect(check().status).toBe(0)
  })
})

test.each([
  '--config configs/browser.ts',
  '--config=./configs/browser.ts',
  '--config "configs/browser.ts"',
  "--config './configs/browser.ts'",
])('custom config paths are discovered through %s', async (flag) => {
  await withEditor(async ({ put, write, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { 'verify:browser': `vitest run ${flag}` },
    })
    await write('packages/reader/configs/browser.ts', "import '../../../shared.ts'\n")
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('cached by verify:browser\n')
  })
})

test('each script using a shared config must hash its reads', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        test: 'vitest run --config configs/browser.ts',
        'test:browser': 'vitest run --config configs/browser.ts',
      },
    })
    await write('packages/reader/configs/browser.ts', "import '../../../shared.ts'\n")
    await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] } })
    expect(check().stderr).toContain('cached by test:browser\n')
  })
})

test('nested config helpers retain the consuming script tasks', async () => {
  await withEditor(async ({ write, check }) => {
    await write('packages/reader/vitest.browser.config.ts', "import './config-helper.ts'\n")
    await write('packages/reader/config-helper.ts', externalRead)
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('config-helper.ts reads shared.ts')
    expect(result.stderr).toContain('cached by test:browser\n')
  })
})

test('scripts calling another package script consume its config', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        test: 'bun run test:browser',
        'test:browser': 'vitest run --config vitest.browser.config.ts',
      },
    })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    await configure({
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    expect(check().stderr).toContain('cached by test\n')
  })
})

test('Vitest project config files are checked through their parent config', async () => {
  await withEditor(async ({ write, check }) => {
    await write(
      'packages/reader/vitest.config.ts',
      "export default { test: { projects: ['./configs/*.ts'] } }\n",
    )
    await write('packages/reader/configs/browser.ts', "import '../../../shared.ts'\n")
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('configs/browser.ts reads shared.ts')
    expect(result.stderr).toContain('cached by test\n')
  })
})

test('an unused split config does not create phantom cached tasks', async () => {
  await withEditor(async ({ put, write, check }) => {
    await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    expect(check().status).toBe(0)
  })
})
