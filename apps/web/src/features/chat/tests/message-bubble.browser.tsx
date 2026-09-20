import type { QueryClient } from '@tanstack/react-query'
import type { OrchestrationMessage } from '@workspace/contracts'
import '@workspace/ui/globals.css'
import { useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import {
  ChatTimelineActionsContext,
  type ChatTimelineActions,
} from '@/features/chat/providers/timeline-actions-context'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { MessageBubble } from '@/features/chat/components/message-bubble'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { activeServerOrigin } from '@/lib/client'

// Token colours from Dark Plus, the default dark editor theme, which the app
// loads as a real VS Code theme through shiki. What these assertions are for is
// that tokens get *theme* colours rather than the plain editor foreground
// (#D4D4D4) — so they move if the default dark theme ever changes.
const EXPECTED_DARK_EDITOR_COLORS = [
  'rgb(86, 156, 214)', // #569CD6 — tag names and keywords
  'rgb(206, 145, 120)', // #CE9178 — strings
  'rgb(220, 220, 170)', // #DCDCAA — functions
]
const EXPECTED_DARK_EDITOR_PROPERTY_COLOR = 'rgb(156, 220, 254)' // #9CDCFE
const EXPECTED_DARK_EDITOR_TYPE_COLOR = 'rgb(86, 156, 214)' // #569CD6

let root: Root | null = null
let queryClient: QueryClient
let transport: ReturnType<typeof createChatTransport>

beforeEach(() => {
  queryClient = createTestQueryClient()
  transport = createChatTransport(activeServerOrigin())
  // Dark is what every colour assertion below is written against, and it is a
  // setting now rather than a prop — the mirror is where the app reads it.
  seedBootMirrorTheme('dark')
})

afterEach(() => {
  if (root) {
    flushSync(() => root?.unmount())
    root = null
  }

  document.body.innerHTML = ''
  queryClient.clear()
  transport.close()
  localStorage.clear()
})

describe('MessageBubble browser rendering', () => {
  it('highlights streamed code while the fence is still open', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble
              message={{
                ...assistantCodeMessage,
                streaming: true,
                text: 'Streaming code:\n\n```html\n<!doctype html>\n<html',
              }}
            />,
          )}
        </AppProviders>,
      )
    })

    await vi.waitFor(() => {
      expect(markdownCodeBlock()?.dataset.incomplete).toBe('true')
      expect(markdownCodeText()).toContain('<!doctype html>')
      // Completed lines are coloured immediately; only the half-typed trailing
      // line stays plain until its newline lands.
      expect(markdownTokenSpans().length).toBeGreaterThan(0)
      expect(markdownCodeText()).toContain('<html')
    })
  })

  it('keeps assistant code highlighting after streaming completion', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(<StreamingMessageBubble />)}
        </AppProviders>,
      )
    })

    await vi.waitFor(
      () => {
        const palette = markdownCodePalette()
        if (!palette) throw new Error('Markdown code tokens did not render')

        expect(markdownCodeLanguage()).toBe('html')
        expect(markdownCodeText()).toContain('<!doctype html>')
        expect(markdownCodeText()).toContain('--bg')
        expect(markdownCodeBlockStyle()?.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(markdownCodeBlockStyle()?.borderTopWidth).toBe('0px')
        expect(markdownCodeBlockBodyStyle()?.borderTopWidth).toBe('0px')
        expect(palette.tokenCount).toBeGreaterThan(4)
        expect(palette.colors.size).toBeGreaterThan(2)
        expect(EXPECTED_DARK_EDITOR_COLORS.some((color) => palette.colors.has(color))).toBe(true)
        expect(markdownTokenColor((text) => text.trim() === 'head')).toBe(
          EXPECTED_DARK_EDITOR_TYPE_COLOR,
        )
        // The custom property and its colon are separate tokens, so match the
        // property alone — no span ever holds `--bg:`.
        expect(markdownTokenColor((text) => text.trim() === '--bg')).toBe(
          EXPECTED_DARK_EDITOR_PROPERTY_COLOR,
        )
      },
      // Under the test timeout on purpose: matched, waitFor never gets to
      // report which assertion was still failing and the run says only
      // "timed out".
      { interval: 100, timeout: 10_000 },
    )
  })

  it('renders assistant changed files below assistant markdown', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble
              message={{
                ...assistantCodeMessage,
                text: 'Changed these files:',
              }}
              turnDiffSummary={assistantChangedFilesSummary}
            />,
          )}
        </AppProviders>,
      )
    })

    await vi.waitFor(() => {
      const bodyText = document.body.textContent ?? ''
      expect(bodyText).toContain('3 changed files')
      expect(bodyText).toContain('+20')
      expect(bodyText).toContain('-4')
      expect(bodyText).toContain('message-bubble.tsx')
      expect(bodyText).toContain('timeline-items.ts')
      expect(bodyText.indexOf('Changed these files:')).toBeLessThan(
        bodyText.indexOf('3 changed files'),
      )
    })
  })

  it('preserves assistant prose line breaks between markdown blocks', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble
              message={{
                ...assistantCodeMessage,
                text: 'First line\nsecond line\n\nNext paragraph\nwith detail',
              }}
            />,
          )}
        </AppProviders>,
      )
    })

    await vi.waitFor(() => {
      const paragraphs = assistantMarkdownParagraphs()

      expect(paragraphs).toHaveLength(2)
      expect(paragraphs[0]?.textContent).toBe('First line\nsecond line')
      expect(paragraphs[1]?.textContent).toBe('Next paragraph\nwith detail')
      expect(
        paragraphs.every((paragraph) => getComputedStyle(paragraph).whiteSpace === 'pre-wrap'),
      ).toBe(true)
    })
  })

  it('opens historical checkpoint diffs from changed-file actions', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)
    const openCheckpointDiff = vi.fn(() => Promise.resolve())
    const actions = chatTimelineActions({ openCheckpointDiff })

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble
              message={{
                ...assistantCodeMessage,
                text: 'Changed these files:',
              }}
              turnDiffSummary={assistantChangedFilesSummary}
            />,
            actions,
          )}
        </AppProviders>,
      )
    })

    await expect.poll(() => buttonByText('View diff')).not.toBeNull()
    viewDiffButton().click()
    await vi.waitFor(() => {
      expect(openCheckpointDiff).toHaveBeenCalledWith(assistantChangedFilesSummary, undefined)
    })

    changedFileButton('src/features/chat/utils/timeline-items.ts').click()
    await vi.waitFor(() => {
      expect(openCheckpointDiff).toHaveBeenCalledWith(
        assistantChangedFilesSummary,
        'src/features/chat/utils/timeline-items.ts',
      )
    })
  })

  it('renders checkpoint status without broken diff actions', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble
              message={{
                ...assistantCodeMessage,
                text: 'Changed these files:',
              }}
              turnDiffSummary={{
                ...assistantChangedFilesSummary,
                status: 'missing',
              }}
            />,
          )}
        </AppProviders>,
      )
    })

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Checkpoint missing')
      expect(buttonByText('View diff')).toBeNull()
      expect(changedFileButtonOrNull('src/features/chat/utils/timeline-items.ts')).toBeNull()
    })
  })

  it('dispatches user-row checkpoint revert actions', async () => {
    const container = document.createElement('main')
    container.style.width = '720px'
    document.body.append(container)
    root = createRoot(container)
    const revertToCheckpoint = vi.fn()
    const actions = chatTimelineActions({ revertToCheckpoint })

    flushSync(() => {
      root?.render(
        <AppProviders queryClient={queryClient}>
          {withChatTimelineActions(
            <MessageBubble message={userMessage} revertTurnCount={2} />,
            actions,
          )}
        </AppProviders>,
      )
    })

    await vi.waitFor(() => expect(revertButton()).toBeVisible())
    revertButton().click()
    await vi.waitFor(() => {
      expect(revertToCheckpoint).toHaveBeenCalledWith(2, expect.any(String))
    })
  })
})

