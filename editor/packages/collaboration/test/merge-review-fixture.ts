import { createRequire } from 'node:module'
import { Language, Parser, Query } from 'web-tree-sitter'
import { ConfirmedWindow, TextbufferEngine } from '@singapore-editor/collab'
import type { EditId, Envelope, OffsetEdit, TextbufferSnapshot } from '@singapore-editor/collab'
import {
  CharIdAllocator,
  createPieceTableSnapshot,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import type { TreeSitterMergeUnit } from '@singapore-editor/tree-sitter'
import {
  enclosingMergeUnit,
  touchingMergeUnits,
  analyzeLineMergeUnit,
  lineMergeUnit,
} from '../../tree-sitter/src/treeSitter/mergeUnits'
import { createDocumentTextSnapshot } from '@singapore-editor/core/document'
import { MergeReviewDetector } from '../src/merge-review'
import type { MergeReviewSyntax } from '../src/merge-review'

const require = createRequire(new URL('../../tree-sitter-languages/package.json', import.meta.url))
export async function syntaxFixture(languageId = 'typescript', profile = false) {
  await Parser.init()
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === languageId)!
  const assets = await contribution.load!()
  const grammar =
    languageId === 'json'
      ? 'tree-sitter-json/tree-sitter-json.wasm'
      : 'tree-sitter-typescript/tree-sitter-typescript.wasm'
  const language = await Language.load(require.resolve(grammar))
  const parser = new Parser().setLanguage(language)
  const query = new Query(language, assets.mergeUnitQuerySource!)
  const metrics = { ranges: 0, parses: 0, parseMs: 0, queries: 0, queryMs: 0, unitsMs: 0 }
  if (profile) {
    const matches = query.matches.bind(query)
    query.matches = (...args) => {
      const before = performance.now()
      const result = matches(...args)
      metrics.queries++
      metrics.queryMs += performance.now() - before
      return result
    }
  }
  const trees = new Map<PieceTableSnapshot, ReturnType<Parser['parse']>>()
  const parents = new Map<PieceTableSnapshot, Map<number, boolean>>()
  let calls = 0
  const syntax: MergeReviewSyntax = async (snapshot, ranges, contentKey, selection) => {
    calls++
    let tree = trees.get(snapshot)
    if (!tree) {
      const before = profile ? performance.now() : 0
      tree = parser.parse((index, _position, end) =>
        index >= snapshot.length
          ? undefined
          : readPieceTableTextRange(
              snapshot,
              index,
              Math.min(snapshot.length, end ?? index + 4096),
            ),
      )!
      if (profile) {
        metrics.parses++
        metrics.parseMs += performance.now() - before
      }
      trees.set(snapshot, tree)
      parents.set(snapshot, new Map())
    }
    return ranges.map((range) => {
      const before = profile ? performance.now() : 0
      const text = createDocumentTextSnapshot(snapshot)
      const context = { analysis: true, contentKey, parents: parents.get(snapshot) }
      const selected: readonly TreeSitterMergeUnit[] =
        selection === 'touching'
          ? touchingMergeUnits(tree!.rootNode, query, range, context)
          : [enclosingMergeUnit(tree!.rootNode, query, range, context)].filter(
              (unit): unit is TreeSitterMergeUnit => unit !== null,
            )
      const units = selected.length
        ? selected
        : [analyzeLineMergeUnit(tree!.rootNode, lineMergeUnit(text, range), context)]
      const result = units.map((unit) => ({
        ...unit,
        languageId,
        hasErrors: unit.hasErrors ?? false,
      }))
      if (profile) {
        metrics.ranges++
        metrics.unitsMs += performance.now() - before
      }
      return result
    })
  }
  return {
    syntax,
    metrics,
    resetMetrics() {
      for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) metrics[key] = 0
    },
    detector: new MergeReviewDetector(syntax),
    get calls() {
      return calls
    },
    resetQueries() {
      for (const snapshot of trees.keys()) parents.set(snapshot, new Map())
    },
    clear() {
      for (const tree of trees.values()) tree?.delete()
      trees.clear()
      parents.clear()
    },
    dispose() {
      this.clear()
      query.delete()
      parser.delete()
    },
  }
}

export function history(
  text: string,
  edits: readonly OffsetEdit[],
  actors = edits.map((_, index) => `author-${index}`),
) {
  const initial = createPieceTableSnapshot(text, {
    normalized: true,
    charIds: { bunch: 'initial', counter: 0 },
  })
  const base = new TextbufferEngine(initial)
  const snapshot = base.snapshot()
  const confirmed: Envelope[] = edits.map((edit, index) => {
    const peer = new TextbufferEngine()
    peer.restore(snapshot)
    const allocator = new CharIdAllocator(`edit-${index}`)
    return peer.author(edit, {
      document: 'review',
      epoch: '1',
      id: { actor: actors[index]!, seq: index + 1 },
      lamport: 1,
      deps: [],
      allocate: (left, count) => allocator.generateAfter(left, count),
    })
  })
  for (const edit of confirmed) base.apply(edit)
  return { base, confirmed, snapshot, window: new ConfirmedWindow(confirmed) }
}
export function peerSnapshot(snapshot: TextbufferSnapshot, confirmed: readonly Envelope[]) {
  const engine = new TextbufferEngine()
  engine.restore(snapshot)
  for (const edit of confirmed) engine.apply(edit)
  return engine.snapshot()
}

export function appendEdit(
  input: ReturnType<typeof history>,
  edit: OffsetEdit,
  actor: string,
  deps: readonly EditId[] = input.confirmed.map((envelope) => envelope.id),
  snapshot = input.base.snapshot(),
) {
  const peer = new TextbufferEngine()
  peer.restore(snapshot)
  const seq = input.confirmed.length + 1
  const allocator = new CharIdAllocator(`causal-${seq}`)
  const envelope = peer.author(edit, {
    document: 'review',
    epoch: '1',
    id: { actor, seq },
    lamport: seq,
    deps,
    allocate: (left, count) => allocator.generateAfter(left, count),
  })
  input.base.apply(envelope)
  input.confirmed.push(envelope)
  input.window.append([envelope])
  return envelope
}
