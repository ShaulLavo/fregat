import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatAttachment } from '@workspace/contracts'
import type { ReactNode } from 'react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { ChatAttachmentThumbnails } from '@/features/chat/components/chat-attachment-thumbnails'
import { MessageBubble } from '@/features/chat/components/message-bubble'
import {
  ChatTimelineActionsContext,
  type ChatTimelineActions,
} from '@/features/chat/providers/timeline-actions-context'
import { createTestApplicationRuntime } from '../../../../../test/factories/application-runtime'
import { chatMessage } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const LONG_USER_TEXT = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')

test('a user message renders markdown instead of raw text', () => {
  const { container } = renderBubble(
    chatMessage({
      role: 'user',
      text: 'Try this:\n\n```ts\nconst a = 1\n```\n\n- first\n- second',
    }),
  )

  expect(container.querySelector('[data-markdown="code-block"]')).not.toBeNull()
  expect(container.querySelector('ul')).not.toBeNull()
  expect(container.textContent).not.toContain('```')
})

test('a long user message collapses until it is expanded', async () => {
  const user = userEvent.setup()
  const { container, getByRole } = renderBubble(chatMessage({ role: 'user', text: LONG_USER_TEXT }))

  expect(userMessageBody(container)?.dataset.userMessageCollapsed).toBe('true')

  await user.click(getByRole('button', { name: 'Show full message' }))

  expect(userMessageBody(container)?.dataset.userMessageCollapsed).toBe('false')
  expect(getByRole('button', { name: 'Show less' })).toBeInTheDocument()
})

test('a short user message is never collapsible', () => {
  const { container } = renderBubble(chatMessage({ role: 'user', text: 'ship it' }))

  expect(userMessageBody(container)?.dataset.userMessageCollapsible).toBe('false')
})

test('attached terminal output renders as a chip, never as raw markup', () => {
  const { container } = renderBubble(
    chatMessage({
      role: 'user',
      text: 'Why is this failing?\n\n<terminal_context>\n<selection source="terminal-1" lines="810-812">\nmake: *** [build] Error 1\n</selection>\n</terminal_context>',
    }),
  )

  expect(container.textContent).not.toContain('<terminal_context>')
  expect(container.textContent).not.toContain('<selection')
  expect(userMessageBody(container)?.textContent).toContain('Why is this failing?')
  expect(container.querySelector('[data-terminal-context-source="terminal-1"]')).not.toBeNull()
  expect(container.textContent).toContain('lines 810-812')
})

test('a capture sent with no prompt still renders its chip', () => {
  const { container } = renderBubble(
    chatMessage({
      role: 'user',
      text: '<terminal_context>\n<selection source="terminal-1" lines="42">\nsegfault\n</selection>\n</terminal_context>',
    }),
  )

  expect(userMessageBody(container)).toBeNull()
  expect(container.querySelector('[data-terminal-context-source="terminal-1"]')).not.toBeNull()
  expect(container.textContent).toContain('line 42')
})

test('only the terminal assistant message shows its metadata row', () => {
  const shown = renderBubble(chatMessage({ text: 'Done.' }), { showAssistantCopyButton: true })
  expect(shown.container.querySelector('[data-assistant-message-meta]')).not.toBeNull()

  shown.unmount()
  const hidden = renderBubble(chatMessage({ text: 'Still working.' }))
  expect(hidden.container.querySelector('[data-assistant-message-meta]')).toBeNull()
})

test('message metadata stays available to keyboard focus and touch while hiding hover-only chrome', async () => {
  const { container } = renderBubble(chatMessage({ text: 'Done.' }), {
    renderAssistantCopyButton: (text) => <button type='button'>{`Copy ${text}`}</button>,
    showAssistantCopyButton: true,
  })

  const actions = container.querySelector<HTMLElement>('[data-assistant-copy-actions]')
  const metadata = container.querySelector<HTMLElement>('[data-assistant-message-meta]')

  expect(actions).not.toBeNull()
  expect(actions?.querySelector('button')?.textContent).toBe('Copy Done.')
  expect(metadata).toHaveClass('[@media(hover:hover)]:pointer-events-none')
  expect(metadata).toHaveClass('[@media(hover:hover)]:opacity-0')
  expect(metadata).toHaveClass('group-focus-within/message:opacity-100')
  expect(metadata).toHaveClass('group-focus-within/message:pointer-events-auto')
  expect(metadata).toHaveClass('group-hover/message:pointer-events-auto')
  expect(metadata).not.toHaveClass('opacity-0')

  await userEvent.tab()

  expect(screen.getByRole('button', { name: 'Copy Done.' })).toHaveFocus()
})

