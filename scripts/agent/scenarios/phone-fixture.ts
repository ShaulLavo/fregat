import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { fixtureApiBase } from '../fixture-workspace'
import { dispatch, readShell } from './chat-verification'
import { writeSettings } from './native-provider-verification'

export const PHONE_SESSIONS = [
  'Fix the flaky upload test',
  'Review the release notes',
  'Tidy the settings copy',
]
export const PHONE_REPLY = 'The upload now retries three times, then reports why it gave up.'

/** Lands on the fixture's chat address and returns the orchestration base its socket reached. */
export async function openFixtureChat(page: Page, fixture: string) {
  const current = new URL(page.url())
  const prefix = current.pathname.startsWith('/platform/') ? '/platform' : ''
  const response = await page.request.post(`${fixtureApiBase(page)}/fs/workspace-address`, {
    data: { path: fixture.slice(1) },
    headers: { Origin: current.origin },
  })
  ok(response.ok(), `Fixture workspace failed: ${response.status()}`)
  const workspace = (await response.json()) as { id: string; name: string }
  const connected = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname.endsWith('/orchestration/rpc'),
  })
  const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
  await page.goto(`${current.origin}${prefix}/~${token}/chat`)
  const socket = new URL((await connected).url())
  return `${socket.origin.replace(/^ws/, 'http')}${socket.pathname.replace(/\/rpc$/, '')}`
}

/** Sessions on a scripted mock provider, so a turn runs without reaching any real model. */
export async function createSessions(page: Page, base: string, fixture: string, extra = 0) {
  const worktree = await fixtureWorktree(page, base, fixture)
  const providerInstanceId = `phone-shell-${crypto.randomUUID()}`
  await writeSettings(page, base.replace(/\/orchestration$/, ''), [
    {
      kind: 'provider.setEnabled',
      providerInstanceId,
      enabled: true,
      createIfMissing: {
        driverKind: 'mock',
        displayLabel: 'Scripted mock',
        config: { responseText: PHONE_REPLY },
      },
    },
  ])
  // The extra sessions first, so the named ones are newest and top the list.
  const titles = [
    ...Array.from({ length: extra }, (_, index) => `Older task ${index + 1}`),
    ...PHONE_SESSIONS,
  ]
  for (const title of titles)
    await dispatch(page, base, {
      type: 'session.create',
      sessionId: crypto.randomUUID(),
      title,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      modelSelection: { providerInstanceId, model: 'gpt-5.5' },
    })
}

// A fresh server registers the workspace while the page boots, so the first snapshot can miss it.
export async function fixtureWorktree(page: Page, base: string, fixture: string) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const snapshot = await readShell(page, base)
    // Worktree paths are root-relative.
    const worktree = snapshot.worktrees.find((item) => item.path === fixture.slice(1))
    if (worktree) return worktree
    ok(
      Date.now() < deadline,
      `The fixture worktree must be registered: ${snapshot.worktrees.map((item) => item.path).join(', ')}`,
    )
    await page.waitForTimeout(200)
  }
}
