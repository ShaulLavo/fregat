import { expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('setup builds have a single early producer and required fail-closed imports', async () => {
  const producer = workflow.jobs['workspace-builds']
  expect(producer).toBeDefined()
  expect(producer.needs).toBe('changes')
  expect(producer.if).toBe("${{ needs.changes.outputs.code == 'true' }}")
  expect(
    producer.steps.find((step) => step.uses === './.github/actions/setup').with['build-packages'],
  ).toBe('[]')
  expect(
    producer.steps.filter((step) => step.uses === './.github/actions/workspace-builds'),
  ).toHaveLength(1)
  expect(workflow.jobs.verdict.needs).toContain('workspace-builds')
  for (const name of [
    'typecheck',
    'test-web',
    'test-server',
    'test-tui',
    'browser',
    'site',
    'libraries',
  ]) {
    const job = workflow.jobs[name]
    expect(job.needs).toEqual(['changes', 'workspace-builds'])
    expect(job.needs).not.toContain('typecheck')
    expect(job.if).not.toContain('always()')
    if (name === 'libraries') continue
    expect(
      job.steps.find((step) => step.uses === './.github/actions/setup').with['build-packages'],
    ).toBe('[]')
    const imported = job.steps.find((step) => step.uses === './.github/actions/workspace-builds')
    expect(imported.id).toBe('builds')
    expect(imported.with.operation).toBe('consume')
    for (const step of job.steps.filter((step) => step.run && step.if?.includes('!cancelled()'))) {
      expect(step.if).toContain("steps.builds.outputs.ready == 'true'")
    }
  }
  expect(workflow.jobs.lint.needs).toBe('changes')
  expect(workflow.jobs.docs.needs).toBe('changes')
  expect(workflow.jobs['mobile-layout'].needs).toEqual(['changes', 'site'])
})

test('reusable library workflows keep direct defaults and import only for the CI opt-in', async () => {
  const libraries = YAML.parse(
    await readFile(new URL('.github/workflows/workspace-libraries.yml', root), 'utf8'),
  )
  expect(libraries.on.workflow_call.inputs.reuse_builds).toEqual({
    type: 'boolean',
    default: false,
  })
  expect(workflow.jobs.libraries.with.reuse_builds).toBe(
    "${{ needs.changes.outputs.code == 'true' }}",
  )
  for (const name of ['editor', 'ghostty']) {
    const job = libraries.jobs[name]
    const setup = job.steps.find((step) => step.uses === './.github/actions/setup')
    expect(setup.with['build-packages']).toContain("inputs.reuse_builds && '[]'")
    const imported = job.steps.find((step) => step.uses === './.github/actions/workspace-builds')
    expect(imported.if).toBe('${{ inputs.reuse_builds }}')
    expect(imported.with.operation).toBe('consume')
  }
  expect(
    libraries.jobs.standalone.steps.some(
      (step) => step.uses === './.github/actions/workspace-builds',
    ),
  ).toBe(false)
})

test('transport is same-run and immutable, with only local build tasks persisted', async () => {
  const action = YAML.parse(
    await readFile(new URL('.github/actions/workspace-builds/action.yml', root), 'utf8'),
  )
  const steps = action.runs.steps
  const download = steps.find((step) => step.uses === 'actions/download-artifact@v4')
  expect(download.with).toEqual({
    pattern: '${{ steps.plan.outputs.pattern }}',
    path: '${{ steps.plan.outputs.directory }}/downloads',
    'merge-multiple': false,
  })
  const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4')
  expect(upload.with).toMatchObject({
    'if-no-files-found': 'error',
    overwrite: false,
    'include-hidden-files': true,
  })
  for (const step of steps.filter((step) => step.uses?.startsWith('actions/cache/'))) {
    expect(step.with.path).toBe('.turbo/ci-builds')
    expect(step.if).toContain("inputs.operation == 'produce'")
  }
  expect(steps.every((step) => step['continue-on-error'] !== true)).toBe(true)
  expect(JSON.stringify(action)).not.toMatch(
    /github-token|repository:|run-id:|GH_TOKEN|GITHUB_TOKEN|secrets\.|TURBO_TOKEN/,
  )
  expect(steps.find((step) => step.name === 'Remove workspace transfer files').if).toContain(
    'always()',
  )
  const helper = await readFile(new URL('scripts/ci/build-reuse.mjs', root), 'utf8')
  expect(helper).toContain("'--cache=local:rw'")
  expect(helper).toContain("['run', 'build'")
  const site = await readFile(new URL('scripts/product-sites/build.sh', root), 'utf8')
  expect(site).toContain(
    '--reuse-workspace-builds) bun scripts/ci/build-reuse.mjs verify-site "$json"',
  )
})
