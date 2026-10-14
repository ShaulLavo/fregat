import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MARKDOWN_CASES, BASELINE_DEFECTS } from '../../packages/markdown/test/fixtures/cases'
import {
  checkExpectations,
  observeHast,
  renderRemark,
} from '../../packages/markdown/test/qualification'
import commonmark from '../../packages/markdown/test/reference/commonmark.json'
import gfm from '../../packages/markdown/test/reference/gfm.json'
import differences from '../../packages/markdown/test/reference/gfm-differences.json'
import { expectedOutput, referenceOutput } from '../../packages/markdown/test/reference/oracle'

export type CheckRow = {
  readonly suite: string
  readonly fixture: string
  readonly checkpoint?: string
  readonly status: 'passed' | 'failed' | 'documented-difference'
  readonly findings: readonly string[]
}

export function baselineRows(): readonly CheckRow[] {
  return MARKDOWN_CASES.flatMap(caseRows).concat(referenceRows('commonmark'), referenceRows('gfm'))
}

function caseRows(fixture: (typeof MARKDOWN_CASES)[number]): CheckRow[] {
  const complete = observeHast(renderRemark(fixture.source, false))
  const rows = [row('completed', fixture.id, checkExpectations(complete, fixture.expected))]
  for (const checkpoint of fixture.checkpoints) {
    const observed = observeHast(
      renderRemark(fixture.source.slice(0, checkpoint.offset), checkpoint.live),
    )
    const findings = checkExpectations(observed, checkpoint.expected)
    for (const value of checkpoint.textIncludes ?? []) {
      if (!observed.text.includes(value)) findings.push('Required text is missing at this prefix.')
    }
    for (const value of checkpoint.textExcludes ?? []) {
      if (observed.text.includes(value)) findings.push('Held syntax reached the visible text.')
    }
    rows.push({ ...row('streaming', fixture.id, findings), checkpoint: checkpoint.name })
  }
  return rows
}

function referenceRows(profile: 'commonmark' | 'gfm'): CheckRow[] {
  const examples = profile === 'commonmark' ? commonmark : gfm
  return examples.map((example) => {
    const actual = referenceOutput(example.source, profile)
    const expected = expectedOutput(example.html)
    if (JSON.stringify(actual) === JSON.stringify(expected)) return row(profile, example.id, [])
    const known = differences.find((difference) => difference.id === example.id)
    if (
      known &&
      digest(actual) === known.actualSha256 &&
      digest(expected) === known.expectedSha256
    ) {
      return {
        suite: profile,
        fixture: example.id,
        status: 'documented-difference',
        findings: [known.reason],
      }
    }
    return row(profile, example.id, ['Rendered semantics differ from the official example.'])
  })
}

function row(suite: string, fixture: string, findings: readonly string[]): CheckRow {
  return { suite, fixture, findings, status: findings.length > 0 ? 'failed' : 'passed' }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function inspectCandidate(root: string) {
  const require = createRequire(path.join(root, 'editor/packages/tree-sitter/package.json'))
  const packageFile = require.resolve('tree-sitter-md/package.json')
  const metadata: { readonly version: string } = JSON.parse(await readFile(packageFile, 'utf8'))
  const module = await import(pathToFileURL(require.resolve('tree-sitter-md')).href)
  const methods = Object.getOwnPropertyNames(module.MarkdownDocument.prototype).filter(
    (name) => name !== 'constructor',
  )
  return {
    engine: 'tree-sitter-md',
    version: metadata.version,
    methods,
    status: 'unavailable' as const,
    reason: 'The current package has compact editor records and no chat renderer semantic adapter.',
    missing: [
      'decoded renderer semantics',
      'resolved link/image targets and titles',
      'list metadata',
      'full table semantics',
      'chat extensions',
      'paired browser and performance evidence',
    ],
  }
}

export function promotionVerdict(rows: readonly CheckRow[], executedBrowser: boolean) {
  const failed = rows.filter((result) => result.status === 'failed')
  return {
    verdict: 'NOT VERIFIED' as const,
    reasons: [
      'Candidate renderer semantics and paired measurements are unavailable.',
      'Independent held-out evaluation has not been frozen or executed.',
    ].concat(
      failed.length > 0 ? ['The baseline has failed independently authored expectations.'] : [],
      executedBrowser ? [] : ['Browser suites have not been executed in this report.'],
    ),
    baselineDefects: BASELINE_DEFECTS,
    counts: {
      executed: rows.length,
      passed: rows.filter((result) => result.status === 'passed').length,
      failed: failed.length,
      documentedDifferences: rows.filter((result) => result.status === 'documented-difference')
        .length,
    },
  }
}
