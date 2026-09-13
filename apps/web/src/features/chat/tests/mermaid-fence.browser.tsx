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

function renderDiagram(streaming: boolean) {
  flushSync(() => {
    root?.render(
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>
          <ChatWorkspaceRootContext value={null}>
            <AssistantMarkdown streaming={streaming} text={DIAGRAM} />
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
  return document.querySelector('[data-markdown="mermaid-block"] svg')
}

describe('mermaid fences', () => {
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

  it('keeps the code block when the plugin fails to load', async () => {
    setMermaidLoader(() => Promise.reject(new Error('offline')))

    renderDiagram(false)

    await vi.waitFor(() => expect(mermaidCodeBlock()).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(mermaidCodeBlock()).not.toBeNull()
    expect(mermaidDiagram()).toBeNull()
    expect(loadedMermaid()).toBeNull()
  })
})
