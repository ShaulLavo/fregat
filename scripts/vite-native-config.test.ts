import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(repository, 'apps/web/package.json'))
const { createLogger, loadConfigFromFile } = await import(require.resolve('vite'))

const configurations = [
  'apps/web/vite.config.ts',
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.browser.config.ts',
  'apps/web/vitest.tree-browser.config.ts',
  'apps/web/retention-acceptance.vitest.config.ts',
  'apps/web/retention-acceptance-layout.vitest.config.ts',
]

for (const loader of ['bundle', 'native'] as const) {
  test.for(configurations)(
    '%s loads with ' + loader + ' without native compatibility warnings',
    async (relative) => {
      const configFile = path.join(repository, relative)
      const warnings: string[] = []
      const logger = createLogger()
      logger.warn = (message: string) => warnings.push(message)
      const result = await loadConfigFromFile(
        { command: 'serve', mode: 'test' },
        configFile,
        path.dirname(configFile),
        'warn',
        logger,
        loader,
      )
      expect(result?.config).toBeDefined()
      if (relative !== 'apps/web/vite.config.ts') expect(result?.config.test).toBeDefined()
      expect(warnings.filter((message) => message.includes("configLoader: 'native'"))).toEqual([])
    },
  )
}

test.for(['apps/web/vite.config.ts', 'apps/web/vitest.browser.config.ts'])(
  '%s keeps installed worker core in the editor optimizer graph',
  async (relative) => {
    const file = path.join(repository, relative)
    const result = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      file,
      path.dirname(file),
    )
    const dependencies = result?.config.optimizeDeps
    const workerCore = '@singapore-editor/core/internal/document-worker'
    const coreIsSource = dependencies?.exclude?.includes('@singapore-editor/core')
    if (coreIsSource) {
      expect(dependencies?.include).not.toContain(workerCore)
      return
    }
    expect(dependencies?.include).toContain(workerCore)
    if (relative === 'apps/web/vitest.browser.config.ts')
      expect(dependencies?.exclude).toContain('@singapore-editor/tree-sitter')
  },
)

const retentionConfigurations = [
  {
    name: 'reload',
    file: 'retention-acceptance.vitest.config.ts',
    globalSetup: ['./test/env/retention-acceptance-file-server.ts'],
    include: ['src/features/editor/tests/retention-acceptance-reload.browser.tsx'],
    commands: ['retentionAcceptanceReload', 'retentionAcceptanceReloadFinish'],
  },
  {
    name: 'layout',
    file: 'retention-acceptance-layout.vitest.config.ts',
    globalSetup: ['./test/env/retention-acceptance-layout-server.ts'],
    include: ['src/features/editor/tests/retention-acceptance-layout.proof.tsx'],
    commands: ['retentionLayoutArchive'],
  },
]

const retentionLoaders = retentionConfigurations.flatMap((config) =>
  ['bundle', 'native'].map((loader) => ({ ...config, loader })),
)

test.for(retentionLoaders)(
  '$name config loads through Node with $loader and preserves its test commands',
  ({ file, globalSetup, include, commands, loader }) => {
    const current = realpathSync(process.execPath)
    const node = process.versions.bun
      ? (process.env.PATH ?? '')
          .split(path.delimiter)
          .map((directory) => Bun.which('node', { PATH: directory }))
          .find((candidate) => candidate !== null && realpathSync(candidate) !== current)
      : process.execPath
    assert(node, 'A Node executable is required for native config loading')
    const result = spawnSync(
      node,
      [
        // Node 22.12 requires an explicit opt-in to load TypeScript files.
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        `
          import assert from 'node:assert/strict';
          assert.equal(process.versions.bun, undefined, 'config loading must run in Node');
          const { createLogger, loadConfigFromFile } = await import(${JSON.stringify(pathToFileURL(require.resolve('vite')).href)});
          const warnings = [];
          const logger = createLogger();
          logger.warn = (message) => warnings.push(message);
          const result = await loadConfigFromFile(
            { command: 'serve', mode: 'test' },
            ${JSON.stringify(file)}, process.cwd(), 'warn', logger,
            ${JSON.stringify(loader)},
          );
          assert.ok(result?.config.test);
          assert.deepEqual(result.config.test.globalSetup, ${JSON.stringify(globalSetup)});
          assert.deepEqual(result.config.test.include, ${JSON.stringify(include)});
          for (const command of ${JSON.stringify(commands)})
            assert.equal(typeof result.config.test.browser.commands[command], 'function', command);
          assert.deepEqual(warnings.filter((message) => message.includes("configLoader: 'native'")), []);
        `,
      ],
      { cwd: path.join(repository, 'apps/web'), encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
  },
)
