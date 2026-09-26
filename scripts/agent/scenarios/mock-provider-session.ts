import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { settingsSnapshot, writeSettings } from './native-provider-verification'

/**
 * A mock provider instance with `config`, and a session on it opened in the chat. `cleanup`
 * stops and deletes the session and puts the provider instances back as they were.
 */
export async function createMockProviderSession(
  page: Page,
  orchestration: string,
  input: {
    readonly name: string
    readonly displayLabel: string
    readonly config: object
    /** The checkout the session runs in; the first registered one when absent. */
    readonly worktreeId?: string
  },
) {
  const base = orchestration.replace(/\/orchestration$/, '')
  const before = await settingsSnapshot(page, base)
  const originallySet =
    before.layers.find((layer) => layer.id === 'user')?.raw['providers.instances'] !== undefined
  const originalInstances = before.values['providers.instances']
  const providerInstanceId = `${input.name}-${crypto.randomUUID()}`
  const sessionId = crypto.randomUUID()
  const title = `${input.name} ${sessionId.slice(0, 8)}`
  await writeSettings(page, base, [
    {
      kind: 'provider.setEnabled',
      providerInstanceId,
      enabled: true,
      createIfMissing: {
        driverKind: 'mock',
        displayLabel: input.displayLabel,
        config: input.config,
      },
    },
  ])
  const worktreeId = input.worktreeId ?? (await firstWorktree(page, orchestration)).id
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId },
    modelSelection: { providerInstanceId, model: 'gpt-5.5' },
  })
  await selectors.sessionSearch(page).fill(title)
  await selectors.sessionByTitle(page, title).click()
  await page.waitForURL((url) => url.href.includes(sessionId))

  const cleanup = async () => {
    await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
    await dispatch(page, orchestration, { type: 'session.delete', sessionId })
    const current = await settingsSnapshot(page, base)
    const remaining = current.values['providers.instances'].filter(
      (item) => item.providerInstanceId !== providerInstanceId,
    )
    const unchanged = JSON.stringify(remaining) === JSON.stringify(originalInstances)
    await writeSettings(page, base, [
      !originallySet && unchanged
        ? { kind: 'reset', keys: ['providers.instances'] }
        : { kind: 'set', key: 'providers.instances', value: remaining },
    ])
  }
  return { base, cleanup, sessionId }
}

async function firstWorktree(page: Page, base: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, base)).worktrees[0]
    if (worktree) return worktree
    await page.waitForTimeout(100)
  }
  ok(false, 'A worktree exists')
}
