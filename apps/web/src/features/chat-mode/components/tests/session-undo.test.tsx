import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { detectPlatform } from '@tanstack/hotkeys'
import type { FocusArea, FocusTargetId } from '@workspace/client-core/commands/focus'
import {
  createSessionActiveReorderCommand,
  createSessionLifecycleCommand,
} from '@workspace/client-core/chat/commands'
import { createClientError } from '@workspace/client-core/errors'
import type { EnvironmentId, ProjectId, SessionId } from '@workspace/contracts'
import { useShallow } from 'zustand/react/shallow'
import { tokenForChatReference } from '@workspace/client-core/address/references'
import { useActiveChatSessionId } from '@/features/chat/hooks/use-active-chat-session-id'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionUndoStore } from '@/features/chat-mode/state/session-undo'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { reorderRailSession } from '@/features/chat-mode/state/rail-order-commands'
import { railMarkerId } from '@workspace/client-core/chat/rail/drop'
import { scopedSessionKey } from '@workspace/contracts'
import { FocusService } from '@/lib/focus/state/service'
import { getNavigation } from '@/state/navigation-binding'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { createObservedInProcessClient } from '../../../../../test/client'
import { renderHookWithProviders, renderWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

async function menu(label: string, title = 'First') {
  await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTitle(title) })
  await userEvent.click(await screen.findByRole('menuitem', { name: label }))
}

async function undoButton(text: string) {
  const notice = await screen.findByText(text)
  return within(notice.closest('[data-sonner-toast]')!).getByRole('button', { name: 'Undo' })
}

/** Mod+Z where the user's focus is; `Mod` is Command on macOS and Control elsewhere. */
function pressUndo(target: EventTarget) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'KeyZ',
    key: 'z',
    ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function focusNeutral() {
  const button = document.createElement('button')
  document.body.append(button)
  act(() => button.focus())
  return button
}

test('unpin Undo restores the pin key the row had', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'pin', orderKey: 'm' }))
  await h.refresh()
  renderRailHarness(h)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  await menu('Unpin')
  await waitFor(async () => expect((await current()).pinnedAt).toBeNull())
  await userEvent.click(await undoButton('1 unpinned'))
  await waitFor(async () =>
    expect(await current()).toMatchObject({ pinOrderKey: 'm', pinnedAt: expect.any(String) }),
  )
  expect(useSessionUndoStore.getState().slot).toBeNull()
})

test('settle Undo by Mod+Z restores the pin key, active slot and snooze that settling cleared', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  const snoozedUntil = new Date(Date.now() + 60 * 60_000).toISOString()
  await h.dispatch(createSessionActiveReorderCommand({ sessionId: first, orderKey: 'c' }))
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'pin', orderKey: 'm' }))
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'snooze', snoozedUntil }))
  await h.refresh()
  renderRailHarness(h)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  await menu('Mark as settled')
  await waitFor(async () =>
    expect(await current()).toMatchObject({
      settledOverride: 'settled',
      pinnedAt: null,
      snoozedUntil: null,
      activeOrderKey: null,
    }),
  )
  const neutral = focusNeutral()
  expect(pressUndo(neutral).defaultPrevented).toBe(true)
  await waitFor(async () =>
    expect(await current()).toMatchObject({
      settledOverride: 'active',
      pinOrderKey: 'm',
      pinnedAt: expect.any(String),
      activeOrderKey: 'c',
      snoozedUntil,
    }),
  )
  // The slot is spent: the key goes back to the browser and nothing is dispatched.
  expect(pressUndo(neutral).defaultPrevented).toBe(false)
  neutral.remove()
})

test('Mod+Z leaves text fields, the composer, editors, terminals and the file tree their own undo', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  const focus = new FocusService()
  renderRailHarness(h, false, undefined, focus)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  await menu('Mark as settled')
  await waitFor(async () => expect((await current()).settledOverride).toBe('settled'))

  const surfaces: readonly (readonly [FocusArea, FocusTargetId])[] = [
    ['chat', { kind: 'chat-composer', key: 'composer' }],
    ['editor', { kind: 'editor', key: '/project/a.ts', surface: 'document' }],
    ['terminal', { kind: 'terminal', rootPath: '/project', sessionId: 'shell' }],
    ['file-tree', { kind: 'file-tree', rootPath: '/project' }],
  ]
  for (const [area, id] of surfaces) {
    const element = document.createElement('div')
    element.tabIndex = -1
    document.body.append(element)
    const registration = focus.register({ area, element, id, onIntent: () => false })
    act(() => element.focus())
    pressUndo(element)
    expect(useSessionUndoStore.getState().slot, area).not.toBeNull()
    registration.unregister()
    element.remove()
  }
  const input = document.createElement('input')
  document.body.append(input)
  act(() => input.focus())
  expect(pressUndo(input).defaultPrevented).toBe(false)
  input.remove()
  expect((await current()).settledOverride).toBe('settled')

  const neutral = focusNeutral()
  expect(pressUndo(neutral).defaultPrevented).toBe(true)
  await waitFor(async () => expect((await current()).settledOverride).toBe('active'))
  neutral.remove()
})

