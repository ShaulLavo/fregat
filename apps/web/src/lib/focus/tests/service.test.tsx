import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { FocusProvider } from '@/lib/focus/providers/provider'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import {
  FocusService,
  focusTargetById,
  registeredFocusTarget,
  type FocusTargetId,
  type FocusTargetRegistrationInput,
} from '@/lib/focus/state/service'

import { expect, test } from '../../../../test/fixtures'

test.beforeEach(() => {
  document.body.replaceChildren()
})

test('retains a pre-registration request until matching registration and focusin', async () => {
  const service = new FocusService()
  const id = editorId('pending')
  const ticket = service.request(focusTargetById(id))

  expect(service.getSnapshot().currentOwner).toBeNull()
  expect(service.getSnapshot().requested?.attemptedTarget).toBeNull()

  const element = appendElement()
  const onIntent = vi.fn(() => true)
  registerTarget(service, { element, id, onIntent })

  expect(onIntent).toHaveBeenCalledWith('focus', element)
  expect(service.getSnapshot().currentOwner).toBeNull()

  service.handleFocusIn(focusEvent(element))

  await expect(ticket.completion).resolves.toEqual({ status: 'acknowledged', targetId: id })
  expect(service.getSnapshot().currentOwner?.id).toBe(id)
})

test('does not optimistically change ownership when a request is made', () => {
  const service = new FocusService()
  const first = registerEditor(service, 'first')
  const second = registerEditor(service, 'second')
  service.handleFocusIn(focusEvent(first.element))

  service.request(registeredFocusTarget(second.registration.token))

  expect(service.getSnapshot().currentOwner?.id).toBe(first.id)
  expect(service.getSnapshot().requested?.attemptedTarget?.id).toBe(second.id)
})

test('ignores stale focus acknowledgement after a newer request', async () => {
  const service = new FocusService()
  const first = registerEditor(service, 'first')
  const second = registerEditor(service, 'second')
  const firstTicket = service.request(registeredFocusTarget(first.registration.token))
  const secondTicket = service.request(registeredFocusTarget(second.registration.token))

  service.handleFocusIn(focusEvent(first.element))

  await expect(firstTicket.completion).resolves.toEqual({
    by: secondTicket.token,
    status: 'superseded',
  })
  expect(service.getSnapshot().requested?.token).toBe(secondTicket.token)
  expect(service.getSnapshot().currentOwner?.id).toBe(first.id)

  service.handleFocusIn(focusEvent(second.element))

  await expect(secondTicket.completion).resolves.toEqual({
    status: 'acknowledged',
    targetId: second.id,
  })
})

test('supersedes an unmounted destination with the newer request', async () => {
  const service = new FocusService()
  const firstTicket = service.request(focusTargetById(editorId('first')))
  const secondTicket = service.request(focusTargetById(editorId('second')))

  await expect(firstTicket.completion).resolves.toEqual({
    by: secondTicket.token,
    status: 'superseded',
  })
  expect(service.getSnapshot().requested?.token).toBe(secondTicket.token)
})

test('does not invoke a superseded destination when readiness registers it later', async () => {
  const service = new FocusService()
  const element = appendElement('button')
  const id = editorId('deferred')
  const onIntent = vi.fn(() => true)
  const { result, rerender, unmount } = renderHook(
    ({ ready }: { readonly ready: boolean }) =>
      useFocusTarget<HTMLButtonElement>(
        {
          area: 'editor',
          capabilities: { editor: { dispatch: () => true, writable: true } },
          id,
          onIntent,
        },
        ready,
      ),
    {
      initialProps: { ready: false },
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <FocusProvider ownerDocument={document} service={service}>
          {children}
        </FocusProvider>
      ),
    },
  )
  act(() => result.current.ref(element))
  const stale = service.request(focusTargetById(id))
  const newer = service.request(focusTargetById(editorId('newer')))

  rerender({ ready: true })

  await expect(stale.completion).resolves.toEqual({ by: newer.token, status: 'superseded' })
  expect(onIntent).not.toHaveBeenCalled()
  expect(service.getSnapshot().requested?.token).toBe(newer.token)
  unmount()
})

test('a readiness gate never re-exposes its unregistered target token', () => {
  const service = new FocusService()
  const element = appendElement('button')
  const id = editorId('remounted')
  const { result, rerender, unmount } = renderHook(
    ({ ready }: { readonly ready: boolean }) =>
      useFocusTarget<HTMLButtonElement>(
        {
          area: 'editor',
          capabilities: { editor: { dispatch: () => true, writable: true } },
          id,
          onIntent: () => true,
        },
        ready,
      ),
    {
      initialProps: { ready: true },
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <FocusProvider ownerDocument={document} service={service}>
          {children}
        </FocusProvider>
      ),
    },
  )
  act(() => result.current.ref(element))
  const firstToken = result.current.token
  expect(firstToken).not.toBeNull()

  rerender({ ready: false })
  expect(result.current.token).toBeNull()
  expect(firstToken && service.isRegistered(firstToken)).toBe(false)

  rerender({ ready: true })
  expect(result.current.token).not.toBeNull()
  expect(result.current.token).not.toBe(firstToken)
  expect(result.current.token && service.isRegistered(result.current.token)).toBe(true)
  unmount()
})

