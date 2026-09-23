import { onTestFinished, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { DEFAULT_SETTING_VALUES, environmentIdSchema, sessionIdSchema } from '@workspace/contracts'
import {
  createSessionNotificationTracker,
  type NotificationSession,
} from '@workspace/client-core/chat/notifications'
import { createTurnSubmission } from '@workspace/client-core/chat/commands'
import { MockProviderAdapter } from 'server/testing'
import * as v from 'valibot'
import { createNotificationHost } from '@/features/chat-mode/state/notification-host'
import { startSessionNotifications } from '@/features/chat-mode/state/session-notifications'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { chatNotificationQueryKeys } from '@/features/chat-mode/utils/query-keys'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { installNotificationPlatform } from '../../../../../test/factories/notification-platform'
import { expect, test } from '../../../../../test/fixtures'

const environmentId = v.parse(environmentIdSchema, '10000000-0000-4000-8000-000000000001')
const remoteId = v.parse(environmentIdSchema, '20000000-0000-4000-8000-000000000001')
const sessionId = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const notice = {
  ref: { environmentId, sessionId },
  kind: 'input',
  title: 'Input needed',
  body: 'Fixture',
  failed: false,
} as const

test('native host scopes tags, replaces pending notices, handles refusal, focus and owner cleanup', () => {
  const platform = installNotificationPlatform()
  const opened: string[] = []
  const queryClient = new QueryClient()
  const host = createNotificationHost({
    queryClient,
    open: (ref) => opened.push(ref.environmentId),
    active: () => null,
  })
  onTestFinished(() => {
    host.dispose()
    queryClient.clear()
  })
  host.configure('notifications')
  host.deliver(notice, 'notifications', false)
  host.deliver(notice, 'notifications', false)
  host.deliver({ ...notice, ref: { environmentId: remoteId, sessionId } }, 'notifications', false)
  expect(platform.notifications).toHaveLength(3)
  expect(platform.notifications[0]?.closed).toBe(true)
  expect(platform.notifications[1]?.tag).not.toBe(platform.notifications[2]?.tag)
  platform.notifications[2]?.dispatchEvent(new Event('click'))
  expect(opened).toEqual([remoteId])
  expect(platform.windowFocus).toHaveBeenCalledOnce()
  host.retain(new Set([remoteId]))
  expect(platform.notifications[1]?.closed).toBe(true)
  window.dispatchEvent(new Event('focus'))
  expect(platform.notifications.every((notification) => notification.closed)).toBe(true)
  platform.Notification.permission = 'denied'
  host.deliver(notice, 'notifications', false)
  expect(platform.notifications).toHaveLength(3)
})

test('the badge repaints the page icon in place and gives it back on focus', () => {
  installNotificationPlatform()
  // happy-dom has no 2D canvas; the badge only needs one to draw into.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,YmFkZ2U=',
  )
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/svg+xml'
  icon.href = '/platform/vscode-icons/code.svg'
  document.head.append(icon)
  const pageHref = icon.href
  const queryClient = new QueryClient()
  const host = createNotificationHost({ queryClient, open() {}, active: () => null })
  onTestFinished(() => {
    host.dispose()
    queryClient.clear()
    icon.remove()
    vi.restoreAllMocks()
  })
  host.configure('notifications')

  host.deliver(notice, 'notifications', false)

  expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
  expect(icon.href).toBe('data:image/png;base64,YmFkZ2U=')
  expect(icon.dataset.sessionNotifications).toBe('true')

  window.dispatchEvent(new Event('focus'))

  expect(icon.isConnected).toBe(true)
  expect(icon.href).toBe(pageHref)
  expect(icon.type).toBe('image/svg+xml')
  expect(icon.dataset.sessionNotifications).toBeUndefined()
})

