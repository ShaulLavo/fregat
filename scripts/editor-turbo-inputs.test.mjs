import { expect, test } from 'vitest'
import { copyFile, mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    await symlink(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(editor, 'node_modules'),
      'junction',
    )
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
    await write('packages/reader/vitest.browser.config.ts', 'export default {}\n')
    await write('packages/reader/vitest.server.config.ts', 'export default {}\n')
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

test.each([
  "'configs/browser.ts'",
  "{ extends: './configs/browser.ts', test: { name: 'browser' } }",
])('Vitest project wiring %s carries the parent task', async (project) => {
  await withEditor(async ({ write, check }) => {
    await write(
      'packages/reader/vitest.config.ts',
      `export default { test: { projects: [${project}] } }\n`,
    )
    await write('packages/reader/configs/browser.ts', "import '../../../shared.ts'\n")
    expect(check().stderr).toContain('cached by test\n')
  })
})

test('a config inside a scanned source tree retains its actual task', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { 'test:browser': 'vitest run --config scripts/browser.ts' },
    })
    await write('packages/reader/scripts/browser.ts', "import '../../../shared.ts'\n")
    await configure({
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test('a project config inside a scanned tree retains its actual parent task', async () => {
  await withEditor(async ({ write, configure, check }) => {
    await write(
      'packages/reader/vitest.browser.config.ts',
      "export default { test: { projects: ['./scripts/project.ts'] } }\n",
    )
    await write('packages/reader/scripts/project.ts', "import '../../../shared.ts'\n")
    await configure({
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test('an input on the default test task cannot cover a browser-only config', async () => {
  await withEditor(async ({ write, configure, check }) => {
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] } })
    expect(check().stderr).toContain('cached by test:browser\n')
  })
})

test('cyclic script calls settle and retain their config consumers', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        test: 'bun run test:browser',
        'test:browser': 'vitest run --config vitest.browser.config.ts && bun run test',
      },
    })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    const inputs = ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts']
    await configure({ test: { inputs }, 'test:browser': { inputs } })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test('a config outside the package must itself be hashed by its consuming task', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { 'test:browser': 'vitest run --config ../../browser.ts' },
    })
    await write('browser.ts', 'export default {}\n')
    expect(check().stderr).toContain('package.json reads browser.ts')
    expect(check().stderr).toContain('cached by test:browser\n')
    await configure({
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/browser.ts'] },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test('exact workspace entries are checked alongside wildcard entries', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor', { workspaces: ['packages/*', 'site'] })
    await put('editor/site', { name: 'site', scripts: { test: 'vitest run' } })
    await write('site/vitest.config.ts', "import '../shared.ts'\n")
    const failed = check()
    expect(failed.status, failed.stdout + failed.stderr).toBe(1)
    expect(failed.stderr).toContain('site/vitest.config.ts reads shared.ts')
    await configure({
      'site#test': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    const passed = check()
    expect(passed.status, passed.stdout + passed.stderr).toBe(0)
    expect(passed.stdout).toContain('turbo inputs: 2 workspaces')
  })
})

test('an unused split config does not create phantom cached tasks', async () => {
  await withEditor(async ({ put, write, check }) => {
    await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    expect(check().status).toBe(0)
  })
})

test.each(['./configs', './configs/*'])(
  'directory project %s loads its config',
  async (project) => {
    await withEditor(async ({ put, write, configure, check }) => {
      await put('editor/packages/reader', {
        name: 'reader',
        scripts: { test: 'vitest run --project browser' },
      })
      await write(
        'packages/reader/vitest.config.ts',
        `export default { test: { projects: ['${project}'] } }\n`,
      )
      const config = project.endsWith('*')
        ? 'configs/browser/vitest.config.ts'
        : 'configs/vitest.config.ts'
      await write(
        `packages/reader/${config}`,
        `import '${project.endsWith('*') ? '../../../../' : '../../../'}shared.ts'\n`,
      )
      const failed = check()
      expect(failed.status, failed.stdout + failed.stderr).toBe(1)
      expect(failed.stderr).toContain(`${config} reads shared.ts`)
      expect(failed.stderr).toContain('cached by test\n')
      await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] } })
      const passed = check()
      expect(passed.status, passed.stdout + passed.stderr).toBe(0)
    })
  },
)

test.each(['projects', 'projects: projects', 'projects: [...projects]'])(
  'local project binding %s is resolved',
  async (property) => {
    await withEditor(async ({ put, write, configure, check }) => {
      await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
      await write(
        'packages/reader/vitest.config.ts',
        `const projects = ['configs/vitest.browser.config.ts']; export default { test: { ${property} } }\n`,
      )
      await write(
        'packages/reader/configs/vitest.browser.config.ts',
        "import '../../../shared.ts'\n",
      )
      const failed = check()
      expect(failed.status, failed.stdout + failed.stderr).toBe(1)
      expect(failed.stderr).toContain('configs/vitest.browser.config.ts reads shared.ts')
      await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] } })
      expect(check().status).toBe(0)
    })
  },
)

test.each([
  'projects: makeProjects()',
  'projects',
  'projects: [loadProject()]',
  'projects: [{ extends: configPath }]',
  "projects: ['./missing/*.ts']",
])('unresolved project wiring %s fails closed', async (property) => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { 'test:browser': 'vitest run --config configs/browser.ts' },
    })
    await write('packages/reader/configs/browser.ts', `export default { test: { ${property} } }\n`)
    await configure({
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('reader#test:browser')
    expect(result.stderr).toContain('configs/browser.ts')
    expect(result.stderr).toContain('Resolve')
  })
})

