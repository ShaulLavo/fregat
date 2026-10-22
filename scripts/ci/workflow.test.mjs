import { expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { YAML } from 'bun'

const root = new URL('../../', import.meta.url)
const workflow = YAML.parse(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8'))
const format = workflow.jobs.docs.steps.find((step) => step.name === 'Format')
const manifest = await readFile(new URL('package.json', root), 'utf8')
const oxfmt = fileURLToPath(new URL('node_modules/.bin/oxfmt', root))

const images = {
  'docs/images/workbench.webp': Buffer.from([0, 255, 0, 128]),
  'docs/images/logo.svg': '<svg></svg>',
}

test.each([
  ['image-only changes', images, 0],
  ['empty changes', {}, 0],
  ['unsupported Astro', { 'docs/example.astro': '<div>unsupported' }, 0],
  ['unformatted agent instructions', { '.agents/skills/example/SKILL.md': '# Skill' }, 123],
  ['unformatted JSON5', { 'docs/example.json5': '{answer:42}' }, 123],
  ['unformatted Markdown alias', { 'docs/example.markdown': '# Heading' }, 123],
  ['mixed changes with unformatted text', { ...images, 'docs/example.json5': '{answer:42}' }, 123],
  [
    'mixed formatted changes and unusual filenames',
    {
      ...images,
      'docs/example.astro': '<div>unsupported',
      'docs/guide.md': '# Guide\n',
      'plans/a guide.mdx': '# Guide\n',
      'docs/line\nbreak.markdown': '# Guide\n',
    },
    0,
  ],
])('docs format handles %s', async (_, fixtures, expectedStatus) => {
  const directory = await mkdtemp(join(tmpdir(), 'docs-format-'))
  const output = join(directory, 'arguments')
  try {
    await writeFile(join(directory, 'package.json'), manifest)
    await writeFile(
      join(directory, 'bunx'),
      '#!/bin/sh\nprintf "%s\\0" "$@" > "$OUTPUT"\nshift\nexec "$OXFMT" "$@"\n',
      { mode: 0o755 },
    )
    for (const [file, content] of Object.entries(fixtures)) {
      await mkdir(dirname(join(directory, file)), { recursive: true })
      await writeFile(join(directory, file), content)
    }
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', format.run], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FILES: JSON.stringify(Object.keys(fixtures)),
        OUTPUT: output,
        OXFMT: oxfmt,
      },
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(expectedStatus)
    if (Object.keys(fixtures).length === 0) {
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
      return
    }
    const args = (await readFile(output, 'utf8')).split('\0').filter(Boolean)
    expect(args).toEqual(
      [
        `oxfmt@${JSON.parse(manifest).workspaces.catalog.oxfmt}`,
        '--check',
        '--no-error-on-unmatched-pattern',
      ].concat(Object.keys(fixtures).map((file) => `./${file}`)),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundle size does not block CI or repository verification', async () => {
  const runs = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).map((step) => step.run ?? ''),
  )
  expect(runs.join('\n')).not.toContain('bundle:gate')
  expect(JSON.parse(manifest).scripts.verify).not.toContain('bundle:gate')
  const web = JSON.parse(await readFile(new URL('apps/web/package.json', root), 'utf8'))
  expect(web.scripts).not.toHaveProperty('bundle:gate')
  expect(web.scripts).not.toHaveProperty('bundle:report')
  expect(await readFile(new URL('lefthook.yml', root), 'utf8')).not.toContain('bundle:gate')
  for (const file of ['bundle-gate.ts', 'bundle-gate.test.ts', 'first-load-pins.json']) {
    await expect(readFile(new URL(`apps/web/scripts/${file}`, root))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  }
})

test('chat Markdown CI runs bounded candidate checks without promotion receipts or evaluation', async () => {
  const markdown = YAML.parse(
    await readFile(new URL('.github/workflows/markdown-chat.yml', root), 'utf8'),
  )
  const web = JSON.parse(await readFile(new URL('apps/web/package.json', root), 'utf8'))
  expect(markdown.on.pull_request.paths).toEqual(markdown.on.push.paths)
  expect(markdown.on.pull_request.paths).toContain('packages/markdown/**')
  expect(markdown.on.pull_request.paths).toContain('apps/web/src/features/chat/**')
  expect(markdown.on.pull_request.paths).not.toContain('apps/web/**')
  expect(markdown.on.schedule).toEqual([{ cron: '23 2 * * *' }])
  const step = markdown.jobs['candidate-check'].steps.find((entry) => entry.run)
  expect(step.run).toBe('bun run markdown:check')
  expect(step.env).toMatchObject({
    VITEST_BROWSER_PORT: '5397',
    VITEST_BROWSER_FILE_SERVER_PORT: '33497',
  })
  expect(JSON.parse(manifest).scripts['markdown:check']).toBe(
    'bun run --cwd packages/markdown test qualification-candidate && bun run --cwd apps/web test:markdown',
  )
  expect(web.scripts['test:markdown']).toBe(
    'vitest run --config vitest.markdown-qualification.config.ts --mode candidate qualification-semantics.browser.tsx qualification-production.browser.tsx',
  )
})

test('nightly Markdown checks pair development engines and keep diagnostic performance failures visible', async () => {
  const markdown = YAML.parse(
    await readFile(new URL('.github/workflows/markdown-chat.yml', root), 'utf8'),
  )
  const scripts = JSON.parse(manifest).scripts
  expect(markdown.on).toHaveProperty('workflow_dispatch')
  expect(scripts['markdown:nightly']).toBe('bun scripts/markdown/qualify.ts --checks-only')
  expect(scripts['markdown:production:smoke']).toBe(
    'bun scripts/markdown/production-browser.ts --smoke --trials 2 --warmups 1 --negative-controls',
  )
  const checks = markdown.jobs['nightly-checks']
  expect(checks.strategy.matrix.include.map(({ suite, browser }) => `${suite}/${browser}`)).toEqual(
    ['parity/chromium', 'stream/chromium', 'fuzz/chromium', 'visual/chromium', 'visual/webkit'],
  )
  expect(checks.strategy['max-parallel']).toBe(2)
  const diagnostic = markdown.jobs['nightly-benchmark-smoke']
  expect(diagnostic.strategy.matrix.runner).toEqual(['native', 'production'])
  for (const job of [checks, diagnostic]) {
    expect(job.if).toBe(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    )
    expect(job['timeout-minutes']).toBeLessThanOrEqual(55)
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job).not.toHaveProperty('continue-on-error')
    const run = job.steps.find((step) => step.run)
    expect(run.env).toMatchObject({
      VITEST_BROWSER_PORT: '5397',
      VITEST_BROWSER_FILE_SERVER_PORT: '33497',
    })
    expect(run.run).toContain('set -euo pipefail')
    expect(run.run).toContain('trap cleanup EXIT')
    expect(run.run).toContain('rm -rf "$scratch"')
    expect(run.run).toContain('test ! -e "$scratch"')
    expect(run.run).toContain('timeout --signal=TERM --kill-after=30s')
    expect(run.run).not.toMatch(/--baseline|--promotion-receipts|--evaluation|\|\| true|20.*trials/)
    expect(run).not.toHaveProperty('continue-on-error')
    const artifact = job.steps.find((step) => step.uses === 'actions/upload-artifact@v4')
    expect(artifact.if).toBe('always()')
    expect(artifact.with['if-no-files-found']).toBe('error')
  }
  const smoke = diagnostic.steps.find((step) => step.run).run
  expect(smoke).toContain('"scope":"diagnostic-smoke"')
  expect(smoke).toContain('"promotion":"NOT VERIFIED"')
  expect(smoke).toContain('markdown:nightly bench')
  expect(smoke).toContain('markdown:production:smoke')
  expect(smoke).toContain('--port 5399')
})

test.each([
  ['nightly-checks', 'visual', 'chromium', 0],
  ['nightly-checks', 'fuzz', 'chromium', 1],
  ['nightly-benchmark-smoke', 'native', 'chromium', 1],
  ['nightly-benchmark-smoke', 'production', 'chromium', 1],
])(
  'nightly shell %s/%s preserves exit status and removes only its owned scratch',
  async (jobId, suite, browser, status) => {
    const markdown = YAML.parse(
      await readFile(new URL('.github/workflows/markdown-chat.yml', root), 'utf8'),
    )
    const run = markdown.jobs[jobId].steps.find((step) => step.run).run
    const directory = await mkdtemp(join(tmpdir(), 'markdown-workflow-'))
    try {
      await writeFile(
        join(directory, 'bun'),
        '#!/bin/sh\nprintf "%s" "$TMPDIR" > "$RUNNER_TEMP/owned-scratch"\nprintf "%s\\n" "$*" > "$RUNNER_TEMP/command"\necho diagnostic-output\nexit "$TEST_EXIT"\n',
        { mode: 0o755 },
      )
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', run], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RUNNER_TEMP: directory,
          SUITE: suite,
          BROWSER: browser,
          SMOKE_RUNNER: suite,
          TEST_EXIT: String(status),
        },
        encoding: 'utf8',
      })
      expect(result.status, result.stdout + result.stderr).toBe(status)
      const scratch = await readFile(join(directory, 'owned-scratch'), 'utf8')
      await expect(stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
      const evidence = jobId === 'nightly-checks' ? `${suite}-${browser}` : suite
      expect(
        await readFile(join(directory, 'markdown-nightly', evidence, 'execution.log'), 'utf8'),
      ).toContain('diagnostic-output')
      expect(await readFile(join(directory, 'command'), 'utf8')).toContain(
        suite === 'production' ? '--port 5399' : 'markdown:nightly',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('script test partition discovers every file once and reuses built outputs', async () => {
  const original = workflow.jobs.typecheck
  const isolated = workflow.jobs['test-promotion-evidence']
  expect(isolated).toBeDefined()
  expect(isolated.needs).toEqual(['changes', 'typecheck'])
  expect(isolated.if).toBe("${{ needs.changes.outputs.tooling == 'true' }}")
  expect(isolated['timeout-minutes']).toBe(20)
  expect(original['timeout-minutes']).toBe(20)
  expect(workflow.jobs.verdict.needs).toContain('test-promotion-evidence')
  expect(workflow.jobs.verdict.if).toBe('${{ always() }}')
  const commands = [original, isolated].map(
    (job) => job.steps.find((step) => step.name === 'Script tests').run,
  )
  const discover = (command) => {
    const run = command.replace(
      'bun run test:scripts',
      'bun --bun vitest list --config vitest.scripts.config.mjs',
    )
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', `${run} --filesOnly --json`], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    return JSON.parse(result.stdout)
      .map((entry) => entry.file)
      .sort()
  }
  const all = discover('bun run test:scripts')
  const general = discover(commands[0])
  const promotion = discover(commands[1])
  expect(promotion).toEqual([
    fileURLToPath(new URL('scripts/markdown/promotion-evidence.test.ts', root)),
  ])
  expect(general.concat(promotion).sort()).toEqual(all)
  expect(new Set(general.concat(promotion)).size).toBe(all.length)
  expect(original.steps.find((step) => step.name === 'Package tests').run).toBe(
    'bun scripts/ci/packages.mjs tests "$CI_PACKAGES"',
  )
  expect(isolated.steps.find((step) => step.name === 'Setup').with['build-packages']).toBe('[]')
  const upload = original.steps.find((step) => step.uses === 'actions/upload-artifact@v4')
  const download = isolated.steps.find((step) => step.uses === 'actions/download-artifact@v4')
  expect(upload.with.name).toBe(download.with.name)
  expect(upload.with['if-no-files-found']).toBe('error')
  expect(upload.if).toBe(isolated.if)
  const directory = await mkdtemp(join(tmpdir(), 'ci-build-transfer-'))
  try {
    const source = join(directory, 'source')
    const destination = join(directory, 'destination')
    await mkdir(destination)
    for (const base of ['editor/packages', 'packages', 'hotkeys', 'ghostty-webgpu']) {
      await mkdir(join(source, base), { recursive: true })
    }
    for (const file of ['editor/packages/parser/dist/parser.wasm', 'hotkeys/core/dist/index.js']) {
      await mkdir(dirname(join(source, file)), { recursive: true })
      await writeFile(join(source, file), 'built output')
    }
    const archive = original.steps.find((step) => step.name === 'Archive script test builds')
    const restore = isolated.steps.find((step) => step.name === 'Restore script test builds')
    for (const [cwd, step] of [
      [source, archive],
      [destination, restore],
    ]) {
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
        cwd,
        env: { ...process.env, RUNNER_TEMP: directory },
        encoding: 'utf8',
      })
      expect(result.status, result.stdout + result.stderr).toBe(0)
    }
    expect(
      await readFile(join(destination, 'editor/packages/parser/dist/parser.wasm'), 'utf8'),
    ).toBe('built output')
    expect(await readFile(join(destination, 'hotkeys/core/dist/index.js'), 'utf8')).toBe(
      'built output',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
