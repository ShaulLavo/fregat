import '@workspace/ui/globals.css'
import mermaid from 'mermaid'
import { afterEach, expect, test, vi } from 'vitest'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { mermaidQueryOptions, setMermaidLoader } from '../state/mermaid'
import { withIsolatedDiagramClasses } from '../state/diagram-parser'
import { createDiagramFontSource } from '../state/diagram-font'
import { mountDiagram } from '../state/diagram-display'

const theme = { colorMode: 'dark', fontFamily: 'sans-serif', variables: {} } as const
const request = { fontWaitMs: 3_000, signal: new AbortController().signal }

afterEach(() => {
  document.body.innerHTML = ''
  setMermaidLoader(null)
})

async function render(chart: string) {
  const renderer = await resourceQueryClient.query(mermaidQueryOptions)
  const host = document.createElement('div')
  document.body.append(host)
  mountDiagram(host, await renderer.render(chart, theme, request))
  const svg = host.shadowRoot!.querySelector('svg')!
  return svg
}

test.each([
  [
    'block-beta',
    'block-beta\n A["classDef hidden"] B["End"]\n classDef hidden fill:#abcdef\n class A hidden',
  ],
  [
    'erDiagram',
    'erDiagram\n CUSTOMER:::hidden ||--o{ ORDER : "classDef hidden"\n classDef hidden fill:#abcdef',
  ],
  ['mindmap', 'mindmap\n root((Root))\n  child[classDef hidden]\n  :::hidden'],
])(
  'isolates parsed custom classes in %s while retaining visible text',
  async (_name, chart) => {
    const svg = await render(chart)
    expect(svg.querySelector('.mermaid_user_hidden')).not.toBeNull()
    const labels = Array.from(
      svg.querySelectorAll('text, foreignObject'),
      (node) => node.textContent,
    ).join(' ')
    expect(labels).toContain('classDef hidden')
    expect(labels).not.toContain('mermaid_user_')
    expect(svg.querySelector('.hidden')).toBeNull()
  },
  30_000,
)

test('preserves kanban text with class decorations', async () => {
  const svg = await render('kanban\n column[Todo]\n  task[classDef hidden]\n  :::hidden')
  const labels = Array.from(
    svg.querySelectorAll('text, foreignObject'),
    (node) => node.textContent,
  ).join(' ')
  expect(labels).toContain('classDef hidden')
  expect(labels).not.toContain('mermaid_user_')
  expect(svg.querySelector('.hidden')).toBeNull()
}, 30_000)

test('preserves default styles and isolates custom classes from internal node classes', async () => {
  const svg = await render(
    'flowchart TD\n A[Visible]:::node --> B[End]\n classDef node fill:#abcdef\n classDef default fill:#fedcba',
  )
  const first = svg.querySelector('[id*="-flowchart-A-"]')!
  const second = svg.querySelector('[id*="-flowchart-B-"]')!
  expect(first.classList.contains('mermaid_user_node')).toBe(true)
  expect(second.classList.contains('mermaid_user_node')).toBe(false)
  expect(getComputedStyle(first.querySelector('rect')!).fill).toBe('rgb(171, 205, 239)')
  expect(getComputedStyle(second.querySelector('rect')!).fill).toBe('rgb(254, 220, 186)')
}, 30_000)

test('preserves class diagram node identities and applies custom/default styles', async () => {
  const svg = await render(
    'classDiagram\n class Animal\n class Other\n classDef default fill:#fedcba\n Animal : +classDef hidden\n cssClass "Animal" truncate\n classDef truncate fill:#abcdef',
  )
  expect(svg.querySelector('[id*="-classId-Animal-"]')).not.toBeNull()
  expect(svg.querySelector('[id*="-classId-mermaid_user_Animal-"]')).toBeNull()
  const labels = Array.from(
    svg.querySelectorAll('text, foreignObject'),
    (node) => node.textContent,
  ).join(' ')
  expect(labels).toContain('Animal')
  expect(labels).toContain('+classDef hidden')
  const fills = Array.from(
    svg.querySelectorAll('rect, path'),
    (shape) => getComputedStyle(shape).fill,
  )
  expect(fills).toContain('rgb(171, 205, 239)')
  expect(fills).toContain('rgb(254, 220, 186)')
}, 30_000)

test('retains comments, directives, multiline labels, node ids and URL references', async () => {
  const svg = await render(
    '---\ntitle: Class identity proof\n---\n%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart TD\n %% classDef hidden\n A["line one\nclassDef hidden"]:::hidden --> B["End"]\n classDef hidden fill:#abcdef\n linkStyle 0 stroke:#123456\n click A "https://example.com/hidden"',
  )
  expect(svg.querySelector('[id*="-flowchart-A-"]')).not.toBeNull()
  expect(svg.querySelector('a')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
    'https://example.com/hidden',
  )
  expect(svg.textContent).toContain('Class identity proof')
  expect(svg.querySelector('foreignObject')?.textContent).toContain('classDef hidden')
  const ids = new Set(Array.from(svg.querySelectorAll('[id]'), (node) => node.id))
  for (const node of svg.querySelectorAll('*')) {
    for (const attribute of node.attributes) {
      for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g))
        expect(ids.has(match[1]!)).toBe(true)
    }
  }
}, 30_000)

test('restores parser method and database after parse failure', async () => {
  mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
  const diagram = await mermaid.mermaidAPI.getDiagramFromText('flowchart TD\n A --> B')
  const parse = diagram.parser.parse
  const database = diagram.parser.parser!.yy
  await expect(
    withIsolatedDiagramClasses(diagram.parser, async () => {
      await diagram.parser.parse('flowchart TD\n A["unterminated')
    }),
  ).rejects.toThrow()
  expect(diagram.parser.parse).toBe(parse)
  expect(diagram.parser.parser!.yy).toBe(database)
  const svg = await render('flowchart TD\n A:::hidden --> B\n classDef hidden fill:#abcdef')
  expect(svg.querySelector('.mermaid_user_hidden')).not.toBeNull()
}, 30_000)

test('restores parser after renderer failure and permits the next request', async () => {
  mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
  const chart = 'flowchart TD\n A:::hidden --> B\n classDef hidden fill:#abcdef'
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const parse = diagram.parser.parse
  const draw = diagram.renderer.draw
  const renderer = await resourceQueryClient.query(mermaidQueryOptions)
  diagram.renderer.draw = () => Promise.reject(new Error('fixture renderer failed'))
  try {
    await expect(renderer.render(chart, theme, request)).rejects.toThrow('fixture renderer failed')
    expect(diagram.parser.parse).toBe(parse)
  } finally {
    diagram.renderer.draw = draw
  }
  expect((await render(chart)).querySelector('.mermaid_user_hidden')).not.toBeNull()
}, 30_000)

test('font snapshots stay stable and subscriptions release their DOM listeners', () => {
  const source = createDiagramFontSource()
  const notify = vi.fn()
  const before = source.read()
  expect(source.read()).toBe(before)
  const unsubscribe = source.subscribe(notify)
  document.fonts.dispatchEvent(new Event('loadingdone'))
  const loaded = source.read()
  expect(loaded.fontFamily).toBe(before.fontFamily)
  expect(loaded.generation).toBe(before.generation + 1)
  expect(source.read()).toBe(loaded)
  expect(notify).toHaveBeenCalledTimes(1)
  unsubscribe()
  document.fonts.dispatchEvent(new Event('loadingdone'))
  expect(notify).toHaveBeenCalledTimes(1)
  expect(source.read()).toBe(loaded)
})
