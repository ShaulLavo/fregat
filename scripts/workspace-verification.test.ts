import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function selectedLibraries(files: readonly string[], event = 'pull_request') {
  const ci = readWorkflow('ci.yml')
  const filter = ci.jobs.changes!.steps.find((step) => step.id === 'filter')!
  expect(filter.with?.['predicate-quantifier']).toBe('some-with-excludes')
  const rules = v.parse(
    v.record(v.string(), v.unknown()),
    Bun.YAML.parse(String(filter.with?.filters)),
  )
  const outputs = Object.fromEntries(
    ['editor', 'ghostty', 'hotkeys', 'library_tools'].map((key) => {
      const patterns = v.parse(v.array(v.string()), rules[key])
      const included = patterns.filter((pattern) => !pattern.startsWith('!'))
      const excluded = patterns
        .filter((pattern) => pattern.startsWith('!'))
        .map((pattern) => pattern.slice(1))
      const matches = files.some(
        (file) =>
          included.some((pattern) => new Bun.Glob(pattern).match(file)) &&
          !excluded.some((pattern) => new Bun.Glob(pattern).match(file)),
      )
      return [key, String(matches)]
    }),
  )
  const github = { event_name: event }
  const changes = Object.fromEntries(
    ['editor', 'ghostty', 'hotkeys'].map((key) => [
      key,
      String(
        expression(ci.jobs.changes!.outputs![key]!, { github, steps: { filter: { outputs } } }),
      ),
    ]),
  )
  const needs = { changes: { outputs: changes } }
  if (!expression(ci.jobs.libraries!.if!, { needs })) return { jobs: [], families: [] }
  const inputs = Object.fromEntries(
    Object.entries(ci.jobs.libraries!.with!).map(([key, value]) => [
      key,
      expression(String(value), { needs }),
    ]),
  )
  const libraries = readWorkflow('workspace-libraries.yml')
  const context = { github, inputs, cancelled: () => false }
  const jobs = Object.keys(libraries.jobs).filter((key) =>
    expression(libraries.jobs[key]!.if!, context),
  )
  const families = libraries.jobs
    .standalone!.steps.filter((step) => step.with?.family && expression(step.if!, context))
    .map((step) => step.with!.family)
  return { jobs, families }
}

test.each([
  'apps/server/src/index.ts',
  'apps/web/src/main.tsx',
  'apps/tui/src/main.tsx',
  'packages/contracts/src/index.ts',
  'docs/development.md',
  'README.md',
])('%s does not consume library runners', (file) => {
  expect(selectedLibraries([file])).toEqual({ jobs: [], families: [] })
})

test.each([
  ['editor/packages/editor/src/editor.ts', ['editor', 'standalone'], ['editor']],
  ['ghostty-webgpu/src/index.ts', ['ghostty', 'standalone'], ['ghostty-webgpu']],
  ['hotkeys/packages/hotkeys/src/index.ts', ['standalone'], ['hotkeys']],
])('a family change selects its consumers: %s', (file, jobs, families) => {
  expect(selectedLibraries([String(file)])).toEqual({ jobs, families })
})

test.each([
  'package.json',
  'bun.lock',
  'turbo.json',
  'patches/vitest.patch',
  'scripts/browser-test-responses.ts',
  '.github/actions/setup/action.yml',
  '.github/workflows/workspace-libraries.yml',
])('shared input %s invalidates all libraries', (file) => {
  expect(selectedLibraries([file])).toEqual({
    jobs: ['editor', 'ghostty', 'standalone'],
    families: ['editor', 'ghostty-webgpu', 'hotkeys'],
  })
})

test('every root Turbo global dependency invalidates the library jobs', () => {
  const turbo = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'))
  const dependencies = v.parse(v.array(v.string()), turbo.globalDependencies)
  for (const dependency of dependencies) {
    const file = dependency.replaceAll('**', 'fixture').replaceAll('*', 'fixture')
    expect(selectedLibraries([file]).jobs, file).toContain('editor')
    expect(selectedLibraries([file]).jobs, file).toContain('ghostty')
  }
})

test.each(['push', 'workflow_dispatch'])('%s keeps full library validation', (event) => {
  expect(selectedLibraries([], event)).toEqual({
    jobs: ['editor', 'ghostty', 'standalone'],
    families: ['editor', 'ghostty-webgpu', 'hotkeys'],
  })
})

test('a rename between families invalidates both graphs', () => {
  expect(
    selectedLibraries(['editor/packages/editor/removed.ts', 'ghostty-webgpu/src/added.ts']),
  ).toEqual({ jobs: ['editor', 'ghostty', 'standalone'], families: ['editor', 'ghostty-webgpu'] })
})

test('manual shard experiments keep the PR and main default at four', () => {
  const ci = readWorkflow('ci.yml')
  const source = ci.jobs.changes!.outputs!.web_shards!
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
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
    const producer = steps.find((entry) => entry.name === 'Verdict')!
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
  expect(
    steps.find((step) => step.name === 'Install and verify standalone package graph')?.run,
  ).toBe(
    'bun install && bun run build && bun run typecheck && bun run lint && bun run format:check',
  )
})

test('CI verifies the family sites that the Pages workflow deploys', () => {
  const steps = readWorkflow('ci.yml').jobs.site!.steps
  expect(steps.map((step) => step.name)).toContain('Build Editor example')
  expect(steps.map((step) => step.name)).toContain('Build ghostty site')
})

test('canonical Editor CI checks the generated language catalog', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run).join('\n')).toContain(
    'bun run --cwd editor/packages/tree-sitter-languages languages:generate -- --check',
  )
})

test('canonical Editor CI includes architecture health', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.editor!.steps
  expect(steps.map((step) => step.run)).toContain('bun run --cwd editor health')
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

test('automatic bump branches include the matched Markdown source', () => {
  const steps = readWorkflow('editor-tree-sitter-x.yml').jobs.update!.steps
  const branch = steps.find((step) => step.name === 'Open a pull request')
  expect(branch?.run).toContain('branch="tree-sitter-x/$pin-$markdown"')
})

test('canonical ghostty CI verifies the separate line editor package', () => {
  const steps = readWorkflow('workspace-libraries.yml').jobs.ghostty!.steps
  expect(steps.map((step) => step.run)).toContain('bun run --cwd ghostty-webgpu-line-editor verify')
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(root.workspaces.packages).toContain('ghostty-webgpu-line-editor')
  expect(root.scripts['build:workspaces']).toContain('--filter=ghostty-webgpu-line-editor')
})

test('the provisional line editor workspace is private until publication is authorized', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../ghostty-webgpu-line-editor/package.json', import.meta.url), 'utf8'),
  )
  expect(manifest.private).toBe(true)
})
