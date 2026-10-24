import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { readWorkflow } from './workflow-fixtures'

const action = v.parse(
  v.object({
    runs: v.object({
      steps: v.array(
        v.object({
          name: v.string(),
          if: v.optional(v.string()),
          run: v.string(),
          'working-directory': v.optional(v.string()),
        }),
      ),
    }),
  }),
  Bun.YAML.parse(
    readFileSync(new URL('../.github/actions/standalone/action.yml', import.meta.url), 'utf8'),
  ),
)

function expression(source: string, context: Record<string, unknown>) {
  const body = source.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  return new Function(...Object.keys(context), `return (${body})`)(...Object.values(context))
}

function readTerminalWorkflow() {
  return v.parse(
    v.object({
      jobs: v.object({
        verify: v.object({
          steps: v.array(
            v.object({
              name: v.optional(v.string()),
              if: v.optional(v.string()),
              run: v.optional(v.string()),
            }),
          ),
        }),
      }),
    }),
    Bun.YAML.parse(
      readFileSync(new URL('../ghostty-webgpu/.github/workflows/ci.yml', import.meta.url), 'utf8'),
    ),
  )
}

test('manual shard experiments keep the PR and main default at four', () => {
  const ci = readWorkflow('ci.yml')
  const source = ci.jobs.changes!.outputs!.web_shards!
  for (const event of ['push', 'pull_request', 'schedule', 'workflow_dispatch']) {
    const result = expression(source, {
      github: { event_name: event },
      inputs: { web_shards: '2' },
    })
    expect(JSON.parse(result)).toEqual(
      event === 'workflow_dispatch' ? ['1/2', '2/2'] : ['1/4', '2/4', '3/4', '4/4'],
    )
  }
  expect(ci.jobs['test-web']!.strategy).toEqual({
    'fail-fast': false,
    matrix: { shard: '${{ fromJSON(needs.changes.outputs.web_shards) }}' },
  })
})

const reportSupported =
  process.platform === 'linux' && Bun.which('bash') !== null && Bun.which('jq') !== null
if (!reportSupported)
  console.info('Skipping CI timing shell proof. Linux, Bash, and jq are required.')

