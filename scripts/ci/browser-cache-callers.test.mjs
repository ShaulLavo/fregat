import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { YAML } from 'bun'

const root = new URL('../../', import.meta.url)
const browserAction = './.github/actions/install-browsers'
const flake = YAML.parse(await readFile(new URL('.github/workflows/flake-watch.yml', root), 'utf8'))
const ci = YAML.parse(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8'))

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

test('Fregat site checks install every engine through the scripts workspace', () => {
  expect(browserSteps(ci.jobs.site)).toEqual([
    {
      name: 'Install Fregat site browsers',
      uses: browserAction,
      with: {
        playwright: 'scripts/node_modules/.bin/playwright',
        browsers: 'chromium firefox webkit',
      },
    },
  ])
})

test.each([
  ['flake watch', flake.jobs.repeat],
  ['Fregat site', ci.jobs.site],
])('%s leaves browser payload and APT cache ownership to the shared action', (_, job) => {
  const caches = job.steps.filter((step) => step.uses?.startsWith('actions/cache'))
  expect(
    caches.filter((step) => /playwright/.test(`${step.with?.path} ${step.with?.key}`)),
  ).toEqual([])
  expect(job.steps.map((step) => step.run ?? '').join('\n')).not.toMatch(
    /playwright\s+install|ms-playwright|playwright-apt/,
  )
})