test('rejects refusal and unregister after an accepted attempt', async () => {
  const service = new FocusService()
  const refused = registerEditor(service, 'refused', () => false)
  const refusedTicket = service.request(registeredFocusTarget(refused.registration.token))

  await expect(refusedTicket.completion).resolves.toEqual({
    reason: 'refused',
    status: 'rejected',
  })

  const removed = registerEditor(service, 'removed')
  const removedTicket = service.request(registeredFocusTarget(removed.registration.token))
  removed.registration.unregister()

  await expect(removedTicket.completion).resolves.toEqual({
    reason: 'unregistered',
    status: 'rejected',
  })
})

test('keeps replacement registration B when stale token A cleans up', () => {
  const service = new FocusService()
  const first = registerEditor(service, 'same')
  const second = registerEditor(service, 'same')

  first.registration.unregister()

  expect(service.isRegistered(first.registration.token)).toBe(false)
  expect(service.isRegistered(second.registration.token)).toBe(true)
  expect(service.getTarget(second.registration.token)?.id).toBe(second.id)
})

test('selects the deepest registered target in a composed path', () => {
  const service = new FocusService()
  const parent = appendElement()
  const child = document.createElement('div')
  const input = document.createElement('input')
  parent.append(child)
  child.append(input)
  const parentTarget = registerTarget(service, {
    element: parent,
    id: { kind: 'search', rootPath: '/repo', surface: 'sidebar' },
  })
  const childTarget = registerTarget(service, {
    element: child,
    id: editorId('nested'),
  })

  service.handleFocusIn(focusEvent(input, child, parent))

  expect(service.getSnapshot().currentOwner?.token).toBe(childTarget.token)
  expect(service.getSnapshot().currentOwner?.token).not.toBe(parentTarget.token)
  expect(
    service.resolveTarget({
      compatible: isEditor,
      path: focusEvent(input, child, parent),
    })?.token,
  ).toBe(childTarget.token)
})

test('resolves path, origin, current, exact, and last owner in order', () => {
  const service = new FocusService()
  const path = registerEditor(service, 'path')
  const origin = registerEditor(service, 'origin')
  const current = registerEditor(service, 'current')
  const exact = registerEditor(service, 'exact')
  const overlayElement = appendElement()
  registerTarget(service, {
    capabilities: { overlay: true },
    element: overlayElement,
    id: { kind: 'command-palette' },
  })

  service.handleFocusIn(focusEvent(current.element))
  expect(
    service.resolveTarget({
      compatible: isEditor,
      exact: (target) => target.id === exact.id,
      origin: origin.registration.token,
      path: focusEvent(path.element),
    })?.id,
  ).toBe(path.id)

  expect(
    service.resolveTarget({
      compatible: isEditor,
      exact: (target) => target.id === exact.id,
      origin: origin.registration.token,
    })?.id,
  ).toBe(origin.id)

  expect(service.resolveTarget({ compatible: isEditor })?.id).toBe(current.id)

  service.handleFocusIn(focusEvent(overlayElement))
  expect(
    service.resolveTarget({
      compatible: isEditor,
      exact: (target) => target.id === exact.id,
    })?.id,
  ).toBe(exact.id)
  expect(service.resolveTarget({ compatible: isEditor })?.id).toBe(current.id)
})

test('returns unavailable for ambiguous compatible targets', () => {
  const service = new FocusService()
  registerEditor(service, 'first')
  registerEditor(service, 'second')

  expect(service.resolveTarget({ compatible: isEditor })).toBeNull()
  expect(
    service.resolveTarget({
      compatible: isEditor,
      exact: () => true,
    }),
  ).toBeNull()
})

test('never turns elapsed time into successful acknowledgement', async () => {
  vi.useFakeTimers()
  try {
    const service = new FocusService()
    const id = editorId('later')
    const ticket = service.request(focusTargetById(id))
    let settled = false
    void ticket.completion.then(() => {
      settled = true
    })

    await vi.runAllTimersAsync()
    expect(settled).toBe(false)

    const target = registerEditor(service, 'later')
    service.handleFocusIn(focusEvent(target.element))

    await expect(ticket.completion).resolves.toEqual({ status: 'acknowledged', targetId: id })
  } finally {
    vi.useRealTimers()
  }
})

test('rejects an unattempted destination that becomes invalid before unregister', async () => {
  const service = new FocusService()
  const existing = registerEditor(service, 'existing')
  let valid = true
  const ticket = service.request({
    isValid: () => valid,
    kind: 'match',
    matches: () => false,
  })

  valid = false
  existing.registration.unregister()

  await expect(ticket.completion).resolves.toEqual({
    reason: 'destination-invalid',
    status: 'rejected',
  })
})

