/*
 * What a semantic classification costs on a warm TypeScript language service: the whole of a
 * ~5,000-line file, then a 100-line window of the same file, then a completion and a quick-info at
 * the same position so the classification numbers have something to be read against.
 *
 * These four numbers are a datum, not a budget. They price the example app's in-process worker,
 * which has one message loop and no queue, so whatever a classification costs is time no other
 * language feature can use. They say nothing about a language server in its own process, and
 * nothing in this repo may treat them as a gate.
 *
 * The fixture is real code rather than generated filler, because generated filler has a uniform
 * type shape and a checker's cost is all in the non-uniform parts. It is every `.ts` file under the
 * directories in FIXTURE_SOURCE_DIRECTORIES, in path order, taken whole until the running line
 * count crosses FIXTURE_TARGET_LINES. Each file's body is wrapped in its own `namespace` and its
 * import and re-export statements are dropped, so that the concatenation is one parseable module
 * and two files that both define `isRecord` do not collide. Cross-file references therefore dangle
 * — work the checker would do on a genuinely single 5,000-line file that it does not do here, so
 * treat these numbers as the optimistic end.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createRealTypeScriptService } from '../test/realTypeScriptService'

type Sample = {
  readonly name: string
  readonly iterations: number
  readonly averageMs: number
  readonly p95Ms: number
  readonly worstMs: number
}

type Fixture = {
  readonly fileName: string
  readonly text: string
  readonly lines: number
  readonly sourceFiles: number
}

type Probe = {
  readonly completionOffset: number
  readonly quickInfoOffset: number
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..')
const FIXTURE_SOURCE_DIRECTORIES = ['packages/typescript-lsp/src', 'packages/minimap/src'] as const
const FIXTURE_TARGET_LINES = 5_000
const FIXTURE_FILE_NAME = '/src/fixture.ts'
const SPAN_LINES = 100
const WARMUP_ITERATIONS = 3
const ITERATIONS = 20

const formatMs = (value: number): string => `${value.toFixed(3)}ms`

const fixtureFilePaths = (): readonly string[] =>
  FIXTURE_SOURCE_DIRECTORIES.flatMap((directory) => {
    const absolute = join(REPO_ROOT, directory)
    return readdirSync(absolute)
      .filter((entry) => entry.endsWith('.ts'))
      .toSorted()
      .map((entry) => join(absolute, entry))
  })

const isModuleWiringStatement = (statement: ts.Statement): boolean => {
  if (ts.isImportDeclaration(statement)) return true
  if (ts.isImportEqualsDeclaration(statement)) return true
  if (ts.isExportAssignment(statement)) return true
  return ts.isExportDeclaration(statement)
}

// `budgetLines` stops the copy at the last statement boundary that fits, so the fixture lands on
// its target instead of wherever the final source file happens to end.
const namespacedSource = (filePath: string, index: number, budgetLines: number): string => {
  const text = readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2023, true)
  const body: string[] = []
  let lines = 0

  for (const statement of source.statements) {
    if (lines >= budgetLines) break
    if (isModuleWiringStatement(statement)) continue

    const statementText = statement.getFullText(source)
    body.push(statementText)
    lines += countLines(statementText)
  }

  return `namespace Fixture${index} {\n${body.join('')}\n}\n`
}

const countLines = (text: string): number => text.split('\n').length - 1

const buildFixture = (): Fixture => {
  const parts: string[] = []
  let lines = 0
  let sourceFiles = 0

  for (const filePath of fixtureFilePaths()) {
    if (lines >= FIXTURE_TARGET_LINES) break

    const part = namespacedSource(filePath, sourceFiles, FIXTURE_TARGET_LINES - lines)
    parts.push(part)
    lines += countLines(part)
    sourceFiles += 1
  }

  const text = parts.join('\n')
  return { fileName: FIXTURE_FILE_NAME, text, lines: countLines(text), sourceFiles }
}

const lineStarts = (text: string): readonly number[] => {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

const middleSpan = (text: string): ts.TextSpan => {
  const starts = lineStarts(text)
  const firstLine = Math.max(0, Math.floor(starts.length / 2) - Math.floor(SPAN_LINES / 2))
  const start = starts[firstLine] ?? 0
  const end = starts[Math.min(starts.length - 1, firstLine + SPAN_LINES)] ?? text.length
  return ts.createTextSpan(start, end - start)
}

/*
 * A position the checker can actually answer about. Imports were stripped out of the fixture, so
 * plenty of identifiers in it dangle; asking about one of those would benchmark the failure path.
 * Walk property accesses until one answers both questions, and measure that.
 */
