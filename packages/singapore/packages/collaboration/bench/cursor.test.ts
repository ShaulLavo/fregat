import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'
import { analyzeLineMergeUnit } from '../../tree-sitter/src/treeSitter/mergeUnits'

const require = createRequire(new URL('../../tree-sitter-languages/package.json', import.meta.url))

test('measure late fallback error-range queries after cursor repair', async () => {
  await Parser.init()
  const catalog = require('./languages.json') as { languages: { id: string; wasm: string }[] }
  const grammar = catalog.languages.find((entry) => entry.id === 'typescript')!.wasm
  const parser = new Parser().setLanguage(await Language.load(require.resolve(grammar)))
  const head = 'const damaged = ;\n'
  const line = '// review this unchanged line\n'
  const tree = parser.parse(head + line.repeat(99_999))!
  const units = Array.from({ length: 100 }, (_, index) => ({
    source: 'line' as const,
    type: 'line',
    signature: null,
    parent: null,
    startIndex: head.length + (98_000 + index) * line.length,
    endIndex: head.length + (98_001 + index) * line.length,
  }))
  const samplesMs: number[] = []
  try {
    expect(tree.rootNode.hasError).toBe(true)
    const root = tree.rootNode
    for (let index = -5; index < 20; index++) {
      const before = performance.now()
      const groups = units.map((unit) => analyzeLineMergeUnit(root, unit, { analysis: true }))
      const elapsed = performance.now() - before
      expect(groups).toHaveLength(100)
      expect(groups.every((group) => !group.hasErrors)).toBe(true)
      if (index >= 0) samplesMs.push(elapsed)
    }
    const sorted = samplesMs.toSorted((a, b) => a - b)
    const directory = process.env.E068_EVIDENCE_DIR ?? new URL('.', import.meta.url).pathname
    mkdirSync(directory, { recursive: true })
    const evidence = {
      qualification: 'experiment, shared machine',
      environment: { platform: process.platform, cpu: cpus()[0]?.model, runtime: process.version },
      method:
        '100 late comment-line error-range lookups in a 100k-line TypeScript document with an early damaged declaration. Current parse and merge-unit query execution excluded to isolate error-range lookup. 5 warmups, 20 measured batches. Every batch validates identical clean fallback results. Compare source revisions in A/B/B/A order on the Mac on AC; Linux timers are diagnostic only.',
      medianMs: sorted[10],
      p95Ms: sorted[19],
      samplesMs,
    }
    writeFileSync(
      resolve(directory, 'cursor-evidence.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    console.log(JSON.stringify({ ...evidence, samplesMs: undefined }, null, 2))
  } finally {
    tree.delete()
    parser.delete()
  }
}, 120_000)
