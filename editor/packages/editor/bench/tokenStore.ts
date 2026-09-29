// What one keystroke costs the token path, end to end, at two document sizes:
// project the store through the edit, splice the highlighter's re-tokenized line into its store,
// compare the two for the view, and derive the minimap's token patch.
import { projectTokensThroughEdit } from '../src/editor/tokenProjection'
import { packEditorTokens, type PackedEditorTokens } from '../src/syntax/packedTokens'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorToken } from '../src/tokens'

const LINE_LENGTH = 41
const TOKENS_PER_LINE = 5
const WARMUP_RUNS = 4
const MEASURED_RUNS = 8
const KEYSTROKES_PER_RUN = 200

const styles = Array.from({ length: 12 }, (_, index) => ({
  color: `#${(0x111111 * (index + 1)).toString(16).slice(0, 6)}`,
}))

type Stages = Record<'project' | 'splice' | 'adoptCompare' | 'minimapDiff' | 'rowRead', number[]>

function lineTokens(line: number, grow: number): EditorToken[] {
  return Array.from({ length: TOKENS_PER_LINE }, (_, index) => ({
    start: line * LINE_LENGTH + index * 8 + (index > 0 ? grow : 0),
    end: line * LINE_LENGTH + index * 8 + 6 + grow,
    style: styles[(line + index) % styles.length]!,
  }))
}

function documentTokens(lines: number): PackedEditorTokens {
  const tokens: EditorToken[] = []
  for (let line = 0; line < lines; line += 1) tokens.push(...lineTokens(line, 0))
  return packEditorTokens(tokens)
}

function median(samples: number[]): number {
  return samples.toSorted((left, right) => left - right)[samples.length >> 1]!
}

function readRow(tokens: EditorTokenStore, line: number, grow: number): number {
  const last = tokens.firstStartingAtOrAfter((line + 1) * LINE_LENGTH + grow)
  let seen = 0
  tokens.forEachInRange(tokens.firstEndingAfter(line * LINE_LENGTH, last), last, () => {
    seen += 1
  })
  return seen
}

// Types `KEYSTROKES_PER_RUN` characters into one token, the highlighter answering each one.
function typeIntoLine(base: EditorTokenStore, line: number, stages: Stages | null): void {
  let view = base
  let highlighter = base
  for (let typed = 1; typed <= KEYSTROKES_PER_RUN; typed += 1) {
    const at = line * LINE_LENGTH + 3
    const t0 = performance.now()
    const projected = projectTokensThroughEdit(view, { from: at, to: at, text: 'x' }, '')
    const t1 = performance.now()
    highlighter = highlighter.applyPatch({
      fromOffset: line * LINE_LENGTH,
      oldEndOffset: (line + 1) * LINE_LENGTH + typed - 1,
      newEndOffset: (line + 1) * LINE_LENGTH + typed,
      tokensPacked: packEditorTokens(lineTokens(line, typed)),
    })
    const t2 = performance.now()
    if (!projected.equals(highlighter)) throw new Error('projection and answer disagree')
    const t3 = performance.now()
    const range = projected.changedRangeTo(highlighter)
    const t4 = performance.now()
    if (range.deleteCount !== 0) throw new Error('an equal answer produced a minimap patch')
    if (readRow(highlighter, line, typed) !== TOKENS_PER_LINE) throw new Error('row slice is wrong')
    const t5 = performance.now()
    view = highlighter

    if (!stages) continue
    stages.project.push(t1 - t0)
    stages.splice.push(t2 - t1)
    stages.adoptCompare.push(t3 - t2)
    stages.minimapDiff.push(t4 - t3)
    stages.rowRead.push(t5 - t4)
  }
}

// One keystroke at each of many distant lines: every place leaves two segment boundaries behind,
// so this is the case that reaches the segment cap and pays for a flat copy.
function typeAtScatteredLines(base: EditorTokenStore, lines: number): number[] {
  const samples: number[] = []
  let view = base
  let shift = 0
  for (let step = 0; step < KEYSTROKES_PER_RUN; step += 1) {
    const line = Math.floor((lines / KEYSTROKES_PER_RUN) * step)
    const at = line * LINE_LENGTH + 3 + shift
    const startedAt = performance.now()
    view = projectTokensThroughEdit(view, { from: at, to: at, text: 'x' }, '')
    samples.push(performance.now() - startedAt)
    shift += 1
  }
  if (view.length !== base.length) throw new Error('scattered typing lost tokens')
  return samples
}

const rows: Record<string, number>[] = []
for (const lines of [100_000, 500_000]) {
  const packed = documentTokens(lines)
  const stages: Stages = { project: [], splice: [], adoptCompare: [], minimapDiff: [], rowRead: [] }
  for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
    // A fresh store per run: the arrays are shared, the segment history is not.
    const base = EditorTokenStore.fromPacked({ ...packed })
    typeIntoLine(base, (lines >> 1) + run, run < WARMUP_RUNS ? null : stages)
  }

  const row: Record<string, number> = { lines, tokens: lines * TOKENS_PER_LINE }
  let total = 0
  for (const [name, samples] of Object.entries(stages)) {
    row[`${name} ms`] = Number(median(samples).toFixed(4))
    total += median(samples)
  }
  row['total ms'] = Number(total.toFixed(4))

  const scattered = typeAtScatteredLines(EditorTokenStore.fromPacked({ ...packed }), lines)
  row['scattered median ms'] = Number(median(scattered).toFixed(4))
  row['scattered max ms'] = Number(Math.max(...scattered).toFixed(4))
  rows.push(row)
}
console.table(rows)
