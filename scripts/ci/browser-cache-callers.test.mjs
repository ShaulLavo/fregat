import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { YAML } from 'bun'

const root = new URL('../../', import.meta.url)
const browserAction = './.github/actions/install-browsers'
const flake = YAML.parse(await readFile(new URL('.github/workflows/flake-watch.yml', root), 'utf8'))
const docs = YAML.parse(await readFile(new URL('.github/workflows/ghostty-docs.yml', root), 'utf8'))

function browserSteps(job) {
  return job.steps.filter((step) => step.uses === browserAction)
}

test('flake browser suites share the action cache and keep their Chromium install', () => {
  expect(browserSteps(flake.jobs.repeat)).toEqual([
    {
      name: 'Install Chromium',
      if: '${{ matrix.suite.browser }}',
      'timeout-minutes': 5,
      uses: browserAction,
      with: { playwright: 'apps/web/node_modules/.bin/playwright', browsers: 'chromium' },
    },
  ])
  expect(flake.jobs.repeat.strategy.matrix.suite.filter((suite) => suite.browser)).toEqual([
    {
      name: 'web browser',
      dir: 'apps/web',
      run: 'node_modules/.bin/vitest run --config vitest.browser.config.ts',
      browser: true,
    },
    {
      name: 'tree browser',
      dir: 'apps/web',
      run: 'node_modules/.bin/vitest run --config vitest.tree-browser.config.ts',
      browser: true,
    },
  ])
})

test('both docs sites install Chromium and WebKit with their own workspace executable', () => {
  expect(docs.jobs.docs.strategy.matrix.site).toEqual(['site', 'site-classic'])
  expect(browserSteps(docs.jobs.docs)).toEqual([
    {
      name: 'Install Chromium and WebKit',
      uses: browserAction,
      with: {
        playwright: 'ghostty-webgpu/${{ matrix.site }}/node_modules/.bin/playwright',
        browsers: 'chromium webkit',
      },
    },
  ])
  const names = docs.jobs.docs.steps.map((step) => step.name)
  expect(names.indexOf('Install Chromium and WebKit')).toBeGreaterThan(
    names.indexOf('Check samples, generate reference and validate links'),
  )
  expect(names.indexOf('Install Chromium and WebKit')).toBeLessThan(
    names.indexOf('Start docs preview'),
  )
})

test.each([
  ['flake watch', flake.jobs.repeat],
  ['ghostty docs', docs.jobs.docs],
])('%s leaves browser payload and APT cache ownership to the shared action', (_, job) => {
  const caches = job.steps.filter((step) => step.uses?.startsWith('actions/cache'))
  expect(
    caches.filter((step) => /playwright/.test(`${step.with?.path} ${step.with?.key}`)),
  ).toEqual([])
  expect(job.steps.map((step) => step.run ?? '').join('\n')).not.toMatch(
    /playwright\s+install|ms-playwright|playwright-apt/,
  )
})
