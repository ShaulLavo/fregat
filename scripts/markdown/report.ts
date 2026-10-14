import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as v from 'valibot'
import { errorMessage } from '../../packages/contracts/src/error-fields'
import { createScriptError } from '../structured-errors'
import type { PromotionResult } from './promotion'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
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

export type CandidateArtifact = {
  readonly kind: 'grammar' | 'resolver' | 'binding' | 'semantic-binding' | 'runtime'
  readonly file: string
  readonly bytes: number
  readonly sha256: string
}
export type CandidateInspection = {
  readonly engine: 'tree-sitter-md'
  readonly status: 'available-unqualified' | 'unavailable'
  readonly version: string | null
  readonly methods: readonly string[]
  readonly artifacts: readonly CandidateArtifact[]
  readonly profile: string | null
  readonly declaredCapabilities: Readonly<Record<string, boolean>> | null
  readonly observedCapabilities: Readonly<Record<string, boolean>>
  readonly semanticChecks: {
    readonly executed: number
    readonly passed: number
    readonly failed: number
    readonly findings: readonly string[]
  }
  readonly reason: string
  readonly missing: readonly string[]
}
export type CandidateInspectionOptions = { readonly grammar?: string; readonly resolver?: string }
const snapshotSchema = v.object({
  profile: v.picklist(['commonmark', 'gfm', 'fregat-chat']),
  capabilities: v.object({
    commonmark: v.boolean(),
    gfm: v.boolean(),
    math: v.boolean(),
    cjk: v.boolean(),
    footnotes: v.boolean(),
  }),
  root: v.object({ type: v.literal('root'), children: v.array(v.unknown()) }),
})
const metadataSchema = v.object({ version: v.pipe(v.string(), v.minLength(1)) })
const PROBE_SOURCE = [
  '# Probe **bold**',
  '',
  '3. ordered',
  '',
  '~~strike~~',
  '',
  '| A | B |',
  '| --- | ---: |',
  '| value | 7 |',
  '',
  '[label](https://example.test/probe "title")',
  '',
  '![decoded &amp; alt](https://example.test/image "image")',
  '',
  '$$',
  'x+1',
  '$$',
  '',
  '中文**强**中文',
  '',
  'footnote[^probe-note]',
  '',
  '[^probe-note]: note',
  '',
].join('\n')

