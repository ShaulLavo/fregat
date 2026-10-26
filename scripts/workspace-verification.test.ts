import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

function expression(source: string, context: Record<string, unknown>) {
  const body = source.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  return new Function(...Object.keys(context), `return (${body})`)(...Object.values(context))
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

test('consumer package checks remain in the blocking aggregate graph', () => {
  const workflow = readWorkflow('ci.yml')
  const checks = workflow.jobs.typecheck!
  expect(checks.needs).toEqual(['changes', 'workspace-builds'])
  expect(checks.steps.find((step) => step.name === 'Package checks')?.run).toBe(
    'bun scripts/ci/packages.mjs checks "$CI_PACKAGES"',
  )
  expect(checks.steps.find((step) => step.name === 'Check generated artifacts')?.run).toBe(
    'bun run generated:check',
  )
  expect(workflow.jobs.verdict!.needs).toContain('typecheck')
  expect(workflow.jobs.verdict!.needs).toContain('workspace-builds')
  expect(workflow.jobs).not.toHaveProperty('libraries')
})
