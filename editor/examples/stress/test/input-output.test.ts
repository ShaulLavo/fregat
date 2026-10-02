import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { plainChunkCoverage } from '../src/input-output.ts'

let browser: Browser
let script: string
beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(import.meta.dirname, '../src/input-output.ts'),
        name: 'InputOutput',
        formats: ['iife'],
      },
    },
  })
  const output = Array.isArray(result) ? result[0]!.output : result.output
  script = output
    .filter((entry) => entry.type === 'chunk')
    .map((entry) => entry.code)
    .join('\n')
  browser = await chromium.launch({ headless: true })
}, 20_000)
afterAll(async () => {
  await browser?.close()
})

test.each(['live', 'static'])(
  'checks rendered chunks with %s range boundaries in Chromium',
  async (kind) => {
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<section id="view-0"><div data-editor-virtual-row="0"><span data-editor-virtual-chunk-start="0">abc</span><span data-editor-virtual-chunk-start="3">def</span></div></section><section id="view-1"><div data-editor-virtual-row="0">other</div></section>',
      )
      await page.addScriptTag({ content: script })
      const observed = await page.evaluate(
        ({ kind, name }) => {
          const probe = (
            globalThis as unknown as {
              InputOutput: Record<string, (index: number) => { chunks: number; covered: number }>
            }
          ).InputOutput[name]!
          const texts = [
            ...document.querySelectorAll('#view-0 [data-editor-virtual-chunk-start]'),
          ].map((chunk) => chunk.firstChild!)
          const ranges = texts.map((node) => {
            const boundary = {
              startContainer: node,
              startOffset: 0,
              endContainer: node,
              endOffset: node.textContent!.length,
            }
            if (kind === 'static') return new StaticRange(boundary)
            const range = document.createRange()
            range.setStart(node, 0)
            range.setEnd(node, node.textContent!.length)
            return range
          })
          CSS.highlights.set('editor-shared-token-0', new Highlight(...ranges))
          const complete = probe(0)
          const isolated = probe(1)
          CSS.highlights.set('editor-shared-token-0', new Highlight(ranges[0]!))
          const missing = probe(0)
          const partial = document.createRange()
          partial.setStart(texts[1]!, 0)
          partial.setEnd(texts[1]!, 2)
          CSS.highlights.set('editor-shared-token-0', new Highlight(ranges[0]!, partial))
          return { complete, isolated, missing, incomplete: probe(0) }
        },
        { kind, name: plainChunkCoverage.name },
      )
      expect(observed).toEqual({
        complete: { chunks: 2, covered: 2 },
        isolated: { chunks: 1, covered: 0 },
        missing: { chunks: 2, covered: 1 },
        incomplete: { chunks: 2, covered: 1 },
      })
    } finally {
      await page.close()
    }
  },
)