export async function inspectCandidate(
  root: string,
  options: CandidateInspectionOptions = {},
): Promise<CandidateInspection> {
  let version: string | null = null
  let methods: string[] = []
  const artifacts: CandidateArtifact[] = []
  try {
    const require = createRequire(path.join(root, 'packages/markdown/package.json'))
    const packageFile = require.resolve('tree-sitter-md/package.json')
    version = v.parse(metadataSchema, JSON.parse(await readFile(packageFile, 'utf8'))).version
    const binding = require.resolve('tree-sitter-md')
    const files = {
      grammar: options.grammar
        ? path.resolve(root, options.grammar)
        : require.resolve('tree-sitter-md/tree-sitter-markdown.wasm'),
      resolver: options.resolver
        ? path.resolve(root, options.resolver)
        : require.resolve('tree-sitter-md/tree-sitter-md.wasm'),
      binding,
      'semantic-binding': path.join(path.dirname(binding), 'semantic.js'),
      runtime: require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    }
    const bytes = new Map<CandidateArtifact['kind'], Uint8Array>()
    for (const kind of ['grammar', 'resolver', 'binding', 'semantic-binding', 'runtime'] as const) {
      const data = await readFile(files[kind])
      if (kind === 'grammar' || kind === 'resolver' || kind === 'runtime') validateWasm(data, kind)
      artifacts.push({
        kind,
        file: path.relative(root, files[kind]),
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      })
      bytes.set(kind, data)
    }
    const loaded: unknown = await import(pathToFileURL(binding).href)
    const module = runtimeObject(loaded)
    const constructor: unknown = Reflect.get(module, 'MarkdownDocument')
    if (typeof constructor !== 'function')
      throw createScriptError('Candidate document constructor is unavailable.', {
        internal: { export: 'MarkdownDocument' },
      })
    const prototype = runtimeObject(Reflect.get(constructor, 'prototype'))
    methods = Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor')
    runtimeMethod(prototype, 'dispose')
    runtimeMethod(prototype, 'semantics')
    await runtimeCall(module, 'init', [
      { grammar: bytes.get('grammar'), resolver: bytes.get('resolver') },
    ])
    const document = runtimeObject(
      Reflect.construct(constructor, [{ gfm: true, frontmatter: false, cjk: true, math: true }]),
    )
    let snapshot: v.InferOutput<typeof snapshotSchema>
    try {
      runtimeCall(document, 'setText', [PROBE_SOURCE])
      snapshot = v.parse(snapshotSchema, runtimeCall(document, 'semantics', []))
    } finally {
      runtimeCall(document, 'dispose', [])
    }
    const nativeChecks = probeChecks(snapshot.root.children)
    const adapterChecks = await inspectAdapter(root, files.runtime, bytes)
    const checks = Object.entries(nativeChecks).map(([name, passed]) => ({
      name,
      passed: passed && adapterChecks[name] === true,
    }))
    const failed = checks.filter((check) => !check.passed)
    const declared = snapshot.capabilities
    const observedCapabilities = {
      commonmark: declared.commonmark && nativeChecks.commonmark && adapterChecks.commonmark,
      gfm: declared.gfm && nativeChecks.gfm && adapterChecks.gfm,
      math: declared.math && nativeChecks.math && adapterChecks.math,
      footnotes: declared.footnotes && nativeChecks.footnotes && adapterChecks.footnotes,
      cjkFlanking: declared.cjk && nativeChecks.cjkFlanking && adapterChecks.cjkFlanking,
    }
    return {
      engine: 'tree-sitter-md',
      status: 'available-unqualified',
      version,
      methods,
      artifacts,
      profile: snapshot.profile,
      declaredCapabilities: declared,
      observedCapabilities,
      semanticChecks: {
        executed: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        findings: failed.map((check) => `Candidate probe does not satisfy ${check.name}.`),
      },
      reason:
        'The native semantic API and renderer adapter execute. Qualification depends on complete observed gate receipts.',
      missing: failed.map((check) => check.name).concat(['complete promotion receipts']),
    }
  } catch (failure) {
    return {
      engine: 'tree-sitter-md',
      status: 'unavailable',
      version,
      methods,
      artifacts,
      profile: null,
      declaredCapabilities: null,
      observedCapabilities: {},
      semanticChecks: { executed: 0, passed: 0, failed: 0, findings: [errorMessage(failure)] },
      reason: 'Candidate artifact initialization or semantic inspection failed.',
      missing: [
        'executed native semantic snapshot',
        'executed renderer adapter',
        'complete promotion receipts',
      ],
    }
  }
}

async function inspectAdapter(
  root: string,
  runtime: string,
  bytes: ReadonlyMap<CandidateArtifact['kind'], Uint8Array>,
) {
  const loaded: unknown = await import(
    pathToFileURL(path.join(root, 'packages/markdown/src/utils/tree-sitter-session.ts')).href
  )
  const adapter = runtimeObject(loaded)
  await runtimeCall(adapter, 'initializeTreeSitterMarkdown', [
    {
      parser: { locateFile: () => runtime },
      grammar: bytes.get('grammar'),
      resolver: bytes.get('resolver'),
    },
  ])
  const session = runtimeObject(runtimeCall(adapter, 'createTreeSitterMarkdownSession', []))
  try {
    const blocks = v.parse(
      v.array(v.object({ nodes: v.array(v.unknown()) })),
      runtimeCall(session, 'update', [PROBE_SOURCE, { heal: false }]),
    )
    return probeChecks(blocks.flatMap((block) => block.nodes))
  } finally {
    try {
      runtimeCall(session, 'update', ['', { heal: false }])
    } finally {
      const dispose: unknown = Reflect.get(session, 'dispose')
      if (typeof dispose === 'function') Reflect.apply(dispose, session, [])
    }
  }
}

function probeChecks(roots: readonly unknown[]): Record<string, boolean> {
  const nodes: object[] = []
  for (const root of roots) collectSemanticNodes(root, nodes)
  const matches = (type: string) => nodes.filter((node) => Reflect.get(node, 'type') === type)
  return {
    commonmark:
      matches('heading').some((node) => Reflect.get(node, 'depth') === 1) &&
      matches('strong').some((node) => semanticText(node) === 'bold'),
    gfm:
      matches('delete').some((node) => semanticText(node) === 'strike') &&
      matches('table').some((node) => {
        const align: unknown = Reflect.get(node, 'align')
        return Array.isArray(align) && align.length === 2 && align[1] === 'right'
      }),
    math: matches('math').some((node) => Reflect.get(node, 'value') === 'x+1'),
    cjkFlanking: matches('strong').some((node) => semanticText(node) === '强'),
    footnotes:
      matches('footnoteReference').some(
        (node) => Reflect.get(node, 'identifier') === 'probe-note',
      ) &&
      matches('footnoteDefinition').some(
        (node) => Reflect.get(node, 'identifier') === 'probe-note',
      ),
    decodedLink: matches('link').some(
      (node) =>
        Reflect.get(node, 'url') === 'https://example.test/probe' &&
        Reflect.get(node, 'title') === 'title',
    ),
    decodedImage: matches('image').some(
      (node) =>
        Reflect.get(node, 'alt') === 'decoded & alt' && Reflect.get(node, 'title') === 'image',
    ),
    listMetadata: matches('list').some(
      (node) => Reflect.get(node, 'ordered') === true && Reflect.get(node, 'start') === 3,
    ),
  }
}