test.skipIf(!reportSupported)(
  'the verdict reports paginated queue timings without changing its gate',
  () => {
    const steps = readWorkflow('ci.yml').jobs.verdict!.steps
    const producer = steps.find((entry) => entry.name === 'Fetch CI metadata')!
    const step = steps.find((entry) => entry.name === 'Report queue and execution times')!
    expect(step['continue-on-error']).toBe(true)
    const root = mkdtempSync(path.join(tmpdir(), 'ci-timings-'))
    try {
      writeFileSync(
        path.join(root, 'ci-jobs.json'),
        JSON.stringify([
          {
            jobs: [
              {
                name: 'Server',
                created_at: '2026-01-01T00:01:00Z',
                started_at: '2026-01-01T00:08:00Z',
                completed_at: '2026-01-01T00:10:00Z',
                conclusion: 'success',
              },
            ],
          },
          {
            jobs: [
              { name: 'CI', started_at: '2026-01-01T00:12:00Z', completed_at: null },
              { name: 'Skipped', conclusion: 'skipped', started_at: null, completed_at: null },
            ],
          },
        ]),
      )
      writeFileSync(
        path.join(root, 'ci-run.json'),
        JSON.stringify({
          id: 1,
          run_attempt: 2,
          head_sha: 'a'.repeat(40),
          event: 'workflow_dispatch',
          path: '.github/workflows/ci.yml',
          repository: { full_name: 'fixture/repo' },
          created_at: '2026-01-01T00:00:00Z',
        }),
      )
      const result = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', `${step.run}`], {
        env: {
          ...process.env,
          RUNNER_TEMP: root,
          GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
          GH_REPO: 'fixture/repo',
          RUN_ID: '1',
          RUN_ATTEMPT: '2',
        },
      })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      const summary = readFileSync(path.join(root, 'summary.md'), 'utf8')
      expect(summary).toContain('| Server | 420 | 120 |')
      expect(summary).toContain('Run created to verdict runner started: 720 seconds')
      expect(summary).not.toContain('| Skipped |')
      expect(producer.run).toContain('/jobs?filter=latest&per_page=100')
      expect(producer['continue-on-error']).not.toBe(true)
      const jobFetches = steps.flatMap((entry) =>
        (entry.run ?? '')
          .split('\n')
          .filter((line) => line.includes('gh api ') && line.includes('/jobs?')),
      )
      expect(jobFetches).toHaveLength(1)
      expect(step.run).not.toContain('gh api ')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test('CI shares each ref group and cancels only older PR runs', () => {
  const source = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  expect(Bun.YAML.parse(source)).toHaveProperty('concurrency', {
    group: 'ci-${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': "${{ startsWith(github.ref, 'refs/pull/') }}",
  })
})

test('the main CI verdict includes all reusable library checks', () => {
  const workflow = readWorkflow('ci.yml')
  expect(workflow.jobs.libraries!.uses).toBe('./.github/workflows/workspace-libraries.yml')
  expect(workflow.jobs.verdict!.needs).toContain('libraries')
  expect(readWorkflow('workspace-libraries.yml').on).toHaveProperty('workflow_call')
})

test('standalone checks cover every mirror family from an exact folder export', () => {
  const workflow = readWorkflow('workspace-libraries.yml')
  expect(workflow.jobs.standalone!.strategy).toBeUndefined()
  const steps = action.runs.steps
  expect(steps.find((step) => step.name === 'Export exact mirror folder')?.run).toContain(
    'git archive "HEAD:$FAMILY"',
  )
  expect(steps.find((step) => step.name === 'Install standalone dependencies')?.run).toBe(
    'bun install',
  )
  expect(steps.find((step) => step.name === 'Verify standalone package graph')?.run).toBe(
    'bun run build && bun run typecheck && bun run lint && bun run format:check',
  )
})

function standaloneBuild(family: string, browserStatus = 0) {
  const root = mkdtempSync(path.join(tmpdir(), 'standalone-browser-'))
  try {
    mkdirSync(path.join(root, 'site/node_modules/.bin'), { recursive: true })
    writeFileSync(
      path.join(root, 'bun'),
      `#!/bin/bash
set -euo pipefail
printf 'bun %s\\n' "$*" >> calls
if [[ "$*" == install ]]; then touch dependencies; fi
if [[ "$*" == 'run build' && "$FAMILY" == editor ]]; then test -f browser; fi
`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(root, 'site/node_modules/.bin/playwright'),
      `#!/bin/bash
set -euo pipefail
test -f dependencies
[[ "$*" == 'install --with-deps chromium' ]]
printf 'playwright %s\\n' "$*" >> calls
if [[ "$BROWSER_STATUS" != 0 ]]; then exit "$BROWSER_STATUS"; fi
touch browser
`,
      { mode: 0o755 },
    )
    const runtime = action.runs.steps.findIndex(
      (step) => step.name === 'Check standalone tree-sitter runtime',
    )
    let status = 0
    for (const step of action.runs.steps.slice(1, runtime)) {
      if (step.if && !expression(step.if, { inputs: { family } })) continue
      expect(step['working-directory']).toBe('${{ steps.export.outputs.directory }}')
      const result = Bun.spawnSync(['bash', '-euo', 'pipefail', '-c', step.run], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          FAMILY: family,
          BROWSER_STATUS: String(browserStatus),
        },
      })
      status = result.exitCode
      if (status !== 0) break
    }
    return { status, calls: readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n') }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test.each(['editor', 'ghostty-webgpu', 'hotkeys'])(
  'standalone %s installs its build prerequisites before verification',
  (family) => {
    const result = standaloneBuild(family)
    expect(result.status, result.calls.join('\n')).toBe(0)
    const browser = family === 'editor' ? ['playwright install --with-deps chromium'] : []
    expect(result.calls).toEqual(
      ['bun install'].concat(
        browser,
        ['bun run build', 'bun run typecheck', 'bun run lint', 'bun run format:check'],
        family === 'ghostty-webgpu'
          ? ['bun run --cwd packages/line-editor verify', 'bun run --cwd packages/shaders verify']
          : [],
      ),
    )
  },
)

test('standalone Editor stops before building when its browser install fails', () => {
  const result = standaloneBuild('editor', 17)
  expect(result.status).toBe(17)
  expect(result.calls).toEqual(['bun install', 'playwright install --with-deps chromium'])
})

test('CI shares one production site build with every mobile shard', () => {
  const workflow = readWorkflow('ci.yml')
  const site = workflow.jobs.site!.steps
  expect(site.find((step) => step.name === 'Build production sites')?.run).toBe(
    'bash scripts/product-sites/build.sh "$RUNNER_TEMP/product-sites" "$CI_SITES" --reuse-workspace-builds',
  )
  const upload = site.find((step) => step.uses === 'actions/upload-artifact@v4')
  expect(upload?.with?.name).toBe('ci-product-sites')
  const mobile = workflow.jobs['mobile-layout']!
  expect(mobile.needs).toEqual(['changes', 'site'])
  expect(mobile.if).toBe("${{ needs.changes.outputs.site == 'true' }}")
  expect(mobile.steps.some((step) => step.run?.includes('product-sites/build.sh'))).toBe(false)
  const download = mobile.steps.find((step) => step.uses === 'actions/download-artifact@v4')
  expect(download?.with?.name).toBe(upload?.with?.name)
})

test('ordinary site checks use both phone engines and full runs retain disjoint exhaustive shards', () => {
  const ci = readWorkflow('ci.yml')
  const source = ci.jobs.changes!.outputs!.mobile_shards!
  for (const exhaustive of ['false', 'true']) {
    const values = expression(source, { steps: { plan: { outputs: { exhaustive } } } })
    expect(JSON.parse(values)).toEqual(
      exhaustive === 'true'
        ? ['chromium-0', 'chromium-1', 'webkit-0', 'webkit-1']
        : ['chromium-0', 'webkit-0'],
    )
  }
  expect(ci.jobs['mobile-layout']!.strategy?.matrix).toEqual({
    shard: '${{ fromJSON(needs.changes.outputs.mobile_shards) }}',
  })
})

test('Editor benchmark smoke runs only during full validation and basic regression cases remain', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  const smoke = steps.find((step) => step.name === 'Smoke dense syntax lifecycle')!
  expect(
    expression(smoke.if!, {
      github: { event_name: 'pull_request' },
      inputs: { exhaustive: false },
    }),
  ).toBe(false)
  expect(
    expression(smoke.if!, { github: { event_name: 'schedule' }, inputs: { exhaustive: true } }),
  ).toBe(true)
  expect(
    expression(smoke.if!, {
      github: { event_name: 'workflow_dispatch' },
      inputs: { exhaustive: false },
    }),
  ).toBe(true)
  expect(steps.map((step) => step.name)).toEqual(
    expect.arrayContaining([
      'Test collaboration signaling broker',
      'Test collaboration presence in Chromium',
      'Test collaboration transports in Chromium',
      'Smoke concurrent editor input and author undo',
    ]),
  )
})

