import { createStringTextSnapshot } from '@singapore-editor/core/document'
import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestViewContributionContext } from '@singapore-editor/core/testing'

import { createHoverController } from '../src/hoverController'
import type { EditorHoverParticipant, HoverPart } from '../src/hoverParticipant'
import {
  HOVER_ASYNC_DISPATCH_DELAY_MS,
  HOVER_LOADING_DELAY_MS,
  HOVER_REQUEST_DEBOUNCE_MS,
} from '../src/tooltip'

const TEXT = 'const value = 1'

describe('one hover per view', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('paints every participant in one surface, lowest ordinal first', async () => {
    vi.useFakeTimers()
    const server: EditorHoverParticipant = {
      computeAsync: async (request, emit) => {
        emit([{ ordinal: 1, range: request.anchor.range, markdown: 'from the server' }])
      },
    }
    const characters: EditorHoverParticipant = {
      computeSync: (request) => [
        {
          ordinal: 5,
          range: request.anchor.range,
          markdown: 'about the character',
          actions: [{ label: 'Adjust settings', run: () => undefined }],
        },
      ],
    }
    const harness = mount([characters, server])

    harness.pointerMove()
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)

    expect(document.querySelectorAll('.editor-test-hover').length).toBe(1)
    expect(partTexts()).toEqual(['from the server', 'about the character'])
    expect(document.querySelector('.editor-test-hover-action')?.textContent).toBe('Adjust settings')
    harness.dispose()
  })

  it('runs every participant on the same clock', async () => {
    vi.useFakeTimers()
    const asyncStarted = vi.fn()
    const syncAsked = vi.fn()
    const server: EditorHoverParticipant = {
      computeAsync: async (request, emit) => {
        asyncStarted()
        emit([{ ordinal: 1, range: request.anchor.range, markdown: 'server' }])
      },
    }
    const marker: EditorHoverParticipant = {
      computeSync: (request) => {
        syncAsked()
        return [{ ordinal: 2, range: request.anchor.range, markdown: 'marker' }]
      },
    }
    const harness = mount([server, marker])

    harness.pointerMove()
    await vi.advanceTimersByTimeAsync(HOVER_ASYNC_DISPATCH_DELAY_MS - 1)
    expect(asyncStarted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(asyncStarted).toHaveBeenCalledOnce()
    expect(syncAsked).not.toHaveBeenCalled()
    expect(tooltip().hidden).toBe(true)

    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS - HOVER_ASYNC_DISPATCH_DELAY_MS)
    expect(syncAsked).toHaveBeenCalledOnce()
    expect(tooltip().hidden).toBe(false)
    expect(partTexts()).toEqual(['server', 'marker'])
    harness.dispose()
  })

  it('shows a loading row only while an async participant is still working', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const slow: EditorHoverParticipant = {
      computeAsync: (request, emit) =>
        new Promise<void>((resolve) => {
          finish = () => {
            emit([{ ordinal: 1, range: request.anchor.range, markdown: 'late' }])
            resolve()
          }
        }),
    }
    const harness = mount([slow])

    harness.pointerMove()
    await vi.advanceTimersByTimeAsync(HOVER_LOADING_DELAY_MS - 1)
    expect(tooltip().hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(tooltip().textContent).toContain('Loading…')

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(tooltip().textContent).not.toContain('Loading…')
    expect(partTexts()).toEqual(['late'])
    harness.dispose()
  })

  it('aborts the participants the moment the pointer moves to another word', async () => {
    vi.useFakeTimers()
    const aborted: boolean[] = []
    const server: EditorHoverParticipant = {
      computeAsync: (request) =>
        new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => {
            aborted.push(true)
            resolve()
          })
        }),
    }
    const harness = mount([server])

    harness.pointerMove(6)
    await vi.advanceTimersByTimeAsync(HOVER_ASYNC_DISPATCH_DELAY_MS)
    harness.pointerMove(14)
    expect(aborted).toEqual([true])
    harness.dispose()
  })

  it('shows nothing when no participant has anything to say', async () => {
    vi.useFakeTimers()
    const harness = mount([{ computeSync: () => [] }])

    harness.pointerMove()
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)
    expect(tooltip().hidden).toBe(true)
    harness.dispose()
  })

  it('summons the hover from the keyboard at once and focuses it', () => {
    const harness = mount([
      { computeSync: (request) => [part(request.anchor.range, 'keyboard answer')] },
    ])

    expect(harness.controller.showAtOffset(6, { focus: true })).toBe(true)
    expect(partTexts()).toEqual(['keyboard answer'])
    expect((document.activeElement as HTMLElement | null)?.dataset.hoverPartIndex).toBe('0')
    harness.dispose()
  })
})

function part(range: HoverPart['range'], markdown: string): HoverPart {
  return { ordinal: 1, range, markdown }
}

function mount(participants: readonly EditorHoverParticipant[]) {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => new DOMRect(0, 0, 900, 700)
  document.body.append(element)
  let pointerOffset = 6
  const snapshot = {
    documentId: 'index.ts',
    languageId: 'typescript',
    textSnapshot: createStringTextSnapshot(TEXT),
    textVersion: 1,
    tokens: [],
    selections: [{ anchorOffset: 6, headOffset: 6, startOffset: 6, endOffset: 6 }],
  } as unknown as EditorViewSnapshot
  const context = createTestViewContributionContext({
    container: element,
    scrollElement: element,
    contentElement: element,
    hasDocument: () => true,
    getSnapshot: () => snapshot,
    getProviders: (() => participants) as EditorViewContributionContext['getProviders'],
    focusEditor: vi.fn(),
    rowAtPoint: () => null,
    markerAtPoint: () => null,
    textOffsetFromPoint: () => pointerOffset,
    getRangeClientRect: () => new DOMRect(10, 20, 40, 18),
  })
  const controller = createHoverController({ context, classNamespace: 'test' })
  return {
    controller,
    pointerMove: (offset = 6) => {
      pointerOffset = offset
      element.dispatchEvent(
        new PointerEvent('pointermove', { buttons: 0, clientX: 40, clientY: 60 }),
      )
    },
    dispose: () => controller.dispose(),
  }
}

function tooltip(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.editor-test-hover')
  if (!element) throw new Error('missing tooltip')
  return element
}

function partTexts(): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-hover-part-index]'), (item) =>
    (item.textContent ?? '').trim(),
  )
}
