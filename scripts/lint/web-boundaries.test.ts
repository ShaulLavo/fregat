import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from 'vitest'

const REPOSITORY = resolve(import.meta.dirname, '../..')
const RULE_PREFIX = 'platform-boundaries('

type Probe = {
  readonly file: string
  readonly source: string
  readonly rules: readonly string[]
  readonly column?: number
}

const probes: readonly Probe[] = [
  {
    file: 'apps/web/src/lib/alias.ts',
    source: "import { value } from '@/features/example/value'; export { value }",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/relative.ts',
    source: "import { value } from '../features/example/value'; export { value }",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/type-only.ts',
    source: "import type { Value } from '@/features/example/value'; export type Result = Value",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/re-export.ts',
    source: "export { value } from '@/features/example/value'",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/export-all.ts',
    source: "export * from '../features/example/value'",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/dynamic.ts',
    source: "import('@/features/example/value')",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/dynamic-template.ts',
    source: 'import(`@/features/example/value`)',
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/require-template.ts',
    source: 'require(`../features/example/value`)',
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/shared-template.ts',
    source: 'import(`@/lib/example/value`)',
    rules: [],
  },
  {
    file: 'apps/web/src/lib/import-type.ts',
    source: "export type Value = import('@/features/example/value').Value",
    rules: ['lib-imports'],
    column: 21,
  },
  {
    file: 'apps/web/src/lib/tests/helper.ts',
    source: "export { value } from '@/features/example/value'",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/import-equals.ts',
    source: "import value = require('@/features/example/value'); export { value }",
    rules: ['lib-imports'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/runtime.ts',
    source: "import { useState } from 'react'; export { useState }",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/store.ts',
    source: "export { store } from '@/lib/environments/state/store'",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/dynamic.ts',
    source: "import('./identity')",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/computed.ts',
    source: "const name = './identity'; import(name)",
    rules: ['document-dependencies'],
    column: 28,
  },
  {
    file: 'apps/web/src/lib/documents/utils/require.ts',
    source: "require('./identity')",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/import-equals.ts',
    source: "import value = require('./identity'); export { value }",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/contract-runtime.ts',
    source: "export { executable } from '@workspace/contracts'",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/features/editor/utils/classifier.ts',
    source: "export const prefix = 'git-ref:'",
    rules: ['document-codecs'],
    column: 23,
  },
  {
    file: 'apps/web/src/features/editor/utils/regex-classifier.ts',
    source: 'export const pattern = /^git-ref:/',
    rules: ['document-codecs'],
    column: 24,
  },
  {
    file: 'apps/web/src/lib/path-formatters.ts',
    source: "export { value } from '@/features/example/value'",
    rules: ['lib-imports', 'document-dependencies'],
  },
  {
    file: 'packages/client-core/src/files/path.ts',
    source: "export { useState } from 'react'",
    rules: ['document-dependencies'],
  },
  {
    file: 'apps/web/src/lib/documents/utils/identity.ts',
    source: "import type { Value } from '@workspace/contracts'; export type Identity = Value",
    rules: [],
  },
  {
    file: 'apps/web/src/lib/documents/utils/codec.ts',
    source:
      "import { sessionIdSchema } from '@workspace/contracts'; export const prefix = 'git-ref:'; export { sessionIdSchema }",
    rules: [],
  },
  {
    file: 'apps/web/src/lib/documents/utils/shared.ts',
    source: "export { value } from '@/lib/path-formatters'",
    rules: [],
  },
  {
    file: 'apps/web/src/lib/documents/utils/contract-type.ts',
    source: "export type Value = import('@workspace/contracts').Value",
    rules: [],
  },
  {
    file: 'apps/web/src/features/editor/utils/consumer.ts',
    source: "export type { Identity } from '@/lib/documents/utils/identity'",
    rules: [],
  },
  {
    file: 'apps/web/src/lib/tests/integration.test.ts',
    source: "export { value } from '@/features/example/value'; export const id = 'git-ref:test'",
    rules: [],
  },
  {
    file: 'apps/web/src/lib/documents/tests/contracts.test-d.ts',
    source: "export { save } from '@/features/editor/state/save-service'",
    rules: [],
  },
  {
    file: 'apps/web/src/features/settings/container-classes.ts',
    source: "export const className = 'flex @max-3xl/settings:grid @3xl/settings:gap-2'",
    rules: [],
  },
  {
    file: 'apps/web/src/features/settings/invalid-mixed-prefix.ts',
    column: 22,
    source: "export const value = '@max-3xl/settings:grid settings:'",
    rules: ['document-codecs'],
  },
  {
    file: 'apps/web/test/factories/documents.ts',
    source: "export const id = 'git-ref:test'",
    rules: [],
  },
]

test('the configured CLI rejects shared imports of features at their source and accepts controls', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'platform-web-boundaries-'))
  try {
    await installFixture(fixture)
    const process = Bun.spawn(
      [
        Bun.which('bun') ?? 'bun',
        join(REPOSITORY, 'node_modules/oxlint/bin/oxlint'),
        '--config',
        join(fixture, '.oxlintrc.json'),
        '--format',
        'json',
        ...probes.map((probe) => probe.file),
      ],
      { cwd: fixture, stderr: 'pipe', stdout: 'pipe' },
    )
    const [exitCode, output, errors] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    expect(errors).toBe('')
    expect(exitCode).toBe(1)
    const diagnostics = readDiagnostics(output).filter((entry) =>
      entry.code.startsWith(RULE_PREFIX),
    )
    for (const probe of probes) assertProbe(probe, diagnostics)
  } finally {
    await rm(fixture, { force: true, recursive: true })
  }
})

