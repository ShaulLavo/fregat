import { performance } from 'node:perf_hooks'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'

import {
  createEditorTextBuffer,
  createEditorBufferSession,
  type TextEdit,
} from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { createTreeSitterSyntaxProvider, createTreeSitterWorkerOwner } from '../src'
import type { TreeSitterParseResult } from '../src/treeSitter/types'

type WorkerTiming = Pick<TreeSitterParseResult, 'timings'>

type BenchmarkRuntime = ReturnType<typeof createBenchmarkRuntime>

function createBenchmarkRuntime() {
  let lastTiming: WorkerTiming | undefined
  const owner = createTreeSitterWorkerOwner({
    workerFactory: () => {
      const worker = new Worker(
        new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        const timing = parseWorkerTimings(event.data)
        if (timing) lastTiming = timing
      })
      return worker
    },
  })
  const provider = createTreeSitterSyntaxProvider({ workerOwner: owner })
  for (const language of TREE_SITTER_LANGUAGE_CONTRIBUTIONS) provider.registerLanguage(language)
  return { owner, provider, timing: () => lastTiming }
}

function parseWorkerTimings(response: unknown): WorkerTiming | undefined {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('result' in response)
  )
    return
  const result = response.result
  if (
    !result ||
    typeof result !== 'object' ||
    !('timings' in result) ||
    !Array.isArray(result.timings)
  )
    return
  const timings: TreeSitterParseResult['timings'][number][] = []
  for (const item of result.timings) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('durationMs' in item) ||
      typeof item.durationMs !== 'number'
    )
      return
    timings.push({ name: item.name, durationMs: item.durationMs })
  }
  return { timings }
}

function openAnalysis(
  runtime: BenchmarkRuntime,
  text: string,
  documentId: string,
  languageId: string,
) {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId })
  const session = analysis.borrowStructural({
    provider: runtime.provider,
    languageId,
    includeCaptures: true,
  })
  if (!session) throw new TypeError('The syntax benchmark requires its registered operation')
  return { buffer, view, analysis, session }
}

declare const Bun: { gc?: (force?: boolean) => void } | undefined

type MemorySample = {
  readonly heapUsedMb: number
  readonly heapTotalMb: number
  readonly rssMb: number
}

type SyntaxSample = {
  readonly lines: number
  readonly textLength: number
  readonly initialTotalMs: number
  readonly initialParseMs: number
  readonly initialQueryMs: number
  readonly editTotalMs: number
  readonly editParseMs: number
  readonly editQueryMs: number
  readonly captures: number
  readonly folds: number
  readonly memoryAfterParse: MemorySample
  readonly memoryAfterEdit: MemorySample
  readonly memoryAfterGc: MemorySample
  readonly forcedGcAvailable: boolean
}

type InjectionEditSample = {
  readonly fences: number
  readonly textLength: number
  readonly injections: number
  readonly initialParseMs: number
  readonly editTotalMs: number
  readonly editParseMs: number
  readonly baselineDelta: number
}

const LINE_COUNTS = [10_000, 50_000, 100_000] as const
const MARKDOWN_FENCE_COUNT = 200

const formatMs = (value: number): string => `${value.toFixed(2)}ms`
const toMb = (bytes: number): number => bytes / 1024 / 1024

const readMemory = (): MemorySample => {
  const usage = process.memoryUsage()
  return {
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    rssMb: toMb(usage.rss),
  }
}

const forceGc = (): boolean => {
  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
    Bun.gc(true)
    return true
  }

  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
    return true
  }

  return false
}

const timing = (result: Pick<TreeSitterParseResult, 'timings'> | undefined, name: string): number =>
  result?.timings.find((item) => item.name === name)?.durationMs ?? Number.NaN

const buildText = (lines: number): string => {
  const chunks: string[] = []

  for (let line = 0; line < lines; line += 10) {
    chunks.push(`export function value${line}() {\n`)
    chunks.push('  const item = {\n')
    chunks.push(`    line: ${line},\n`)
    chunks.push(`    label: "line-${line}",\n`)
    chunks.push('  };\n')
    chunks.push('  if (item.line % 2 === 0) {\n')
    chunks.push('    return item.label;\n')
    chunks.push('  }\n')
    chunks.push('  return String(item.line);\n')
    chunks.push('}\n')
  }

  return chunks.join('')
}

const buildMarkdownWithFences = (fences: number): string => {
  const chunks = ['# Injection benchmark\n\n']
  for (let index = 0; index < fences; index += 1) {
    chunks.push('```html\n')
    chunks.push(`<main><script>const value${index} = ${index};</script></main>\n`)
    chunks.push('```\n\n')
  }

  return chunks.join('')
}

const editForLength = (length: number): TextEdit => {
  const midpoint = Math.floor(length / 2)
  return { from: midpoint, to: midpoint, text: '/* syntax-bench */' }
}