test('Mod+Z undoes from a pane without its own undo, such as the git pane', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  const focus = new FocusService()
  renderRailHarness(h, false, undefined, focus)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  await menu('Mark as settled')
  await waitFor(async () => expect((await current()).settledOverride).toBe('settled'))
  const element = document.createElement('div')
  element.tabIndex = -1
  document.body.append(element)
  const registration = focus.register({
    area: 'git',
    element,
    id: { kind: 'git', rootPath: '/project' },
    onIntent: () => false,
  })
  act(() => element.focus())
  expect(pressUndo(element).defaultPrevented).toBe(true)
  await waitFor(async () => expect((await current()).settledOverride).toBe('active'))
  registration.unregister()
  element.remove()
})

test('archiving the viewed session opens a draft, and Undo unarchives it and opens it again', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  renderRailHarness(h)
  await act(async () => {
    await getNavigation().openChat({
      environmentId: h.environmentId,
      sessionId: first,
      surface: 'main',
    })
  })
  expect(getNavigation().currentAddress().document).toBe(`t/${first}`)
  await menu('Archive')
  await waitFor(() => expect(getNavigation().currentAddress().document).not.toBe(`t/${first}`))
  await userEvent.click(await undoButton('1 archived'))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === first)?.archivedAt,
    ).toBeNull(),
  )
  await waitFor(() => expect(getNavigation().currentAddress().document).toBe(`t/${first}`))
})

test('bulk archive Undo restores only the rows that were archived', async ({ server }) => {
  let failedId: SessionId | undefined
  const unarchived: string[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    if (body.type === 'session.unarchive') unarchived.push(body.sessionId)
    if (body.type !== 'session.archive' || body.sessionId !== failedId) return
    throw createClientError({
      code: 'TEST_NETWORK_FAILURE',
      message: 'Injected archive network failure',
      status: 503,
      why: 'The test interrupts one transport request.',
      fix: 'Retry the failed selection.',
    })
  })
  const h = await createRailHarness(client, server, ['First', 'Middle', 'Last'])
  failedId = h.sessionIds[1]
  const refs = h.sessionIds.map((sessionId) => ({ environmentId: h.environmentId, sessionId }))
  useSessionMultiSelectStore.setState({ refs, anchor: refs[0] })
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: h.application,
    queryClient: h.application.getSnapshot().queryClient,
  })
  await act(async () => {
    await hook.result.current.archiveSessions(refs)
  })
  expect(useSessionUndoStore.getState().slot?.entries.map((entry) => entry.ref)).toEqual([
    refs[0],
    refs[2],
  ])
  const neutral = focusNeutral()
  pressUndo(neutral)
  await waitFor(async () =>
    expect((await h.refresh()).sessions.every((session) => session.archivedAt === null)).toBe(true),
  )
  expect(unarchived.toSorted()).toEqual([refs[0]!.sessionId, refs[2]!.sessionId].toSorted())
  neutral.remove()
})

test('consecutive settles share one Undo, and a manual change expires that row', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  const session = async (id: string) =>
    (await h.refresh()).sessions.find((candidate) => candidate.id === id)!
  const [first, second] = h.sessionIds as [SessionId, SessionId]
  await menu('Mark as settled', 'First')
  await menu('Mark as settled', 'Second')
  await screen.findByText('2 settled')
  await menu('Move to active', 'First')
  await waitFor(() =>
    expect(
      useSessionUndoStore.getState().slot?.entries.map((entry) => entry.ref.sessionId),
    ).toEqual([second]),
  )
  await userEvent.click(await undoButton('1 settled'))
  await waitFor(async () => expect((await session(second)).settledOverride).toBe('active'))
  expect((await session(first)).settledOverride).toBe('active')
})

