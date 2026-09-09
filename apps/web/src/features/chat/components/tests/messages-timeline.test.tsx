import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { fireEvent, screen } from '@testing-library/react'
import {
  messageIdSchema,
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  type OrchestrationMessage,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, beforeEach } from 'vitest'

import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { MessagesTimeline } from '@/features/chat/components/messages-timeline'
import { ChatTimelineActionsProvider } from '@/features/chat/providers/timeline-actions-provider'
import { type ChatSession } from '@workspace/client-core/chat/types'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { TIMELINE_ANCHOR_OFFSET_PX } from '@/features/chat/utils/timeline-scroll-anchoring'
import { expect, test } from '../../../../../test/fixtures'
import { chatMessage, session as sessionFactory } from '../../../../../test/factories/chat'
import { renderWithProviders } from '../../../../../test/render'

const VIEWPORT_HEIGHT = 600
const ROW_HEIGHT = 80

// happy-dom has no layout engine, so the handful of numbers the scroll decisions
// read are stubbed. Everything else — the virtualizer, the listeners, the
// follow-mode machine — is the real thing.
let clientHeight = VIEWPORT_HEIGHT
// Null means "derive it from the virtualized content", which is what a real
// scroll container does; the gesture tests override it to fake a long history.
let scrollHeightOverride: number | null = null

// happy-dom declares each of these on a different prototype in the chain, and
// the nearer one wins, so they have to be replaced where they actually live.
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
const originalRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')

beforeEach(() => {
  clientHeight = VIEWPORT_HEIGHT
  scrollHeightOverride = null
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })
  // The virtualizer sizes its scroll box from offsetHeight, and renders nothing
  // at all while that is zero.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? ROW_HEIGHT : clientHeight
    },
  })
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      if (scrollHeightOverride !== null) return scrollHeightOverride

      return virtualContentHeight(this)
    },
  })
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      // Virtualized rows report a fixed height; everything else is viewport
      // sized, which is what the virtualizer measures its scroll box against.
      return stubRect(this.hasAttribute('data-index') ? ROW_HEIGHT : clientHeight)
    },
    writable: true,
  })
})

afterEach(() => {
  restoreLayoutProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  restoreLayoutProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  restoreLayoutProperty(Element.prototype, 'scrollHeight', originalScrollHeight)
  restoreLayoutProperty(Element.prototype, 'getBoundingClientRect', originalRect)
})

test('the jump-to-latest control stays out of the way while the transcript follows', () => {
  renderTimeline([userMessage('u1', 'First question')])

  expect(screen.getByText('First question')).toBeInTheDocument()
  expect(jumpToLatest()).toHaveClass('opacity-0')
})

test('scrolling up mid-stream stops the transcript following', () => {
  renderTimeline([userMessage('u1', 'First question')])
  scrollHeightOverride = 4000

  fireEvent.wheel(transcript(), { deltaY: -140 })

  expect(jumpToLatest()).not.toHaveClass('opacity-0')
})

test('an upward wheel with nothing above to read keeps following', () => {
  renderTimeline([userMessage('u1', 'First question')])
  scrollHeightOverride = VIEWPORT_HEIGHT - 40

  fireEvent.wheel(transcript(), { deltaY: -140 })

  expect(jumpToLatest()).toHaveClass('opacity-0')
})

test('wheeling down toward the live edge is not a navigation gesture', () => {
  renderTimeline([userMessage('u1', 'First question')])
  scrollHeightOverride = 4000

  fireEvent.wheel(transcript(), { deltaY: 140 })

  expect(jumpToLatest()).toHaveClass('opacity-0')
})

test('jumping to the latest message re-arms follow', () => {
  renderTimeline([userMessage('u1', 'First question')])
  scrollHeightOverride = 4000
  fireEvent.wheel(transcript(), { deltaY: -140 })

  fireEvent.click(jumpToLatest())

  expect(jumpToLatest()).toHaveClass('opacity-0')
})

test('sending a message reserves room so it can sit at the top', () => {
  const { rerender } = renderTimeline([userMessage('u1', 'First question')])
  // An opened session reserves nothing: its content ends where its last row does.
  expect(contentHeight()).toBeLessThan(2 * ROW_HEIGHT)

  rerender(timelineOf([userMessage('u1', 'First question'), userMessage('u2', 'Second question')]))

  // The sent message now has a viewport's worth of space beneath it to park
  // against — a transcript that pinned to the bottom would reserve nothing.
  expect(contentHeight()).toBeGreaterThan(VIEWPORT_HEIGHT)
})

test('sending a message parks it at the top instead of pinning to the bottom', () => {
  const history = conversation(13)
  const { rerender } = renderTimeline(history)
  fireEvent.scroll(transcript())
  // An opened session sits at the live edge: its last row is down at the bottom.
  expect(rowOffsetInViewport(history.length - 1)).toBeGreaterThan(VIEWPORT_HEIGHT / 2)

  const sent = [...history, userMessage('u14', 'Fourteenth question')]
  rerender(timelineOf(sent))
  fireEvent.scroll(transcript())

  expect(rowOffsetInViewport(sent.length - 1)).toBe(TIMELINE_ANCHOR_OFFSET_PX)
})

