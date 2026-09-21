import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors, settleAnimations } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import {
  isolatedNativeScenario,
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

export const sessionNotifications = isolatedNativeScenario({
  name: 'session-notifications',
  description:
    'Focused toast opens its owner; background native notices badge once, focus clears, reload and archived completion stay silent.',
  fixture: new URL('../fixtures/native-titles.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId, providerInstanceId, worktreeId }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const keys = ['chat.notificationMode', 'chat.inAppNotificationsEnabled'] as const
    const otherId = crypto.randomUUID()
    const title = `session-notifications verification ${sessionId.slice(0, 8)}`
    const otherTitle = `Notification destination ${otherId.slice(0, 8)}`
    const control = (mode: 'hold' | 'success') =>
      writeFile(join(root, 'title-control.json'), JSON.stringify({ mode, holdConversation: true }))
    const send = async () => {
      await control('hold')
      await selectors.sessionByTitle(page, title).click()
      await page.waitForURL((url) => url.href.includes(sessionId))
      await selectors.chatMessage(page).fill('Complete the isolated notification turn.')
      await selectors.chatSend(page).click()
      await selectors.sessionStatus(page, title, 'Working').waitFor()
    }
    const completed = async () => {
      await page.waitForFunction(
        async ({ orchestration, sessionId }) => {
          const snapshot = await (await fetch(`${orchestration}/shell-snapshot`)).json()
          return (
            snapshot.sessions.find((session: { id: string }) => session.id === sessionId)
              ?.latestTurn?.state === 'completed'
          )
        },
        { orchestration, sessionId },
      )
    }
    let created = false
    try {
      await page
        .context()
        .grantPermissions(['notifications'], { origin: new URL(page.url()).origin })
      await page.addInitScript(captureNativeNotifications)
      await page.evaluate(captureNativeNotifications)
      await writeSettings(
        page,
        base,
        keys.map((key) => ({
          kind: 'set',
          key,
          value: key === 'chat.notificationMode' ? 'notifications' : true,
        })),
      )
      await dispatch(page, orchestration, {
        type: 'session.create',
        sessionId: otherId,
        title: otherTitle,
        worktreeTarget: { kind: 'current', worktreeId },
        modelSelection: { providerInstanceId, model: 'gpt-5.5' },
      })
      created = true
      await selectors.sessionSearch(page).fill('')
      await send()
      await selectors.sessionByTitle(page, otherTitle).click()
      await page.waitForURL((url) => url.href.includes(otherId))
      await control('success')
      await selectors.notificationOpenSession(page).waitFor()
      await settleAnimations(selectors.notificationToast(page))
      await step('focused-other-session-toast')
      await selectors.notificationOpenSession(page).click()
      await page.waitForURL((url) => url.href.includes(sessionId))
      await step('toast-opened-owning-session')
      await send()
      const background = await page.context().newPage()
      try {
        await background.goto('about:blank')
        const sourceCdp = await page.context().newCDPSession(page)
        await sourceCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
        await background.bringToFront()
        const focus = await page.evaluate(() => ({
          visible: document.visibilityState,
          focused: document.hasFocus(),
          permission: Notification.permission,
        }))
        ok(
          focus.visible !== 'visible' || !focus.focused,
          `Source tab must be backgrounded: ${JSON.stringify(focus)}`,
        )
        await control('success')
        await selectors.notificationBadge(page).waitFor({ state: 'attached' })
        strictEqual(
          await page.evaluate(
            () => JSON.parse(document.documentElement.dataset.nativeNotifications ?? '[]').length,
          ),
          1,
        )
        await step('background-native-notification-and-badge')
        await page.evaluate(() =>
          document.dispatchEvent(new Event('verification-notification-click')),
        )
        await page.bringToFront()
        await selectors.notificationBadge(page).waitFor({ state: 'detached' })
        await step('native-click-focus-clears-badge')
      } finally {
        await background.close()
      }
      await page.reload()
      await selectors.sessionByTitle(page, title).waitFor()
      strictEqual(await selectors.notificationOpenSession(page).count(), 0)
      strictEqual(
        await page.evaluate(
          () => JSON.parse(document.documentElement.dataset.nativeNotifications ?? '[]').length,
        ),
        0,
      )
      await step('reload-history-silent')
      await send()
      await dispatch(page, orchestration, { type: 'session.archive', sessionId })
      await control('success')
      await completed()
      strictEqual(await selectors.notificationOpenSession(page).count(), 0)
      strictEqual(
        await page.evaluate(
          () => JSON.parse(document.documentElement.dataset.nativeNotifications ?? '[]').length,
        ),
        0,
      )
      ok(
        (await readShell(page, orchestration)).sessions.find((session) => session.id === sessionId)
          ?.archivedAt,
      )
      await step('archived-completion-silent')
    } finally {
      if (created)
        await dispatch(page, orchestration, { type: 'session.delete', sessionId: otherId })
      await restoreUserSettings(page, base, before, keys)
    }
  },
})

function captureNativeNotifications() {
  const Original = window.Notification
  const pending: Notification[] = []
  class RecordedNotification extends Original {
    constructor(title: string, options?: NotificationOptions) {
      document.documentElement.dataset.nativeNotificationAttempt = JSON.stringify({
        title,
        permission: Original.permission,
      })
      try {
        super(title, options)
      } catch (error) {
        document.documentElement.dataset.nativeNotificationError = String(error)
        throw error
      }
      pending.push(this)
      document.documentElement.dataset.nativeNotifications = JSON.stringify(
        pending.map((notice) => ({ title: notice.title, tag: notice.tag })),
      )
    }
  }
  window.Notification = RecordedNotification
  document.addEventListener('verification-notification-click', () =>
    pending.at(-1)?.dispatchEvent(new Event('click')),
  )
}