test('user timestamps use the same hover and focus disclosure as assistant metadata', () => {
  const { container } = renderBubble(chatMessage({ role: 'user', text: 'ship it' }))
  const metadata = container.querySelector<HTMLElement>('[data-user-message-meta]')

  expect(metadata).toHaveClass('[@media(hover:hover)]:opacity-0')
  expect(metadata).toHaveClass('group-focus-within/message:opacity-100')
  expect(metadata).toHaveClass('group-hover/message:opacity-100')
  expect(metadata).not.toHaveClass('opacity-0')
})

test('a sent image renders as a thumbnail and opens in a lightbox', async () => {
  const user = userEvent.setup()
  const { container } = renderBubble(
    chatMessage({
      attachments: [
        imageAttachment('image-1', 'shot.png'),
        imageAttachment('image-2', 'diagram.png'),
      ],
      role: 'user',
      text: 'look at these',
    }),
  )

  const thumbnail = container.querySelector<HTMLImageElement>('[data-chat-attachments] img')
  expect(thumbnail?.getAttribute('src')).toContain('/attachments/image-1.png')

  await user.click(screen.getByRole('button', { name: 'Open shot.png' }))

  const full = await screen.findByAltText('shot.png')
  expect(full.getAttribute('src')).toContain('/attachments/image-1.png')

  await user.click(screen.getByRole('button', { name: 'Next image' }))

  expect(await screen.findByAltText('diagram.png')).toBeInTheDocument()
})

test('attachment URLs stay with the transcript query client after an active environment switch', () => {
  const ownerOrigin = activeServerOrigin()
  const queryClient = createTestQueryClient()
  const application = createTestApplicationRuntime()
  setActiveServerOrigin('http://other-machine.test')
  try {
    const { container } = renderWithProviders(
      <ChatAttachmentThumbnails attachments={[imageAttachment('owned-image', 'owned.png')]} />,
      { application, queryClient },
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `${ownerOrigin}/attachments/owned-image.png`,
    )
  } finally {
    setActiveServerOrigin(ownerOrigin)
  }
})

test('an image type the server never stored falls back to its file name', () => {
  const { container } = renderBubble(
    chatMessage({
      attachments: [imageAttachment('image-3', 'vector.svg', 'image/svg+xml')],
      role: 'user',
      text: 'this one',
    }),
  )

  expect(container.querySelector('[data-chat-attachments] img')).toBeNull()
  expect(container.textContent).toContain('vector.svg')
})

function imageAttachment(id: string, name: string, mimeType = 'image/png'): ChatAttachment {
  return { id, mimeType, name, sizeBytes: 2_048, type: 'image' }
}

function userMessageBody(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-user-message-body]')
}

function renderBubble(
  message: ReturnType<typeof chatMessage>,
  {
    renderAssistantCopyButton,
    showAssistantCopyButton = false,
  }: {
    renderAssistantCopyButton?: (text: string) => ReactNode
    showAssistantCopyButton?: boolean
  } = {},
) {
  return renderWithProviders(
    withProviders(
      <MessageBubble
        message={message}
        renderAssistantCopyButton={renderAssistantCopyButton}
        showAssistantCopyButton={showAssistantCopyButton}
      />,
    ),
  )
}

function withProviders(children: ReactNode) {
  const actions: ChatTimelineActions = {
    openCheckpointDiff: () => undefined,
    openSessionCheckpointDiff: () => undefined,
    revertToCheckpoint: () => undefined,
  }

  return (
    <EditorStateProvider>
      <ChatTimelineActionsContext value={actions}>{children}</ChatTimelineActionsContext>
    </EditorStateProvider>
  )
}