test('dragging a pinned row to Settled offers the same Undo, which restores its pin key', async ({
  server,
}) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    if ((await request.clone().json()).type === 'session.unsettle') await held
  })
  const h = await createRailHarness(client, server)
  const first = h.sessionIds[0]!
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'pin', orderKey: 'm' }))
  await h.refresh()
  renderRailHarness(h)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  const outcome = await reorderRailSession({
    activeId: scopedSessionKey({ environmentId: h.environmentId, sessionId: first }),
    overId: railMarkerId('settled-placeholder'),
  })
  expect(outcome?.ok).toBe(true)
  expect(await current()).toMatchObject({ settledOverride: 'settled', pinnedAt: null })
  await userEvent.click(await undoButton('1 settled'))
  // A drag runs in its owner's cache; its Undo still shows as pending with the menu's lifecycle.
  await waitFor(() =>
    expect(
      primaryQueryClient().isMutating({ mutationKey: chatModeMutationKeys.lifecycle() }),
    ).toBeGreaterThan(0),
  )
  release()
  await waitFor(async () =>
    expect(await current()).toMatchObject({ settledOverride: 'active', pinOrderKey: 'm' }),
  )
})

test('dragging a pin into Active offers an unpin Undo that restores its pin key', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const [first, second] = h.sessionIds as [SessionId, SessionId]
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'pin', orderKey: 'm' }))
  await h.refresh()
  renderRailHarness(h)
  const current = async () => (await h.refresh()).sessions.find((session) => session.id === first)!
  const outcome = await reorderRailSession({
    activeId: scopedSessionKey({ environmentId: h.environmentId, sessionId: first }),
    overId: scopedSessionKey({ environmentId: h.environmentId, sessionId: second }),
  })
  expect(outcome?.ok).toBe(true)
  expect((await current()).pinnedAt).toBeNull()
  await userEvent.click(await undoButton('1 unpinned'))
  await waitFor(async () =>
    expect(await current()).toMatchObject({ pinnedAt: expect.any(String), pinOrderKey: 'm' }),
  )
})

test('a bulk Undo restores every row it can and names the ones the server refused', async ({
  server,
}) => {
  let failedId: SessionId | undefined
  const dispatched: string[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    dispatched.push(`${body.type}:${body.sessionId}`)
    if (body.type !== 'session.unsettle' || body.sessionId !== failedId) return
    throw createClientError({
      code: 'TEST_NETWORK_FAILURE',
      message: 'Injected unsettle failure',
      status: 503,
      why: 'The test interrupts one transport request.',
      fix: 'Retry the Undo.',
    })
  })
  const h = await createRailHarness(client, server)
  const [first, second] = h.sessionIds as [SessionId, SessionId]
  failedId = first
  await h.dispatch(createSessionLifecycleCommand(first, { type: 'pin', orderKey: 'm' }))
  await h.refresh()
  renderRailHarness(h)
  const session = async (id: string) =>
    (await h.refresh()).sessions.find((candidate) => candidate.id === id)!
  await menu('Mark as settled', 'First')
  await menu('Mark as settled', 'Second')
  const undo = await undoButton('2 settled')
  dispatched.length = 0
  await userEvent.click(undo)
  await waitFor(async () => expect((await session(second)).settledOverride).toBe('active'))
  expect(await session(first)).toMatchObject({ settledOverride: 'settled', pinnedAt: null })
  expect(dispatched).not.toContain(`session.pin:${first}`)
  expect(await screen.findByText('Undo failed for 1 session')).toBeTruthy()
  expect(useSessionUndoStore.getState().slot).toBeNull()
})

test('archiving the session open in the side chat reopens it there on Undo', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  const [first, second] = h.sessionIds as [SessionId, SessionId]
  renderRailHarness(h)
  renderWithProviders(
    <SideChatReconciler environmentId={h.environmentId} projectId={h.projectId} />,
    {
      application: h.application,
      queryClient: h.application.getSnapshot().queryClient,
    },
  )
  const token = tokenForChatReference({ kind: 'session', sessionId: first })
  await act(async () => {
    await getNavigation().openChat({
      environmentId: h.environmentId,
      projectId: h.projectId,
      sessionId: first,
      surface: 'sidebar',
    })
    await getNavigation().openChat({
      environmentId: h.environmentId,
      sessionId: second,
      surface: 'main',
    })
  })
  expect(getNavigation().currentAddress()).toMatchObject({ chat: token, document: `t/${second}` })
  await menu('Archive')
  await waitFor(() => expect(getNavigation().currentAddress().chat).not.toBe(token))
  await userEvent.click(await undoButton('1 archived'))
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === first)?.archivedAt,
    ).toBeNull(),
  )
  await waitFor(() => expect(getNavigation().currentAddress().chat).toBe(token))
})

/** The side chat's own reconciler, which moves the reader off a session the moment it leaves the list. */
function SideChatReconciler({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId
}) {
  const sessionIds = useChatProjectionStore(
    useShallow((state) =>
      Object.values(selectChatProjectionSlice(state, environmentId).sessionById)
        .filter((session) => !session.archivedAt)
        .map((session) => session.id),
    ),
  )
  useActiveChatSessionId({ sessionIds, environmentId, projectId })
  return null
}