test('a reader who walks back to the top is offered the history behind it', () => {
  const history = conversation(3)
  seedSessionWindow(history, ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
  renderTimeline(history)
  scrollHeightOverride = 4000

  fireEvent.wheel(transcript(), { deltaY: -140 })

  expect(screen.getByRole('button', { name: 'Load earlier' })).toBeVisible()
})

test('a transcript pinned to the live edge offers nothing to load', () => {
  // There is history behind it, but the reader is at the newest message and an
  // affordance floating over a streaming answer is noise.
  const history = conversation(3)
  seedSessionWindow(history, ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
  renderTimeline(history)

  expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument()
})

test('a session the server sent whole offers nothing even at the top', () => {
  const history = conversation(3)
  // A short window is proof there is nothing earlier, unlike a full one.
  seedSessionWindow(history, 3)
  renderTimeline(history)
  scrollHeightOverride = 4000

  fireEvent.wheel(transcript(), { deltaY: -140 })

  expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument()
})

test('the turn rail appears only once there is a transcript to navigate', () => {
  const { rerender } = renderTimeline(conversation(3))
  // A rail beside three messages is noise: they are one flick apart.
  expect(screen.queryByRole('navigation', { name: 'Turns' })).not.toBeInTheDocument()

  rerender(timelineOf(conversation(13)))

  expect(minimapMarks()).toHaveLength(13)
})

test('the rail says which turn the viewport is over', () => {
  renderTimeline(conversation(13))

  fireEvent.click(minimapMark(1, 13))
  fireEvent.scroll(transcript())

  expect(minimapMarks().filter((mark) => mark.getAttribute('aria-current') === 'true')).toEqual([
    minimapMark(1, 13),
  ])
})

test('jumping to a turn parks it at the top and stops following', () => {
  renderTimeline(conversation(13))

  fireEvent.click(minimapMark(5, 13))
  fireEvent.scroll(transcript())

  expect(rowOffsetInViewport(4)).toBe(TIMELINE_ANCHOR_OFFSET_PX)
  // A jump is navigation: the transcript must not yank back to the live edge.
  expect(jumpToLatest()).not.toHaveClass('opacity-0')
})

test('the rail is walkable by keyboard, one tab stop for the whole map', () => {
  renderTimeline(conversation(13))
  const first = minimapMark(1, 13)
  first.focus()

  fireEvent.keyDown(first, { key: 'ArrowDown' })

  expect(document.activeElement).toBe(minimapMark(2, 13))
  expect(minimapMark(2, 13)).toHaveAttribute('tabindex', '0')
  expect(minimapMark(1, 13)).toHaveAttribute('tabindex', '-1')
})

function minimapMarks() {
  return screen.getAllByRole('button', { name: /^Jump to turn / })
}

function minimapMark(ordinal: number, total: number) {
  return screen.getByRole('button', { name: `Jump to turn ${ordinal} of ${total}` })
}

function seedSessionWindow(messages: readonly OrchestrationMessage[], windowSize: number) {
  const session = sessionFactory({ latestTurn: null, messages: [...messages] })

  useChatProjectionStore.getState().resetChatProjection()
  useChatProjectionStore.getState().syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: {
      deletion: null,
      ...session,
      deletedAt: null,
      // The window the server actually shipped, which is the only truncation
      // signal a detail snapshot carries.
      messages: Array.from({ length: windowSize }, (_unused, index) =>
        userMessage(`w${index}`, `Windowed ${index}`),
      ),
    },
  })
}

function transcript() {
  return screen.getByRole('log', { name: 'Messages' })
}

/**
 * Where a virtualized row's top sits relative to the viewport top, in pixels.
 * Rows stack in flow inside one translated window, so a row's content offset is
 * the window's translation plus the rows rendered above it — every row is
 * `ROW_HEIGHT` tall here.
 */
function rowOffsetInViewport(index: number) {
  const row = transcript().querySelector(`[data-index="${index}"]`)
  if (!(row instanceof HTMLElement)) return null

  const window = row.parentElement
  if (!window) return null

  const translated = /translateY\((-?[\d.]+)px\)/.exec(window.style.transform)
  if (!translated?.[1]) return null

  const rowsAbove = [...window.children].indexOf(row)

  return Number.parseFloat(translated[1]) + rowsAbove * ROW_HEIGHT - transcript().scrollTop
}

function virtualContentHeight(element: Element) {
  const content = element.firstElementChild
  if (!(content instanceof HTMLElement)) return 0

  return Number.parseFloat(content.style.height) || 0
}

function conversation(count: number) {
  return Array.from({ length: count }, (_unused, index) =>
    userMessage(`u${index + 1}`, `Question ${index + 1}`),
  )
}

function jumpToLatest() {
  return screen.getByRole('button', { name: 'Scroll to latest message' })
}

function contentHeight() {
  return virtualContentHeight(transcript())
}

function userMessage(id: string, text: string): OrchestrationMessage {
  const ordinal = Number.parseInt(id.slice(1), 10)

  return chatMessage({
    createdAt: new Date(Date.UTC(2026, 4, 28, 0, 0, ordinal)).toISOString(),
    id: v.parse(messageIdSchema, id),
    role: 'user',
    text,
  })
}

function timelineOf(messages: readonly OrchestrationMessage[]) {
  const session: ChatSession = sessionFactory({
    latestTurn: null,
    messages: [...messages],
  })

  // Message rows reach for the editor stores through their real providers, so
  // the timeline is mounted under the same ones the app gives it.
  return (
    <EditorStateProvider>
      <ChatTransportContext value={unsupportedChatTransport()}>
        <ChatTimelineActionsProvider revertToCheckpoint={() => {}}>
          <MessagesTimeline optimisticMessages={[]} session={session} />
        </ChatTimelineActionsProvider>
      </ChatTransportContext>
    </EditorStateProvider>
  )
}

function renderTimeline(messages: readonly OrchestrationMessage[]) {
  return renderWithProviders(timelineOf(messages))
}

function stubRect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 800,
    toJSON: () => ({}),
    top: 0,
    width: 800,
    x: 0,
    y: 0,
  }
}

function restoreLayoutProperty(
  target: object,
  name: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (!descriptor) {
    Reflect.deleteProperty(target, name)
    return
  }

  Object.defineProperty(target, name, descriptor)
}