test('rejects a delayed focus acknowledgement after its destination becomes invalid', async () => {
  const service = new FocusService()
  const target = registerEditor(service, 'delayed')
  let valid = true
  const ticket = service.request({
    isValid: () => valid,
    kind: 'match',
    matches: (candidate) => candidate.token === target.registration.token,
  })

  valid = false
  service.handleFocusIn(focusEvent(target.element))

  await expect(ticket.completion).resolves.toEqual({
    reason: 'destination-invalid',
    status: 'rejected',
  })
  expect(service.getSnapshot().currentOwner?.token).toBe(target.registration.token)
})

test('recognizes an element that was focused before registration', () => {
  const service = new FocusService()
  const element = appendElement('button')
  element.focus()

  const registration = registerTarget(service, { element, id: editorId('mounted-late') })

  expect(service.getSnapshot().currentOwner?.token).toBe(registration.token)
})

test('recognizes synchronous intent focus before the provider listener mounts', async () => {
  const service = new FocusService()
  const id = editorId('layout-focus')
  const element = appendElement('button')
  const registration = registerTarget(service, {
    element,
    id,
    onIntent: (_intent, targetElement) => {
      targetElement.focus()
      return true
    },
  })

  const ticket = service.request(registeredFocusTarget(registration.token))

  await expect(ticket.completion).resolves.toEqual({ status: 'acknowledged', targetId: id })
  expect(service.getSnapshot().currentOwner?.token).toBe(registration.token)
})

test('invokes a non-focus intent even when the destination already owns focus', async () => {
  const service = new FocusService()
  const id = { kind: 'file-tree', rootPath: '/repo' } as const
  const element = appendElement('button')
  const onIntent = vi.fn(() => true)
  const registration = registerTarget(service, { element, id, onIntent })
  element.focus()
  service.handleFocusIn(focusEvent(element))

  const ticket = service.request(registeredFocusTarget(registration.token), 'open-search')

  await expect(ticket.completion).resolves.toEqual({ status: 'acknowledged', targetId: id })
  expect(onIntent).toHaveBeenCalledOnce()
  expect(onIntent).toHaveBeenCalledWith('open-search', element)
})

test('provider installs one capture listener and the target hook registers without memoized input', () => {
  const service = new FocusService()
  const addListener = vi.spyOn(document, 'addEventListener')
  const removeListener = vi.spyOn(document, 'removeEventListener')
  const element = appendElement('button')

  try {
    const { result, unmount } = renderHook(
      () =>
        useFocusTarget<HTMLButtonElement>({
          area: 'editor',
          capabilities: { editor: { dispatch: () => true, writable: true } },
          id: editorId('hook'),
          onIntent: () => true,
        }),
      {
        wrapper: ({ children }: { readonly children: ReactNode }) => (
          <FocusProvider ownerDocument={document} service={service}>
            {children}
          </FocusProvider>
        ),
      },
    )

    act(() => result.current.ref(element))

    expect(result.current.token).not.toBeNull()
    expect(service.isRegistered(result.current.token!)).toBe(true)
    expect(
      addListener.mock.calls.filter(([type, , capture]) => type === 'focusin' && capture === true),
    ).toHaveLength(1)

    unmount()

    expect(
      removeListener.mock.calls.filter(
        ([type, , capture]) => type === 'focusin' && capture === true,
      ),
    ).toHaveLength(1)
  } finally {
    addListener.mockRestore()
    removeListener.mockRestore()
  }
})

function appendElement<T extends keyof HTMLElementTagNameMap = 'div'>(tag?: T) {
  const element = document.createElement(tag ?? 'div') as HTMLElementTagNameMap[T]
  document.body.append(element)
  return element
}

function editorId(key: string): FocusTargetId {
  return { key, kind: 'editor', surface: 'document', tabId: key }
}

function focusEvent(...path: EventTarget[]) {
  return { composedPath: () => path } as FocusEvent
}

function isEditor(target: { readonly id: FocusTargetId }) {
  return target.id.kind === 'editor'
}

function registerEditor(service: FocusService, key: string, onIntent = () => true) {
  const element = appendElement()
  const id = editorId(key)
  const registration = registerTarget(service, { element, id, onIntent })
  return { element, id, registration }
}

function registerTarget(
  service: FocusService,
  input: Pick<FocusTargetRegistrationInput, 'element' | 'id'> &
    Partial<Omit<FocusTargetRegistrationInput, 'element' | 'id'>>,
) {
  return service.register({
    area: input.id.kind === 'editor' ? 'editor' : 'global',
    capabilities:
      input.id.kind === 'editor'
        ? { editor: { dispatch: () => true, writable: true } }
        : input.capabilities,
    element: input.element,
    id: input.id,
    onIntent: input.onIntent ?? (() => true),
  })
}