test('sound unlocks only on gestures, ignores focus and rechecks mode after async buffer retrieval', async () => {
  const platform = installNotificationPlatform()
  platform.focus.mockReturnValue(true)
  const queryClient = new QueryClient()
  queryClient.setQueryData(chatNotificationQueryKeys.sound('input'), {})
  const host = createNotificationHost({ queryClient, open() {}, active: () => notice.ref })
  onTestFinished(() => {
    host.dispose()
    queryClient.clear()
    writeBootMirror(DEFAULT_SETTING_VALUES)
  })
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'chat.notificationMode': 'sound' })
  host.configure('sound')
  host.deliver(notice, 'sound', false)
  expect(platform.audio.plays).toBe(0)
  document.dispatchEvent(new Event('pointerdown'))
  expect(platform.audio.resumes).toBe(1)
  host.deliver(notice, 'sound', false)
  writeBootMirror(DEFAULT_SETTING_VALUES)
  await Promise.resolve()
  expect(platform.audio.plays).toBe(0)
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'chat.notificationMode': 'sound' })
  host.deliver(notice, 'sound', false)
  await expect.poll(() => platform.audio.plays).toBe(1)
  host.configure('notifications-and-sound')
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'chat.notificationMode': 'notifications-and-sound' })
  host.deliver(notice, 'notifications-and-sound', false)
  await expect.poll(() => platform.audio.plays).toBe(2)
  expect(platform.audio.resumes).toBe(1)
  host.configure('off')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(platform.audio.resumes).toBe(1)
})

test('tracker forgets removed owners and disconnect history, and attention is owner scoped', () => {
  const tracker = createSessionNotificationTracker()
  const session: NotificationSession = {
    id: sessionId,
    title: 'Fixture',
    archivedAt: null,
    latestTurn: null,
    runtime: null,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    backgroundLiveness: null,
  }
  expect(tracker.update(environmentId, true, [session])).toEqual([])
  expect(tracker.update(remoteId, true, [session])).toEqual([])
  const input = { ...session, pendingUserInputCount: 1 }
  expect(tracker.update(environmentId, true, [input])).toHaveLength(1)
  expect(tracker.update(environmentId, true, [input])).toEqual([])
  expect(tracker.update(remoteId, true, [input])).toHaveLength(1)
  tracker.update(environmentId, false, [session])
  expect(tracker.update(environmentId, true, [input])).toEqual([])
  tracker.retain(new Set())
  expect(tracker.update(remoteId, true, [input])).toEqual([])
})

test('real completed turns notify once and reconnect history stays silent', async ({
  server,
  client,
}) => {
  await server.restart({ providerRuntime: true, providerAdapter: new MockProviderAdapter() })
  const h = await createRailHarness(client, server)
  const platform = installNotificationPlatform()
  const queryClient = new QueryClient()
  const host = createNotificationHost({ queryClient, open() {}, active: () => null })
  const notifications = startSessionNotifications(host)
  notifications.configure('notifications', false)
  onTestFinished(() => {
    notifications.dispose()
    queryClient.clear()
  })
  const runTurn = async () => {
    const session = (await h.refresh()).sessions[0]!
    await h.dispatch(
      createTurnSubmission({
        sessionId: session.id,
        modelSelection: session.modelSelection!,
        text: 'Finish this task',
        createdAt: new Date().toISOString(),
        runtimeMode: 'full-access',
        interactionMode: 'default',
      }).command,
    )
    await expect
      .poll(async () => (await h.refresh()).sessions[0]?.latestTurn?.state)
      .toBe('completed')
  }
  await runTurn()
  expect(platform.notifications).toHaveLength(1)
  await h.refresh()
  expect(platform.notifications).toHaveLength(1)
  const owner = Object.values(useEnvironmentsStore.getState().entries).find(
    (entry) => entry.environmentId === h.environmentId,
  )!
  useEnvironmentsStore.getState().setPhase(owner.origin, 'reconnecting')
  await runTurn()
  useEnvironmentsStore.getState().setPhase(owner.origin, 'live')
  expect(platform.notifications).toHaveLength(1)
  notifications.configure('notifications-and-sound', false)
  await runTurn()
  expect(platform.notifications).toHaveLength(2)
})
