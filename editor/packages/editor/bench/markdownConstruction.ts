import assert from 'node:assert/strict'
import { cpus } from 'node:os'
import { init, MarkdownDocument } from 'tree-sitter-md'
import {
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { createInlineMap } from '@singapore-editor/core/rendering'
import { DisplayProjection } from '../src/virtualization/displayProjection'
import { markdownInlineReplacements } from '../../markdown/src/replacements'

await init()
const unit = 'read [the long label with words and averylongidentifier](https://example.com) now\n'
const sizes = process.argv.slice(2).map(Number)
const median = (values: readonly number[]): number =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!
console.log(
  JSON.stringify({
    experiment: 'link-heavy Markdown construction',
    date: new Date().toISOString(),
    runtime: process.versions,
    cpu: cpus()[0]?.model,
    platform: process.platform,
    includes: 'fresh parser, piece table, replacement specs, inline map and projection row count',
    excludes: 'browser layout, paint, fonts, workers and network',
  }),
)
for (const size of sizes.length ? sizes : [524288, 1048576]) {
  const text = unit.repeat(Math.ceil(size / unit.length))
  const samples = []
  for (let run = 0; run < 3; run++) {
    const parser = new MarkdownDocument()
    try {
      const start = performance.now()
      parser.setText(text)
      const parsed = performance.now()
      const buffer = createPieceTableSnapshot(text)
      const snapshot = createDocumentTextSnapshot(buffer)
      const replacements = markdownInlineReplacements(snapshot, parser.decorations(0, text.length))
      const decorated = performance.now()
      const inlineMap = createInlineMap(buffer, replacements)
      const mapped = performance.now()
      const projection = new DisplayProjection({
        textSnapshot: snapshot,
        foldMap: null,
        inlineMap,
        injectedTextRows: [],
        wrapColumn: 40,
        wrapBreak: 'word',
        tabSize: 4,
      })
      const rows = projection.rowCount
      const finished = performance.now()
      const links = text.length / unit.length
      assert.equal(inlineMap.ranges.filter((range) => range.wrap === 'text').length, links)
      assert.equal(rows, links * 2 + 1)
      const sample = {
        run,
        units: text.length,
        links,
        replacements: inlineMap.ranges.length,
        rows,
        parseMs: parsed - start,
        replacementsMs: decorated - parsed,
        inlineMapMs: mapped - decorated,
        projectionMs: finished - mapped,
        totalMs: finished - start,
      }
      samples.push(sample)
      console.log(JSON.stringify(sample))
    } finally {
      parser.dispose()
    }
  }
  console.log(
    JSON.stringify({
      units: text.length,
      medianReplacementMs: median(samples.map((sample) => sample.replacementsMs)),
      medianTotalMs: median(samples.map((sample) => sample.totalMs)),
    }),
  )
}
