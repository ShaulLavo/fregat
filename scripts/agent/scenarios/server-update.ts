import { checkoutRoot } from '../paths'
import { ok } from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { IsolatedServer } from '../isolated-server'
import { selectors } from '../selectors'
import { verifyClientUpdate } from './client-update'
import { readShell } from './chat-verification'
import type { Scenario } from './index'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

const NAME = 'server-update'
const DESCRIPTION =
  'A single Update app control opens affected-session details, waits for a running turn to finish, and keeps failed live-check guidance. Page-only releases use Reload app on desktop and phone.'
const STAGED = '20260925T120000Z-scenario-staged'
const LIVE = '20260925T120500Z-scenario-live'
const restartRoute = /\/server\/restart$/

async function hasNativeEvent(root: string, event: string) {
  return (await nativeLog(root)).some((entry) => entry.event === event)
}

async function waitForNativeEvent(root: string, event: string, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await hasNativeEvent(root, event)) return
    await Bun.sleep(50)
  }
  ok(false, label)
}

async function completeTurn(root: string) {
  const id = crypto.randomUUID()
  await writeFile(join(root, 'queue-control.json'), JSON.stringify({ id, action: 'complete' }))
  await waitForNativeEvent(root, 'control', 'The native fixture must observe complete')
}

/** Links `pending` the way `install-release --server` does, then signals the server the way it does. */
export async function stageRelease(server: IsolatedServer) {
  const release = join(server.productionRoot, 'releases', STAGED)
  await mkdir(join(release, 'server'), { recursive: true })
  await mkdir(join(release, 'web'))
  // The source supervisor serves these identities while promotion validates the release layout.
  await writeFile(join(release, 'server', 'index.js'), 'export {}\n')
  await writeFile(
    join(release, 'web', 'index.html'),
    '<!doctype html><title>Update fixture</title>',
  )
  await symlink(join(checkoutRoot, 'node_modules'), join(release, 'node_modules'))
  await symlink(
    join(checkoutRoot, 'apps/server/node_modules'),
    join(release, 'server/node_modules'),
  )
  await writeFile(
    join(release, 'build-config.json'),
    JSON.stringify({ release: STAGED, source: checkoutRoot, liveCheck: false }),
  )
  await symlink(release, join(server.productionRoot, 'pending'))
  server.signal('SIGUSR2')
}

/** Points `current` at a release whose post-restart live check failed. */
async function failLiveCheck(server: IsolatedServer) {
  const release = join(server.productionRoot, 'releases', LIVE)
  await mkdir(release, { recursive: true })
  await writeFile(
    join(release, 'live-check.json'),
    JSON.stringify({
      release: LIVE,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      fresh: ['GET /platform/ answered 502'],
    }),
  )
  await writeFile(
    join(release, 'build-config.json'),
    JSON.stringify({ source: checkoutRoot, previousRelease: STAGED }),
  )
  await symlink(release, join(server.productionRoot, 'current'))
  server.signal('SIGUSR2')
}

async function drive(
  page: Page,
  context: {
    step: (name: string) => Promise<void>
    root: string
    orchestration: string
    sessionId: string
  },
  server: IsolatedServer,
) {
  const { step, root, orchestration, sessionId } = context
  await stageRelease(server)
  await selectors.serverUpdateApply(page).waitFor()
  const staged = await selectors.serverUpdate(page).innerText()
  ok(staged.trim() === 'Update app', `The status item names the action: ${staged}`)
  await step('update-available')

  await selectors.chatMessage(page).fill('QUEUE_START')
  await selectors.chatSend(page).click()
  await waitForNativeEvent(root, 'turn/start', 'The native turn must start')
  await selectors.serverUpdateApply(page).click()
  await selectors.updatePopover(page).waitFor()
  const session = (await readShell(page, orchestration)).sessions.find(
    (item) => item.id === sessionId,
  )
  ok(session, 'The running session is in the shell snapshot')
  await selectors.updateSession(page, session.title).waitFor()
  await step('restart-confirmation')

  await selectors.updateWhenDone(page).click()
  await selectors.updatePopover(page).waitFor({ state: 'hidden' })
  ok(await selectors.chatStop(page).isVisible(), 'Update when done leaves the running turn alone')

  // Keep this interaction proof connected; server-restart exercises the real exit.
  await page.route(restartRoute, (route) =>
    route.fulfill({ contentType: 'application/json', json: { restarting: true } }),
  )
  try {
    await completeTurn(root)
    await selectors.chatStop(page).waitFor({ state: 'hidden' })
    await selectors.serverUpdating(page).waitFor()
    await step('restarting')
  } finally {
    await page.unroute(restartRoute)
  }

  await failLiveCheck(server)
  const toast = selectors.toast(page, 'Deployment check failed')
  await toast.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(600)
  const text = await toast.innerText()
  ok(text.includes('GET /platform/ answered 502'), `The toast must name the failed check: ${text}`)
  ok(!text.includes('--rollback'), `The toast must not prescribe rollback: ${text}`)
  await step('live-check-failed')
}

export const serverUpdate: Scenario = {
  name: NAME,
  description: DESCRIPTION,
  async run(page, context) {
    const server = context.server
    const initialUrl = page.url()
    ok(server, `${NAME} stages releases for the throwaway API server; drop --shared-dev`)
    await isolatedNativeScenario({
      name: NAME,
      description: DESCRIPTION,
      fixture: new URL('../fixtures/native-queue.mjs', import.meta.url),
      drive: (driven, native) => drive(driven, native, server),
    }).run(page, context)
    await page.goto(initialUrl)
    await verifyClientUpdate(page, {
      ...context,
      step: (name) => context.step(`desktop-${name}`),
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await selectors.phoneShell(page).waitFor()
    await verifyClientUpdate(page, {
      ...context,
      step: (name) => context.step(`phone-${name}`),
    })
  },
}