test('canonical Editor CI checks the generated language catalog', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run).join('\n')).toContain(
    'bun run --cwd editor/packages/tree-sitter-languages languages:generate -- --check',
  )
})

test('Editor architecture health runs for every selected Editor job', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  const health = steps.find((step) => step.name === 'Check architecture health')!
  expect(health.run).toBe('bun run --cwd editor health')
  expect(health.if).toBeUndefined()
})

test('canonical ghostty CI runs the standalone verification contract', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  expect(steps.map((step) => step.run)).toContain('bun run --cwd ghostty-webgpu verify')
})

test('canonical ghostty CI checks the host package when native artifacts are assembled', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  const classifier = steps.find((step) => step.id === 'native-state')
  expect(classifier?.run).toContain('verify-config-resolver-artifacts.ts --state either')
  expect(classifier?.run).toContain('echo "state=$state" >> "$GITHUB_OUTPUT"')
  const host = steps.find((step) => step.run === 'bun run --cwd ghostty-webgpu test:package:host')
  expect(host?.if).toBe("${{ steps.native-state.outputs.state == 'assembled' }}")
})

test('standalone Editor checks shared runtime identity and Markdown initialization', () => {
  const steps = action.runs.steps
  const runtime = steps.find((step) => step.name === 'Check standalone tree-sitter runtime')
  expect(runtime?.if).toBe("${{ inputs.family == 'editor' }}")
  expect(runtime?.['working-directory']).toBe('${{ steps.export.outputs.directory }}')
  expect(runtime?.run).toBe('bun run --cwd packages/tree-sitter test:runtime')
})

test('standalone Editor also checks the exact clean hoisted graph', () => {
  const steps = action.runs.steps
  const runtime = steps.find((step) => step.name === 'Check hoisted standalone tree-sitter runtime')
  expect(runtime?.if).toBe("${{ inputs.family == 'editor' }}")
  expect(runtime?.run).toContain('git archive HEAD:editor')
  expect(runtime?.run).toContain('bun install --linker=hoisted')
  expect(runtime?.run).toContain('bun run --cwd packages/tree-sitter test:runtime')
})