function withChatTimelineActions(
  children: ReactNode,
  actions: ChatTimelineActions = chatTimelineActions(),
) {
  return (
    <EditorStateProvider>
      <ChatTransportContext value={transport}>
        <ChatTimelineActionsContext value={actions}>{children}</ChatTimelineActionsContext>
      </ChatTransportContext>
    </EditorStateProvider>
  )
}

function chatTimelineActions(overrides: Partial<ChatTimelineActions> = {}): ChatTimelineActions {
  return {
    openCheckpointDiff: vi.fn(() => Promise.resolve()),
    openSessionCheckpointDiff: vi.fn(() => Promise.resolve()),
    revertToCheckpoint: vi.fn(),
    ...overrides,
  }
}

const streamingAssistantChunks = [
  'Here is an HTML helper:',
  '\n\n```html',
  '<!doctype html>',
  '\n<html lang="en">',
  '\n<head>',
  '\n<style>',
  '\n:root {',
  '\n  --bg: #111000;',
  '\n  --panel: var(--bg);',
  '\n}',
  '\n</style>',
  '\n</head>',
  '\n</html>',
  '\n```',
] as const

function StreamingMessageBubble() {
  const [text, setText] = useState<string>(streamingAssistantChunks[0])
  const [streaming, setStreaming] = useState(true)

  useEffect(() => {
    const timers = streamingAssistantChunks.slice(1).map((chunk, index) =>
      window.setTimeout(() => {
        setText((currentText) => `${currentText}${chunk}`)
      }, index + 1),
    )
    const completeTimer = window.setTimeout(
      () => setStreaming(false),
      streamingAssistantChunks.length + 2,
    )

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      window.clearTimeout(completeTimer)
    }
  }, [])

  return <MessageBubble message={{ ...assistantCodeMessage, streaming, text }} />
}

