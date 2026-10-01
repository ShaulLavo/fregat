import { commands, page } from 'vitest/browser'
import type { QueryClient } from '@tanstack/react-query'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import '@workspace/ui/globals.css'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { settingsSnapshot } from '../../../../test/factories/settings'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import { AssistantMarkdown } from '../components/assistant-markdown'
import { ChatWorkspaceRootContext } from '../providers/workspace-root-context'
import { loadedMermaid, setMermaidLoader } from '../state/mermaid'
import delayedFontUrl from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url'

// Registered in `vitest.browser.config.ts` under `browser.commands`, which carries no types.
declare module 'vitest/browser' {
  interface BrowserCommands {
    delayRequest: (input: { readonly ms: number; readonly path: string }) => Promise<void>
  }
}

const DIAGRAM = 'A graph:\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n'

let root: Root | null = null
let queryClient: QueryClient

beforeEach(() => {
  queryClient = createTestQueryClient()
  // A settings document fetched mid-test makes AppearanceProvider rewrite the `--font-ui` these
  // tests set, so the diagram reverts to the default face.
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot())
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

  it.each([
    ['measures with the selected face while it downloads', 1000, 'loaded'],
    ['gives up on a face that is still downloading', 5000, 'loading'],
  ])(
    '%s',
    async (_name, delayMs, status) => {
      // A face no text has used yet starts loading only when the diagram measures with it.
      const path = `${delayedFontUrl}?first-paint-${delayMs}`
      await commands.delayRequest({ ms: delayMs, path })
      const face = new FontFace('FirstPaintDiagramFace', `url(${JSON.stringify(path)})`)
      const chart = '```mermaid\nflowchart TD\n A[MMMMMMMMMMMMM] --> B[End]\n```'
      // Mounting the providers applies the settings' `--font-ui`, so the face is chosen after.
      renderDiagram(true, chart)
      await vi.waitFor(() => expect(mermaidCodeBlock()).not.toBeNull())
      document.fonts.add(face)
      document.documentElement.style.setProperty('--font-ui', 'FirstPaintDiagramFace, serif')
      try {
        renderDiagram(false, chart)
        await vi.waitFor(() => expect(mermaidDiagram()).not.toBeNull(), { timeout: 15_000 })
        expect(face.status).toBe(status)
        if (status !== 'loaded') return

        const first = mermaidDiagram()!.getAttribute('viewBox')
        await document.fonts.ready
        await new Promise((resolve) => setTimeout(resolve, 300))
        expect(mermaidDiagram()!.getAttribute('viewBox')).toBe(first)
      } finally {
        // A load still in flight would remeasure diagrams in later tests.
        await face.load().catch(() => {})
        document.documentElement.style.removeProperty('--font-ui')
        document.fonts.delete(face)
      }
    },
    30_000,
  )

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
        document.querySelector('[data-language="typescript"] span[style*="color"]'),
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