test('each standalone install uses a fresh directory and selected families continue after failure', () => {
  expect(action.runs.steps[0]!.run).toContain('mktemp -d "$RUNNER_TEMP/mirror-$FAMILY-XXXXXX"')
  const steps = readWorkflow('workspace-libraries.yml').jobs.standalone!.steps.filter(
    (step) => step.with?.family,
  )
  for (const step of steps) expect(step.if).toContain('!cancelled()')
  expect(
    action.runs.steps.find((step) => step.name === 'Check hoisted standalone tree-sitter runtime')!
      .run,
  ).toContain('mktemp -d "$RUNNER_TEMP/mirror-editor-hoisted-XXXXXX"')
})

test.each([
  ['workflow_dispatch', false, '26'],
  ['workflow_call', true, '26'],
  ['workflow_call', false, '24'],
])(
  'standalone runtime for %s with Editor enabled %s selects Node %s',
  (event, editor, expected) => {
    const step = readWorkflow('workspace-libraries.yml').jobs.standalone!.steps.find(
      (entry) => entry.uses === 'actions/setup-node@v4',
    )
    const version = step?.with?.['node-version']
    expect(typeof version).toBe('string')
    if (typeof version !== 'string') return
    expect(
      expression(version, { github: { event_name: event }, inputs: { standalone_editor: editor } }),
    ).toBe(expected)
  },
)

test('automatic bump publication reuses one rolling branch for manual merging', () => {
  const workflow = readWorkflow('editor-tree-sitter-x.yml')
  expect(workflow.jobs.publish!.needs).toBe('update')
  const publish = workflow.jobs.publish!.steps.find((step) => step.name === 'Open a pull request')
  expect(publish?.run).toBe('node scripts/ci/parser-pins.mjs publish')

  const source = readFileSync(new URL('../scripts/ci/parser-pins.mjs', import.meta.url), 'utf8')
  expect(source).toContain("const branch = 'tree-sitter-x/updates'")
  expect(source).toContain('This PR stays open for manual review and merging.')
  expect(source).not.toContain('async function mergePins')
})

test('canonical ghostty CI verifies the separate line editor package', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  expect(steps.map((step) => step.run)).toContain(
    'bun run --cwd ghostty-webgpu/packages/line-editor verify',
  )
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(root.workspaces.packages).toContain('ghostty-webgpu/packages/*')
  expect(root.scripts['build:workspaces']).toContain('--filter=ghostty-webgpu-line-editor')
})

test('the provisional line editor workspace is private until publication is authorized', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../ghostty-webgpu/packages/line-editor/package.json', import.meta.url),
      'utf8',
    ),
  )
  expect(manifest.private).toBe(true)
})

test('line editor builds after the root terminal declarations', () => {
  const graph = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'))
  expect(graph.tasks['ghostty-webgpu-line-editor#build'].dependsOn).toContain(
    'ghostty-webgpu#build',
  )
})

test('shader verification builds public artifacts and runs real browser checks', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  expect(steps.map((step) => step.run)).toContain(
    'bun run --cwd ghostty-webgpu/packages/shaders verify && bun run --cwd ghostty-webgpu/packages/shaders test:browser',
  )
  const graph = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'))
  expect(graph.tasks['ghostty-webgpu-shaders#build'].dependsOn).toContain('ghostty-webgpu#build')
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(root.scripts['build:workspaces']).toContain('--filter=ghostty-webgpu-shaders')
  const manifest = JSON.parse(
    readFileSync(
      new URL('../ghostty-webgpu/packages/shaders/package.json', import.meta.url),
      'utf8',
    ),
  )
  expect(manifest.private).toBeUndefined()
  expect(manifest.dependencies).toBeUndefined()
  expect(Object.keys(manifest.peerDependencies)).toEqual(['ghostty-webgpu'])
})

test('standalone Ghostty builds shader browser dependencies before core verification', () => {
  const steps = readTerminalWorkflow().jobs.verify!.steps
  const core = steps.findIndex((step) => step.run === 'bun run build')
  const shaders = steps.findIndex((step) => step.name === 'Verify compiled shader extension')
  const verify = steps.findIndex((step) => step.run === 'bun run verify')
  expect(core).toBeGreaterThanOrEqual(0)
  expect(shaders).toBeGreaterThan(core)
  expect(verify).toBeGreaterThan(shaders)
  expect(steps[core]?.if).toBeUndefined()
  expect(steps[shaders]?.if).toBeUndefined()
  expect(steps[shaders]?.run).toBe(
    'bun run --cwd packages/shaders verify && bun run --cwd packages/shaders test:browser',
  )
})