const assistantCodeMessage = {
  attachments: [],
  createdAt: '2026-05-28T00:00:00.000Z',
  id: 'message-browser-assistant',
  role: 'assistant',
  streaming: false,
  text: [
    'Here is a typed helper:',
    '',
    '```ts',
    'const label: string = "hello"',
    'function greet(name: string) {',
    '  return `${label}, ${name}`',
    '}',
    '```',
  ].join('\n'),
  sessionId: 'f066fa5d-7f5a-513c-93f1-f7d8a348d59a',
  turnId: null,
  updatedAt: '2026-05-28T00:00:00.000Z',
} as unknown as OrchestrationMessage

const userMessage = {
  attachments: [],
  createdAt: '2026-05-28T00:00:00.000Z',
  id: 'message-browser-user',
  role: 'user',
  streaming: false,
  text: 'Please update the chat view.',
  sessionId: 'f066fa5d-7f5a-513c-93f1-f7d8a348d59a',
  turnId: 'turn-browser',
  updatedAt: '2026-05-28T00:00:00.000Z',
} as unknown as OrchestrationMessage

const assistantChangedFilesSummary = {
  assistantMessageId: 'message-browser-assistant',
  checkpointRef: 'checkpoint-browser',
  checkpointTurnCount: 1,
  completedAt: '2026-05-28T00:00:02.000Z',
  files: [
    {
      additions: 12,
      deletions: 4,
      kind: 'modified',
      path: 'src/features/chat/components/message-bubble.tsx',
    },
    {
      additions: 6,
      deletions: 0,
      kind: 'modified',
      path: 'src/features/chat/utils/timeline-items.ts',
    },
    {
      additions: 2,
      deletions: 0,
      kind: 'added',
      path: 'src/features/chat/utils/turn-diff-tree.ts',
    },
  ],
  status: 'ready',
  sessionId: 'f066fa5d-7f5a-513c-93f1-f7d8a348d59a',
  turnId: 'turn-browser',
} as ChatTurnDiffSummary

function markdownCodeLanguage() {
  return document
    .querySelector('[data-markdown="code-block-header"]')
    ?.textContent?.trim()
    .toLowerCase()
}

function markdownCodeText() {
  return document.querySelector('[data-markdown="code-block-body"]')?.textContent ?? ''
}

function markdownCodeBlockStyle() {
  const codeBlock = markdownCodeBlock()
  if (!(codeBlock instanceof HTMLElement)) return null

  return getComputedStyle(codeBlock)
}

function markdownCodeBlock() {
  const codeBlock = document.querySelector('[data-markdown="code-block"]')
  if (!(codeBlock instanceof HTMLElement)) return null

  return codeBlock
}

function assistantMarkdownParagraphs() {
  const markdown = document.querySelector('article')?.firstElementChild
  if (!(markdown instanceof HTMLElement)) return []

  return Array.from(markdown.querySelectorAll('p')).filter(
    (paragraph): paragraph is HTMLParagraphElement => paragraph instanceof HTMLParagraphElement,
  )
}

function viewDiffButton() {
  const button = buttonByText('View diff')
  if (!button) throw new Error('View diff button not found')

  return button
}

function buttonByText(text: string) {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  )
}

function changedFileButton(path: string) {
  const button = changedFileButtonOrNull(path)
  if (!button) throw new Error(`Changed file button not found: ${path}`)

  return button
}

function changedFileButtonOrNull(path: string) {
  const button = document.querySelector(`button[title="${path}"]`)
  if (!(button instanceof HTMLButtonElement)) return null

  return button
}

function revertButton() {
  const button = document.querySelector(
    'button[aria-label="Revert to checkpoint before this turn"]',
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Revert button not found')
  }

  return button
}

function markdownCodeBlockBodyStyle() {
  const codeBlockBody = document.querySelector('[data-markdown="code-block-body"]')
  if (!(codeBlockBody instanceof HTMLElement)) return null

  return getComputedStyle(codeBlockBody)
}

function markdownCodePalette() {
  const tokenSpans = markdownTokenSpans()
  if (tokenSpans.length === 0) return null

  const colors = new Set(tokenSpans.map((span) => getComputedStyle(span).color).filter(Boolean))

  return {
    colors,
    tokenCount: tokenSpans.length,
  }
}

function markdownTokenColor(predicate: (text: string) => boolean) {
  const tokenSpan = markdownTokenSpans().find((span) => predicate(span.textContent ?? ''))
  return tokenSpan ? getComputedStyle(tokenSpan).color : null
}

function markdownTokenSpans() {
  const codeBlock = document.querySelector('[data-markdown="code-block-body"]')
  if (!(codeBlock instanceof HTMLElement)) return []

  return Array.from(codeBlock.querySelectorAll('span')).filter(isTokenSpan)
}

function isTokenSpan(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.style.getPropertyValue('--code-token-color').trim().length > 0
  )
}
