import { ok } from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { IsolatedServer } from '../isolated-server'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import type { Scenario } from './index'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

const NAME = 'server-update'
const DESCRIPTION =
  'A staged release shows "Update available"; Restart names a running session, Cancel keeps it, an accepted restart shows "Restarting…", and a failed live check toasts its rollback fix.'
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

/** Links `pending` the way `deploy --server` does, then signals the server the way it does. */
export async function stageRelease(server: IsolatedServer) {
  const release = join(server.productionRoot, 'releases', STAGED)
  await mkdir(release, { recursive: true })
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
    JSON.stringify({ source: '/work/projects/platform', previousRelease: STAGED }),
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
  await selectors.serverUpdateRestart(page).waitFor()
  const staged = await selectors.serverUpdate(page).innerText()
  ok(staged.includes('Update available'), `The status item must announce the update: ${staged}`)
  await step('update-available')

  await selectors.fillChatMessage(page, 'QUEUE_START')
  await selectors.chatSend(page).click()
  await waitForNativeEvent(root, 'turn/start', 'The native turn must start')
  await selectors.serverUpdateRestart(page).click()
  await selectors.restartDialog(page).waitFor()
  const session = (await readShell(page, orchestration)).sessions.find(
    (item) => item.id === sessionId,
  )
  ok(session, 'The running session is in the shell snapshot')
  await selectors.restartDialogSession(page, session.title).waitFor()
  await step('restart-confirmation')

  await selectors.restartDialogCancel(page).click()
  await selectors.restartDialog(page).waitFor({ state: 'hidden' })
  ok(await selectors.chatStop(page).isVisible(), 'Cancel must leave the running turn alone')
  await completeTurn(root)
  await selectors.chatStop(page).waitFor({ state: 'hidden' })

  // An idle server would really exit, and nothing supervises the throwaway one.
  await page.route(restartRoute, (route) =>
    route.fulfill({ contentType: 'application/json', json: { restarting: true } }),
  )
  try {
    await selectors.serverUpdateRestart(page).click()
    await selectors.serverUpdateRestarting(page).waitFor()
    await step('restarting')
  } finally {
    await page.unroute(restartRoute)
  }

  await failLiveCheck(server)
  const toast = selectors.toast(page, 'failed its live check')
  await toast.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(600)
  const text = await toast.innerText()
  ok(text.includes('bun run deploy --rollback'), `The toast must carry the rollback fix: ${text}`)
  await step('live-check-failed')
}

export const serverUpdate: Scenario = {
  name: NAME,
  description: DESCRIPTION,
  async run(page, context) {
    const server = context.server
    ok(server, `${NAME} stages releases for the throwaway API server; drop --shared-dev`)
    await isolatedNativeScenario({
      name: NAME,
      description: DESCRIPTION,
      fixture: new URL('../fixtures/native-queue.mjs', import.meta.url),
      drive: (driven, native) => drive(driven, native, server),
    }).run(page, context)
  },
}
