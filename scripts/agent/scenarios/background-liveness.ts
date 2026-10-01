import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import { runInFixtureRepository } from './fixture-repository'
import type { Scenario } from './index'
import { readShell, typePrompt } from './chat-verification'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

export const backgroundLiveness = isolatedNativeScenario({
  name: 'background-liveness',
  description:
    'Parent completion keeps a live child working; child idle and late metadata stay ready.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId }) {
    const title = `background-liveness verification ${sessionId.slice(0, 8)}`
    await selectors.chatMessage(page).fill('Run the isolated child fixture.')
    await selectors.chatSend(page).click()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const shell = await readShell(page, orchestration)
      const session = shell.sessions.find((entry) => entry.id === sessionId)
      if (session?.latestTurn?.state === 'completed' && session.backgroundLiveness === 'working')
        break
      if (attempt === 99) ok(false, 'Completed parent retains working background child')
      await Bun.sleep(50)
    }
    await selectors.sessionStatus(page, title, 'Working').waitFor()
    await step('parent-complete-child-working')
    await writeFile(join(root, 'background-step'), 'idle')
    await selectors.sessionStatus(page, title, 'Ready').waitFor()
    await step('child-idle-ready')
    await writeFile(join(root, 'background-step'), 'metadata')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await nativeLog(root)).some((entry) => entry.event === 'background-metadata')) break
      if (attempt === 99) ok(false, 'Native late metadata emitted')
      await Bun.sleep(50)
    }
    await page.reload()
    await selectors.sessionStatus(page, title, 'Ready').waitFor()
    const session = (await readShell(page, orchestration)).sessions.find(
      (entry) => entry.id === sessionId,
    )
    equal(session?.backgroundLiveness ?? null, null)
    await step('late-metadata-still-ready-after-reload')
  },
})

export const backgroundMonitorLiveness: Scenario = {
  name: 'background-monitor-liveness',
  requiresIsolatedServer: true,
  description: 'Native live rosters settle a completed parent from Working to Monitoring to Ready.',
  run: (page, { step }) =>
    runInFixtureRepository(
      page,
      step,
      { kind: 'claude', name: 'background-monitor-liveness' },
      async ({ openSession, native, orchestration }) => {
        const sessionId = await openSession('Monitor lifecycle')
        const title = `Monitor lifecycle ${sessionId.slice(0, 8)}`
        await typePrompt(page, 'Reply with exactly MONITOR_FIXTURE_READY.')
        await selectors.chatSend(page).click()
        await selectors.sessionStatus(page, title, 'Working').waitFor({ timeout: 30_000 })
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const session = (await readShell(page, orchestration)).sessions.find(
            (entry) => entry.id === sessionId,
          )
          if (session?.latestTurn?.state === 'completed') break
          if (attempt === 99) ok(false, 'Parent completed while native background work remains')
          await Bun.sleep(50)
        }
        await step('native-parent-completed-working')
        await writeFile(join(native.root, 'background-step'), 'monitor')
        await selectors.sessionStatus(page, title, 'Monitoring').waitFor({ timeout: 15_000 })
        equal(
          (await readShell(page, orchestration)).sessions.find((entry) => entry.id === sessionId)
            ?.backgroundLiveness,
          'monitoring',
        )
        await step('native-monitor-only')
        await writeFile(join(native.root, 'background-step'), 'ready')
        await selectors.sessionStatus(page, title, 'Ready').waitFor({ timeout: 15_000 })
        await step('native-empty-roster-ready')
        await writeFile(join(native.root, 'background-step'), 'late')
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if ((await nativeLog(native.root)).some((entry) => entry.event === 'background-late'))
            break
          if (attempt === 99) ok(false, 'Delayed native bookends emitted')
          await Bun.sleep(50)
        }
        await page.reload()
        await selectors.sessionStatus(page, title, 'Ready').waitFor({ timeout: 15_000 })
        equal(
          (await readShell(page, orchestration)).sessions.find((entry) => entry.id === sessionId)
            ?.backgroundLiveness ?? null,
          null,
        )
        await step('late-bookends-ready-after-reload')
      },
    ),
}