const measureSyntax = async (runtime: BenchmarkRuntime, lines: number): Promise<SyntaxSample> => {
  const text = buildText(lines)
  const { buffer, view, analysis, session } = openAnalysis(
    runtime,
    text,
    `bench-${lines}.ts`,
    'typescript',
  )
  try {
    const parseStart = performance.now()
    await session.refresh(buffer.getTextSnapshot())
    const initialTotalMs = performance.now() - parseStart
    const initialTimings = runtime.timing()
    const memoryAfterParse = readMemory()
    view.applyEdits([editForLength(buffer.getTextSnapshot().length)])
    const editStart = performance.now()
    const edited = await session.refresh(buffer.getTextSnapshot())
    const editTotalMs = performance.now() - editStart
    const editedTimings = runtime.timing()
    const memoryAfterEdit = readMemory()
    const forcedGcAvailable = forceGc()
    return {
      lines,
      textLength: text.length,
      initialTotalMs,
      initialParseMs: timing(initialTimings, 'treeSitter.parse'),
      initialQueryMs: timing(initialTimings, 'treeSitter.query'),
      editTotalMs,
      editParseMs: timing(editedTimings, 'treeSitter.parse'),
      editQueryMs: timing(editedTimings, 'treeSitter.query'),
      captures: edited.captures.length,
      folds: edited.folds.length,
      memoryAfterParse,
      memoryAfterEdit,
      memoryAfterGc: readMemory(),
      forcedGcAvailable,
    }
  } finally {
    session.dispose()
    analysis.dispose()
    await runtime.owner.awaitIdleFence()
  }
}

const measureInjectionEdit = async (
  runtime: BenchmarkRuntime,
  fences: number,
): Promise<InjectionEditSample> => {
  const text = buildMarkdownWithFences(fences)
  const { buffer, view, analysis, session } = openAnalysis(
    runtime,
    text,
    `bench-injections-${fences}.md`,
    'markdown',
  )
  try {
    const parsed = await session.refresh(buffer.getTextSnapshot())
    const initialParseMs = timing(runtime.timing(), 'treeSitter.parse')
    const target = text.indexOf(`value${Math.floor(fences / 2)}`)
    view.applyEdits([{ from: target, to: target, text: 'edited' }])
    const editStart = performance.now()
    await session.refresh(buffer.getTextSnapshot())
    const editTotalMs = performance.now() - editStart
    const editParseMs = timing(runtime.timing(), 'treeSitter.parse')
    return {
      fences,
      textLength: text.length,
      injections: parsed.injections.length,
      initialParseMs,
      editTotalMs,
      editParseMs,
      baselineDelta: initialParseMs / editParseMs,
    }
  } finally {
    session.dispose()
    analysis.dispose()
    await runtime.owner.awaitIdleFence()
  }
}

const printMemory = (label: string, memory: MemorySample): void => {
  console.log(
    `${label}: heap ${memory.heapUsedMb.toFixed(2)} / ${memory.heapTotalMb.toFixed(2)} MiB, rss ${memory.rssMb.toFixed(2)} MiB`,
  )
}

const printSample = (sample: SyntaxSample): void => {
  console.log(`tree-sitter syntax benchmark: ${sample.lines.toLocaleString()} lines`)
  console.log(`text length: ${sample.textLength.toLocaleString()}`)
  console.log(`initial total: ${formatMs(sample.initialTotalMs)}`)
  console.log(`initial parse: ${formatMs(sample.initialParseMs)}`)
  console.log(`initial query: ${formatMs(sample.initialQueryMs)}`)
  console.log(`edit total: ${formatMs(sample.editTotalMs)}`)
  console.log(`edit parse: ${formatMs(sample.editParseMs)}`)
  console.log(`edit query: ${formatMs(sample.editQueryMs)}`)
  console.log(`captures: ${sample.captures.toLocaleString()}`)
  console.log(`folds: ${sample.folds.toLocaleString()}`)
  printMemory('memory after parse', sample.memoryAfterParse)
  printMemory('memory after edit', sample.memoryAfterEdit)
  printMemory('memory after forced gc', sample.memoryAfterGc)
  console.log(`forced gc available: ${sample.forcedGcAvailable}`)
  console.log('')
}

const printInjectionEditSample = (sample: InjectionEditSample): void => {
  console.log(`tree-sitter injection edit benchmark: ${sample.fences.toLocaleString()} fences`)
  console.log(`text length: ${sample.textLength.toLocaleString()}`)
  console.log(`injection layers: ${sample.injections.toLocaleString()}`)
  console.log(`initial parse: ${formatMs(sample.initialParseMs)}`)
  console.log(`incremental edit total: ${formatMs(sample.editTotalMs)}`)
  console.log(`incremental parse: ${formatMs(sample.editParseMs)}`)
  console.log(`initial/edit parse delta: ${sample.baselineDelta.toFixed(1)}x`)
  console.log('expected magnitude: incremental parse stays in the low tens of milliseconds')
  console.log('')
}

console.log(
  'instrument: typed document analysis admission; worker timings observed from real replies',
)
console.log(
  'injection edits return full analysis; source and configuration stay under the document owner',
)
const syntax = createBenchmarkRuntime()
try {
  for (const lines of LINE_COUNTS) printSample(await measureSyntax(syntax, lines))
} finally {
  await syntax.owner.dispose()
}
const injections = createBenchmarkRuntime()
try {
  printInjectionEditSample(await measureInjectionEdit(injections, MARKDOWN_FENCE_COUNT))
} finally {
  await injections.owner.dispose()
}