function collectSemanticNodes(value: unknown, out: object[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  out.push(value)
  for (const key of ['children', 'items', 'rows', 'cells']) {
    const children: unknown = Reflect.get(value, key)
    if (!Array.isArray(children)) continue
    for (const child of children) collectSemanticNodes(child, out)
  }
}
function semanticText(value: object): string {
  const text: unknown = Reflect.get(value, 'value')
  if (typeof text === 'string') return text
  const children: unknown = Reflect.get(value, 'children')
  if (!Array.isArray(children)) return ''
  return children
    .map((child: unknown) => (child && typeof child === 'object' ? semanticText(child) : ''))
    .join('')
}
function runtimeObject(value: unknown): object {
  if (value && typeof value === 'object') return value
  throw createScriptError('Candidate API returned an invalid object.', {
    internal: { observedType: typeof value },
  })
}
function runtimeMethod(value: object, name: string): Function {
  const method: unknown = Reflect.get(value, name)
  if (typeof method === 'function') return method
  throw createScriptError('Candidate API method is unavailable.', { internal: { method: name } })
}
function runtimeCall(value: object, name: string, args: readonly unknown[]): unknown {
  return Reflect.apply(runtimeMethod(value, name), value, args)
}
function validateWasm(bytes: Uint8Array, kind: string) {
  if (
    !(
      bytes.length >= 8 &&
      bytes[0] === 0 &&
      bytes[1] === 97 &&
      bytes[2] === 115 &&
      bytes[3] === 109 &&
      bytes[4] === 1 &&
      bytes[5] === 0 &&
      bytes[6] === 0 &&
      bytes[7] === 0
    )
  )
    throw createScriptError('Candidate artifact is an invalid WebAssembly module.', {
      internal: { artifactKind: kind, byteCount: bytes.length },
    })
  const names = new Set(
    WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(bytes)))
      .filter((entry) => entry.kind === 'function')
      .map((entry) => entry.name),
  )
  const required =
    kind === 'grammar'
      ? ['tree_sitter_markdown']
      : kind === 'resolver'
        ? ['tsmd_new', 'tsmd_free', 'tsmd_semantics', 'tsmd_semantic_out', 'tsmd_semantic_release']
        : ['ts_parser_new']
  if (required.some((name) => !names.has(name)))
    throw createScriptError('Candidate artifact lacks required parser exports.', {
      internal: { artifactKind: kind, requiredExportCount: required.length },
    })
}

export function promotionVerdict(
  rows: readonly CheckRow[],
  executedBrowser: boolean,
  proof?: {
    readonly candidate: CandidateInspection
    readonly promotion: PromotionResult
    readonly executionFailures?: readonly string[]
  },
) {
  const failed = rows.filter((result) => result.status === 'failed')
  const reasons = proof
    ? proof.promotion.findings.concat(proof.promotion.gates.flatMap((gate) => gate.findings))
    : ['Trusted candidate promotion receipts have not been supplied.']
  if (proof?.candidate.status === 'unavailable')
    reasons.push('The actual candidate semantic API or renderer adapter is unavailable.')
  if (proof && proof.candidate.semanticChecks.failed > 0)
    reasons.push('The candidate fails an observed capability probe.')
  if (proof?.executionFailures) reasons.push(...proof.executionFailures)
  if (failed.length > 0)
    reasons.push('The baseline has failed independently authored expectations.')
  if (!executedBrowser && !proof)
    reasons.push('Browser suites have not been executed in this report.')
  return {
    verdict:
      proof?.promotion.verdict === 'VERIFIED' && reasons.length === 0 ? 'VERIFIED' : 'NOT VERIFIED',
    reasons,
    counts: {
      executed: rows.length,
      passed: rows.filter((result) => result.status === 'passed').length,
      failed: failed.length,
      documentedDifferences: rows.filter((result) => result.status === 'documented-difference')
        .length,
    },
  }
}
