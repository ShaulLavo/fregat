import { existsSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(repository, 'editor/package.json'))
const { createLogger, loadConfigFromFile } = await import(require.resolve('vite'))

const ghosttyNeedsSwiftShader =
  process.platform === 'linux' &&
  process.env.GHOSTTY_BROWSER_HARDWARE !== '1' &&
  (process.env.GHOSTTY_BROWSER_ENGINE ?? 'chromium') === 'chromium'
const swiftShaderDriver = path.join(
  path.dirname(chromium.executablePath()),
  'vk_swiftshader_icd.json',
)
const missingSwiftShader = ghosttyNeedsSwiftShader && !existsSync(swiftShaderDriver)

const configurations = [
  'apps/web/vite.config.ts',
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.browser.config.ts',
  'apps/web/vitest.tree-browser.config.ts',
  'apps/web/retention-acceptance.vitest.config.ts',
  'ghostty-webgpu/vitest.browser.config.ts',
  'editor/packages/editor/vitest.config.ts',
  'editor/packages/highlighting/vitest.config.ts',
  'editor/packages/typescript-lsp/vitest.config.ts',
]

for (const loader of ['bundle', 'native'] as const) {
  test.for(configurations)(
    '%s loads with ' + loader + ' without native compatibility warnings',
    async (relative, { skip }) => {
      if (relative === 'ghostty-webgpu/vitest.browser.config.ts' && missingSwiftShader)
        skip(
          'Ghostty Chromium config loading requires the installed Playwright SwiftShader Vulkan driver',
        )
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

test.for(['bundle', 'native'] as const)(
  'reload config loads through Node with %s and preserves its test commands',
  (loader) => {
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
            'retention-acceptance.vitest.config.ts', process.cwd(), 'warn', logger,
            ${JSON.stringify(loader)},
          );
          assert.ok(result?.config.test);
          assert.deepEqual(result.config.test.globalSetup, ['./test/env/retention-acceptance-file-server.ts']);
          assert.deepEqual(result.config.test.include, ['src/features/editor/tests/retention-acceptance-reload.browser.tsx']);
          assert.equal(typeof result.config.test.browser.commands.retentionAcceptanceReload, 'function');
          assert.equal(typeof result.config.test.browser.commands.retentionAcceptanceReloadFinish, 'function');
          assert.deepEqual(warnings.filter((message) => message.includes("configLoader: 'native'")), []);
        `,
      ],
      { cwd: path.join(repository, 'apps/web'), encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
  },
)