async function installFixture(fixture: string): Promise<void> {
  await mkdir(join(fixture, 'scripts/lint'), { recursive: true })
  await copyFile(join(REPOSITORY, '.oxlintrc.json'), join(fixture, '.oxlintrc.json'))
  await copyFile(
    join(REPOSITORY, 'scripts/lint/web-boundaries.mjs'),
    join(fixture, 'scripts/lint/web-boundaries.mjs'),
  )
  await symlink(join(REPOSITORY, 'node_modules'), join(fixture, 'node_modules'), 'dir')
  await Promise.all(
    probes.map(async (probe) => {
      const file = join(fixture, probe.file)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${probe.source}\n`)
    }),
  )
}

type Diagnostic = {
  readonly code: string
  readonly filename: string
  readonly line: number
  readonly column: number
  readonly severity: string
}

function readDiagnostics(output: string): readonly Diagnostic[] {
  const report: unknown = JSON.parse(output)
  if (
    !report ||
    typeof report !== 'object' ||
    !('diagnostics' in report) ||
    !Array.isArray(report.diagnostics)
  ) {
    throw new TypeError('Oxlint did not return a diagnostic array')
  }
  return report.diagnostics.map(readDiagnostic)
}

function readDiagnostic(value: unknown): Diagnostic {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid Oxlint diagnostic')
  if (!('code' in value) || typeof value.code !== 'string')
    throw new TypeError('Missing diagnostic code')
  if (!('filename' in value) || typeof value.filename !== 'string')
    throw new TypeError('Missing diagnostic filename')
  if (!('severity' in value) || typeof value.severity !== 'string')
    throw new TypeError('Missing diagnostic severity')
  if (!('labels' in value) || !Array.isArray(value.labels))
    throw new TypeError('Missing diagnostic labels')
  const label: unknown = value.labels[0]
  if (!label || typeof label !== 'object' || !('span' in label))
    throw new TypeError('Missing diagnostic span')
  const span = label.span
  if (!span || typeof span !== 'object') throw new TypeError('Invalid diagnostic span')
  if (!('line' in span) || typeof span.line !== 'number')
    throw new TypeError('Missing diagnostic line')
  if (!('column' in span) || typeof span.column !== 'number')
    throw new TypeError('Missing diagnostic column')
  return {
    code: value.code,
    filename: value.filename,
    line: span.line,
    column: span.column,
    severity: value.severity,
  }
}

function assertProbe(probe: Probe, diagnostics: readonly Diagnostic[]): void {
  const actual = diagnostics.filter((entry) => entry.filename === probe.file)
  expect(actual.map((entry) => entry.code).toSorted(), probe.file).toEqual(
    probe.rules.map((rule) => `${RULE_PREFIX}${rule})`).toSorted(),
  )
  for (const entry of actual) {
    expect(entry.severity, probe.file).toBe('error')
    expect(entry.line, probe.file).toBe(1)
    expect(entry.column, probe.file).toBe(probe.column ?? 1)
  }
}