test('an explicitly selected missing config fails closed', async () => {
  await withEditor(async ({ put, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { test: 'vitest run --config missing.ts' },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('reader#test')
    expect(result.stderr).toContain('missing.ts')
  })
})

test.each(['bun test:browser', 'bun run test:browser', 'bun --bun test:browser'])(
  'parent task calling %s hashes child config reads',
  async (command) => {
    await withEditor(async ({ put, write, configure, check }) => {
      await put('editor/packages/reader', {
        name: 'reader',
        scripts: { test: command, 'test:browser': 'vitest run --config vitest.browser.config.ts' },
      })
      await write('packages/reader/vitest.browser.config.ts', externalRead)
      const inputs = ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts']
      await configure({ test: {}, 'test:browser': { inputs } })
      const failed = check()
      expect(failed.status, failed.stdout + failed.stderr).toBe(1)
      expect(failed.stderr).toContain('cached by test\n')
      await configure({ test: { inputs }, 'test:browser': { inputs } })
      expect(check().status).toBe(0)
    })
  },
)

test('script names used as command arguments do not create parent consumers', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        test: 'echo bun test:browser',
        'test:browser': 'vitest run --config vitest.browser.config.ts',
      },
    })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    await configure({
      test: {},
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    expect(check().status).toBe(0)
  })
})

test('config-only helpers in a scanned tree keep the config consumers', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: {
        build: 'vite build',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
        'test:browser': 'vitest run --config vitest.browser.config.ts',
      },
    })
    await write('packages/reader/vitest.browser.config.ts', "import './scripts/helper.ts'\n")
    await write('packages/reader/scripts/helper.ts', "import '../../../shared.ts'\n")
    await configure({
      build: {},
      typecheck: {},
      test: {},
      'test:browser': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test('cyclic project spreads fail closed with config context', async () => {
  await withEditor(async ({ put, write, check }) => {
    await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
    await write(
      'packages/reader/vitest.config.ts',
      'const projects = [...projects]; export default { test: { projects } }\n',
    )
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('reader#test')
    expect(result.stderr).toContain('vitest.config.ts')
    expect(result.stderr).toContain('Resolve')
  })
})

test('outside-workspace project configs and their helper closure are hashed', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
    await write(
      'packages/reader/vitest.config.ts',
      "export default { test: { projects: ['../../configs/*.ts'] } }\n",
    )
    await write('configs/browser.ts', "import './helpers/options.ts'\n")
    await write('configs/helpers/options.ts', "import './nested.ts'\n")
    await write('configs/helpers/nested.ts', "import '../../shared.ts'\n")
    const failed = check()
    expect(failed.status, failed.stdout + failed.stderr).toBe(1)
    expect(failed.stderr).toContain('shared.ts')
    await configure({ test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/configs/**'] } })
    expect(check().stderr).toContain('shared.ts')
    await configure({
      test: {
        inputs: [
          '$TURBO_DEFAULT$',
          '$TURBO_ROOT$/editor/configs/**',
          '$TURBO_ROOT$/editor/shared.ts',
        ],
      },
    })
    expect(check().status).toBe(0)
  })
})

test('a Bun built-in command does not call a same-named package script', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { verify: 'bun test', test: 'vitest run --config vitest.browser.config.ts' },
    })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    await configure({
      verify: {},
      test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts'] },
    })
    expect(check().status).toBe(0)
  })
})

test.each(['', 'export default {}\n'])(
  'directory projects retain default-config behavior %s',
  async (source) => {
    await withEditor(async ({ put, write, check }) => {
      await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
      await write(
        'packages/reader/vitest.config.ts',
        "export default { test: { projects: ['./configs'] } }\n",
      )
      await write('packages/reader/configs/test.spec.ts', 'export {}\n')
      if (source) await write('packages/reader/configs/vite.config.ts', source)
      expect(check().status).toBe(0)
    })
  },
)

test('config helpers hash the workspace-root manifest read precisely', async () => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', { name: 'reader', scripts: { test: 'vitest run' } })
    await write('packages/reader/vitest.config.ts', "import '../../scripts/workspace-root.ts'\n")
    const inputs = ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/scripts/workspace-root.ts']
    await configure({ test: { inputs } })
    const failed = check()
    expect(failed.status, failed.stdout + failed.stderr).toBe(1)
    expect(failed.stderr).toContain('workspace-root.ts reads ../package.json')
    await configure({ test: { inputs: [...inputs, '$TURBO_ROOT$/package.json'] } })
    const passed = check()
    expect(passed.status, passed.stdout + passed.stderr).toBe(0)
  })
})

test('tool names used as arguments do not select configs', async () => {
  await withEditor(async ({ put, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { test: 'echo vitest --config missing.ts' },
    })
    const result = check()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

test.each([
  'env MODE=test bun run test:browser',
  'MODE=test bun test:browser',
  'env MODE=test bun test:browser',
])('environment wrapper %s retains parent config reads', async (command) => {
  await withEditor(async ({ put, write, configure, check }) => {
    await put('editor/packages/reader', {
      name: 'reader',
      scripts: { test: command, 'test:browser': 'vitest run --config vitest.browser.config.ts' },
    })
    await write('packages/reader/vitest.browser.config.ts', externalRead)
    const inputs = ['$TURBO_DEFAULT$', '$TURBO_ROOT$/editor/shared.ts']
    await configure({ test: {}, 'test:browser': { inputs } })
    const failed = check()
    expect(failed.status, failed.stdout + failed.stderr).toBe(1)
    expect(failed.stderr).toContain('cached by test\n')
    await configure({ test: { inputs }, 'test:browser': { inputs } })
    expect(check().status).toBe(0)
  })
})