const findProbe = (service: ts.LanguageService, fixture: Fixture): Probe => {
  const source = service.getProgram()?.getSourceFile(fixture.fileName)
  if (!source) throw new Error('the fixture is not in the program')

  const accesses: ts.PropertyAccessExpression[] = []
  const collect = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) accesses.push(node)
    ts.forEachChild(node, collect)
  }
  collect(source)

  for (const access of accesses) {
    const completionOffset = access.name.getStart(source)
    const quickInfoOffset = access.expression.getStart(source)
    const completions = service.getCompletionsAtPosition(fixture.fileName, completionOffset, {})
    if (!completions || completions.entries.length === 0) continue
    if (!service.getQuickInfoAtPosition(fixture.fileName, quickInfoOffset)) continue

    return { completionOffset, quickInfoOffset }
  }

  throw new Error('no property access in the fixture resolved to a type')
}

const measure = (name: string, run: () => void): Sample => {
  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration++) run()

  const durations: number[] = []
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const start = performance.now()
    run()
    durations.push(performance.now() - start)
  }

  return {
    name,
    iterations: ITERATIONS,
    averageMs: average(durations),
    p95Ms: percentile(durations, 0.95),
    worstMs: Math.max(...durations),
  }
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const percentile = (values: readonly number[], percentileValue: number): number => {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.ceil(sorted.length * percentileValue) - 1
  return sorted[Math.max(0, index)] ?? 0
}

const printSample = (sample: Sample): void => {
  console.log(
    `${sample.name}: average ${formatMs(sample.averageMs)}, p95 ${formatMs(
      sample.p95Ms,
    )}, worst ${formatMs(sample.worstMs)} over ${sample.iterations} iterations`,
  )
}

const run = (): void => {
  const fixture = buildFixture()
  const env = createRealTypeScriptService(new Map([[fixture.fileName, fixture.text]]))
  const service = env.languageService

  const wholeFileSpan = ts.createTextSpan(0, fixture.text.length)
  const windowSpan = middleSpan(fixture.text)

  // Everything below is measured on this one service, after the program and the checker are built.
  const cold = performance.now()
  const wholeFileSpans = service.getEncodedSemanticClassifications(
    fixture.fileName,
    wholeFileSpan,
    ts.SemanticClassificationFormat.TwentyTwenty,
  ).spans.length
  const coldMs = performance.now() - cold
  const probe = findProbe(service, fixture)

  console.log('semantic classification benchmark')
  console.log(`fixture: ${fixture.lines.toLocaleString()} lines from ${fixture.sourceFiles} files`)
  console.log(`syntactic diagnostics: ${service.getSyntacticDiagnostics(fixture.fileName).length}`)
  console.log(`encoded spans over the whole file: ${(wholeFileSpans / 3).toLocaleString()} tokens`)
  console.log(`first (cold) whole-file classification: ${formatMs(coldMs)}`)
  console.log(`window: ${SPAN_LINES} lines at offset ${windowSpan.start}`)
  console.log(`probe offsets: completion ${probe.completionOffset}, hover ${probe.quickInfoOffset}`)
  console.log('')

  printSample(
    measure('(a) getEncodedSemanticClassifications, whole file', () => {
      service.getEncodedSemanticClassifications(
        fixture.fileName,
        wholeFileSpan,
        ts.SemanticClassificationFormat.TwentyTwenty,
      )
    }),
  )
  printSample(
    measure(`(b) getEncodedSemanticClassifications, ${SPAN_LINES}-line span`, () => {
      service.getEncodedSemanticClassifications(
        fixture.fileName,
        windowSpan,
        ts.SemanticClassificationFormat.TwentyTwenty,
      )
    }),
  )
  printSample(
    measure('(c) getCompletionsAtPosition', () => {
      service.getCompletionsAtPosition(fixture.fileName, probe.completionOffset, {})
    }),
  )
  printSample(
    measure('(d) getQuickInfoAtPosition', () => {
      service.getQuickInfoAtPosition(fixture.fileName, probe.quickInfoOffset)
    }),
  )
}

run()
