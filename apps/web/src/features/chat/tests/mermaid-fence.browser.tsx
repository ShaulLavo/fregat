import { page } from 'vitest/browser'
import type { QueryClient } from '@tanstack/react-query'
import '@workspace/ui/globals.css'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import { AssistantMarkdown } from '../components/assistant-markdown'
import { ChatWorkspaceRootContext } from '../providers/workspace-root-context'
import { loadedMermaid, setMermaidLoader } from '../state/mermaid'
import delayedFontUrl from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url'

const DIAGRAM = 'A graph:\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n'

let root: Root | null = null
let queryClient: QueryClient

beforeEach(() => {
  queryClient = createTestQueryClient()
  seedBootMirrorTheme('dark')
  const container = document.createElement('main')
  container.style.width = '720px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) {
    flushSync(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ''
  queryClient.clear()
  localStorage.clear()
  setMermaidLoader(null)
})

function renderDiagram(streaming: boolean, text = DIAGRAM) {
  flushSync(() => {
    root?.render(
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>
          <ChatWorkspaceRootContext value={null}>
            <AssistantMarkdown streaming={streaming} text={text} />
          </ChatWorkspaceRootContext>
        </TestEditorStateProvider>
      </AppProviders>,
    )
  })
}

function mermaidCodeBlock() {
  return document.querySelector('[data-markdown="code-block"][data-language="mermaid"]')
}

function mermaidDiagram() {
  const host = document.querySelector('[data-markdown="mermaid-block"] [role="img"]')
  return host?.shadowRoot?.querySelector('svg') ?? host?.querySelector('svg') ?? null
}

describe('mermaid fences', () => {
  it.each([
    ['sequence message', 'sequenceDiagram\n Alice->>Bob: :::hidden', ':::hidden'],
    [
      'state description',
      'stateDiagram-v2\n [*] --> Idle\n Idle : classDef hidden',
      'classDef hidden',
    ],
    ['class member', 'classDiagram\n class Animal\n Animal : +classDef hidden', '+classDef hidden'],
    [
      'quoted closing bracket',
      'flowchart TD\n A["bracket ] classDef hidden"] --> B',
      'bracket ] classDef hidden',
    ],
  ])(
    'preserves visible text in %s',
    async (_name, chart, label) => {
      renderDiagram(false, `\`\`\`mermaid\n${chart}\n\`\`\``)
      await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
      const labels = [...mermaidDiagram()!.querySelectorAll('text, foreignObject')]
        .map((node) => node.textContent)
        .join(' ')
      expect(labels).toContain(label)
      expect(labels).not.toContain('mermaid_user_')
    },
    30_000,
  )

  it('remeasures after the selected font face loads with the same family', async () => {
    const face = new FontFace('DelayedDiagramFace', `url(${JSON.stringify(delayedFontUrl)})`)
    const chart = '```mermaid\nflowchart TD\n A[MMMMMMMMMMMMM iiiiiiiiiiiiiii] --> B[End]\n```'
    renderDiagram(false, chart)
    await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
    const initial = mermaidDiagram()
    document.documentElement.style.setProperty('--font-ui', 'DelayedDiagramFace, serif')
    try {
      await vi.waitFor(() => expect(mermaidDiagram()).not.toBe(initial), { timeout: 5000 })
      const fallback = mermaidDiagram()!
      const before = fallback.getAttribute('viewBox')
      await page.screenshot({ path: 'surface-mermaid-font-fallback.png' })
      document.fonts.add(face)
      await face.load()
      await document.fonts.ready
      await vi.waitFor(() => expect(mermaidDiagram()).not.toBe(fallback), { timeout: 5000 })
      expect(mermaidDiagram()!.getAttribute('viewBox')).not.toBe(before)
      const loaded = mermaidDiagram()!
      const loadedBox = loaded.getAttribute('viewBox')
      await page.screenshot({ path: 'surface-mermaid-font-loaded.png' })
      console.info('MERMAID_FONT_METRICS', { before, loaded: loadedBox, status: face.status })
      renderDiagram(false, '')
      expect(mermaidDiagram()).toBeNull()
      renderDiagram(false, chart)
      await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 5000 })
      expect(mermaidDiagram()).not.toBe(loaded)
      expect(mermaidDiagram()!.getAttribute('viewBox')).toBe(loadedBox)
      expect(getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()).toBe(
        'DelayedDiagramFace, serif',
      )
    } finally {
      document.documentElement.style.removeProperty('--font-ui')
      document.fonts.delete(face)
    }
  }, 30_000)

  it('discards pending diagrams after a font revision and after unmount', async () => {
    const first = Promise.withResolvers<{ svg: string }>()
    const second = Promise.withResolvers<{ svg: string }>()
    const render = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    setMermaidLoader(async () => ({
      initialize() {},
      mermaidAPI: { getDiagramFromText: async () => ({ parser: { parse() {} } }) },
      render,
    }))
    renderDiagram(false)
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    document.fonts.dispatchEvent(new Event('loadingdone'))
    // Flush React's external-store update before the obsolete request settles.
    await new Promise((resolve) => setTimeout(resolve, 0))
    first.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>obsolete</text></svg>' })
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    expect(mermaidDiagram()).toBeNull()
    renderDiagram(false, '')
    second.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>unmounted</text></svg>' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mermaidDiagram()).toBeNull()
  }, 30_000)

  it('renders namespaced classes across flowchart, state and class diagram grammars', async () => {
    const charts = [
      'flowchart TD\n A[Visible]:::flex --> B[End]\n classDef flex fill:#abcdef',
      'stateDiagram-v2\n [*] --> Idle\n Idle --> [*]\n classDef hidden fill:#abcdef\n class Idle hidden',
      'classDiagram\n class Animal\n cssClass "Animal" truncate\n classDef truncate fill:#abcdef',
    ]
    for (const chart of charts) {
      const previous = mermaidDiagram()
      renderDiagram(false, `\`\`\`mermaid\n${chart}\n\`\`\``)
      await vi.waitFor(
        () => {
          expect(
            document.querySelector('[data-markdown="mermaid-block"] p')?.textContent ?? null,
          ).toBeNull()
          expect(mermaidDiagram()).not.toBeNull()
          expect(mermaidDiagram()).not.toBe(previous)
        },
        { timeout: 15_000 },
      )
      const shapes = [...(mermaidDiagram()?.querySelectorAll('rect, polygon, path') ?? [])]
      expect(
        shapes.map((shape) => getComputedStyle(shape).fill),
        chart,
      ).toContain('rgb(171, 205, 239)')
    }
  }, 30_000)

  it('isolates custom classes during measurement and display', async () => {
    renderDiagram(
      false,
      '```mermaid\ngraph TD\n A[Visible label]:::hidden --> B[End]\n classDef hidden fill:#abcdef\n```',
    )
    await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
    const svg = mermaidDiagram()
    const node = svg?.querySelector('.node')
    expect(node).not.toBeNull()
    expect(getComputedStyle(node!).display).not.toBe('none')
    expect(node!.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(svg?.getRootNode()).toBeInstanceOf(ShadowRoot)
    expect(document.querySelector('[data-markdown="mermaid-block"] [role="img"] svg')).toBeNull()
  }, 30_000)

  it('remeasures diagrams after the UI font changes', async () => {
    renderDiagram(false)
    await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
    const original = mermaidDiagram()
    document.documentElement.style.setProperty('--font-ui', 'monospace')
    try {
      await vi.waitFor(() => expect(mermaidDiagram()).not.toBe(original), { timeout: 5000 })
      expect(mermaidDiagram()).not.toBeNull()
    } finally {
      document.documentElement.style.removeProperty('--font-ui')
    }
  }, 30_000)

  it('renders a diagram, math, raw HTML, and highlighted code together', async () => {
    const text = `${DIAGRAM}\n<kbd>Ctrl</kbd>\n\n$$\nx^2\n$$\n\n\`\`\`typescript\nconst value = 1\n\`\`\`\n`
    renderDiagram(false, text)
    await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
    await vi.waitFor(() => expect(document.querySelector('kbd')?.textContent).toBe('Ctrl'))
    await vi.waitFor(() => expect(document.querySelector('.katex')).not.toBeNull())
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-language="typescript"] [style*="--shiki-dark"]'),
      ).not.toBeNull(),
    )
  }, 30_000)

  it('stays a code block while streaming, then renders once the message settles', async () => {
    renderDiagram(true)

    await vi.waitFor(() => expect(mermaidCodeBlock()).not.toBeNull())
    // Give a wrongly-triggered load time to land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(mermaidDiagram()).toBeNull()
    expect(loadedMermaid()).toBeNull()

    renderDiagram(false)

    await vi.waitFor(() => expect(loadedMermaid()).not.toBeNull(), { timeout: 15_000 })
    await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 10_000 })
    expect(mermaidCodeBlock()).toBeNull()
    expect(loadedMermaid()).not.toBeNull()
  }, 30_000)

  it('keeps code blocks after a failed load across diagram remounts', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')))
    setMermaidLoader(load)

    renderDiagram(false)

    await vi.waitFor(() => expect(mermaidCodeBlock()).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(mermaidCodeBlock()).not.toBeNull()
    expect(mermaidDiagram()).toBeNull()
    expect(loadedMermaid()).toBeNull()
    renderDiagram(false, '')
    expect(mermaidCodeBlock()).toBeNull()
    renderDiagram(false)
    await vi.waitFor(() => expect(mermaidCodeBlock()).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(load).toHaveBeenCalledTimes(1)
    expect(mermaidDiagram()).toBeNull()
  })
})
