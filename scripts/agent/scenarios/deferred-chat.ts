import { equal, ok } from 'node:assert/strict'
import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { deferredChatModuleRoutes, selectors, waitForApp } from '../selectors'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

const observations = new WeakMap<object, unknown>()

export const deferredChat: Scenario = {
  name: 'deferred-chat',
  description:
    'Default workbench keeps chat modules deferred; activation, pending switches, drafts, revisit and module errors stay owned.',
  requiresIsolatedServer: true,
  capture: { width: 1440, height: 1000 },
  inspect: async (page) => observations.get(page) ?? null,
  async run(page, { step }) {
    const requests: string[] = []
    page.on('request', (request) => requests.push(new URL(request.url()).pathname))
    await page.reload()
    await waitForApp(page)
    await selectors.sidebarTab(page, 'Files').waitFor()
    equal(
      requests.some((path) => path.includes('/src/features/chat-mode/components/surface-view.tsx')),
      false,
    )
    equal(
      requests.some((path) => path.includes('/src/features/chat/components/chat-side-panel.tsx')),
      false,
    )
    const defaultRequests = [...requests]
    await step('default-workbench-files-without-chat-modules')

    const fixture = await createModifiedFileFixture('deferred-chat', 'notes.md', ['one'], ['two'])
    const surface = Promise.withResolvers<void>()
    const panel = Promise.withResolvers<void>()
    await page.route(deferredChatModuleRoutes.workspace, async (route) => {
      await surface.promise
      await route.continue()
    })
    await page.route(deferredChatModuleRoutes.panel, async (route) => {
      await panel.promise
      await route.continue()
    })
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
      await selectors.deferredChatLoading(page, 'workspace').waitFor()
      await step('chat-mode-loading')
      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Files').waitFor()
      await step('leave-pending-chat-mode')
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.deferredChatLoading(page, 'workspace').waitFor()
      surface.resolve()
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
      await selectors.chatMessage(page).waitFor()
      await selectors.chatMessage(page).click()
      await selectors.chatMessage(page).pressSequentially('mode draft retained')
      await selectors.waitForChatText(page, 'mode draft retained')
      await step('chat-mode-loaded')
      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.chatMessage(page).waitFor()
      ok((await selectors.chatMessage(page).innerText()).includes('mode draft retained'))
      await step('chat-mode-revisit-keeps-draft')

      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.deferredChatLoading(page, 'panel').waitFor()
      await step('chat-sidebar-loading')
      await selectors.sidebarTab(page, 'Files').click()
      await selectors.folderTree(page).waitFor()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.deferredChatLoading(page, 'panel').waitFor()
      panel.resolve()
      await selectors.chatMessage(page).waitFor()
      await selectors.chatMessage(page).click()
      await selectors.chatMessage(page).pressSequentially('sidebar draft retained')
      await selectors.waitForChatText(page, 'sidebar draft retained')
      await step('chat-sidebar-loaded')
      await selectors.sidebarTab(page, 'Files').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.chatMessage(page).waitFor()
      ok((await selectors.chatMessage(page).innerText()).includes('sidebar draft retained'))
      await step('chat-sidebar-revisit-keeps-draft')
      observations.set(page, {
        requests,
        defaultRequests,
        defaultChatModulesAbsent: true,
        fixtureProvider: 'scripted mock',
      })

      await page.unroute(deferredChatModuleRoutes.panel)
      await page.route(deferredChatModuleRoutes.panel, (route) => route.abort('failed'))
      await page.reload()
      await waitForApp(page)
      await selectors.deferredChatError(page, 'panel').waitFor()
      await step('sidebar-module-error-contained')
      await page.unroute(deferredChatModuleRoutes.panel)
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await selectors.deferredChatError(page, 'panel').waitFor()
      await step('failed-module-url-stays-visible')
      await page.getByRole('button', { name: 'Reload app', exact: true }).click()
      await selectors.chatMessage(page).waitFor()
      await step('sidebar-module-recovers-after-reload')

      await page.unroute(deferredChatModuleRoutes.workspace)
      await page.route(deferredChatModuleRoutes.workspace, (route) => route.abort('failed'))
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.deferredChatError(page, 'workspace').waitFor()
      await step('mode-module-error-contained')
      await page.unroute(deferredChatModuleRoutes.workspace)
      await page.getByRole('button', { name: 'Reload app', exact: true }).click()
      await selectors.chatMessage(page).waitFor()
      await step('mode-module-recovers-after-reload')
    } finally {
      surface.resolve()
      panel.resolve()
      await page.unroute(deferredChatModuleRoutes.workspace)
      await page.unroute(deferredChatModuleRoutes.panel)
      const current = new URL(page.url())
      const prefix = current.pathname.startsWith('/platform/') ? '/platform' : ''
      await page.goto(`${current.origin}${prefix}/~-/workbench`)
      await waitForApp(page)
      await selectors.folderTree(page).waitFor({ state: 'detached' })
      await releaseFixture(fixture)
    }
  },
}
