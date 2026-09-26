import type { Page } from 'playwright'

import { measurePress, pressStampScript, type PressTiming } from '../press-timing'
import { chatMessagesLogSelector, selectors } from '../selectors'
import { dispatch, openChat, readShell } from './chat-verification'
import { sendPrompt, settingsSnapshot, writeSettings } from './native-provider-verification'
import type { Scenario } from './index'

const results = new WeakMap<Page, PressTiming[]>()

// "Text" is the session's first prompt on screen; "colour" is its first rendered answer.
function sampler(needle: string) {
  return `() => {
    const log = document.querySelector(${JSON.stringify(chatMessagesLogSelector)})
    const text = log !== null && log.checkVisibility() && (log.textContent || '').includes(${JSON.stringify(needle)})
    const colour = text && document.querySelector(${JSON.stringify(selectors.chatMarkdownSelector)}) !== null
    return { t: performance.now(), text, colour, preview: false }
  }`
}

async function measure(page: Page, name: string, needle: string, press: () => Promise<void>) {
  await page.waitForTimeout(1500)
  const timing = await measurePress(page, name, sampler(needle), press)
  results.get(page)?.push(timing)
  console.log(JSON.stringify(timing))
}

async function waitForWorktree(page: Page, orchestration: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const worktree = (await readShell(page, orchestration)).worktrees[0]
    if (worktree) return worktree
    await page.waitForTimeout(100)
  }
  throw new Error('The chat shell listed no worktree')
}

export const prefetchChatSwitch: Scenario = {
  name: 'prefetch-chat-switch',
  description:
    'Milliseconds from a session-row press to its first message and first rendered answer: first visit after a reload, revisit, and after a 1.5 s hover. Sessions run on the mock provider.',
  inspect: async (page) => results.get(page) ?? null,
  async run(page, { step }) {
    results.set(page, [])
    await page.addInitScript(pressStampScript)
    const orchestration = await openChat(page)
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const providerInstanceId = `prefetch-${crypto.randomUUID()}`
    await writeSettings(page, base, [
      {
        kind: 'provider.setEnabled',
        providerInstanceId,
        enabled: true,
        createIfMissing: {
          driverKind: 'mock',
          displayLabel: 'Prefetch mock',
          config: { script: 'turn-anatomy', stepDelayMs: 0 },
        },
      },
    ])
    const worktree = await waitForWorktree(page, orchestration)
    const tag = crypto.randomUUID().slice(0, 6)
    const sessions = ['A', 'B', 'C', 'D'].map((letter) => ({
      id: crypto.randomUUID(),
      title: `prefetch ${tag} ${letter}`,
      prompt: `PROMPT${letter}${tag} explain the failing test`,
    }))
    try {
      for (const session of sessions) {
        await dispatch(page, orchestration, {
          type: 'session.create',
          sessionId: session.id,
          title: session.title,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
          modelSelection: { providerInstanceId, model: 'gpt-5.5' },
        })
        await selectors.sessionSearch(page).fill(`prefetch ${tag}`)
        await selectors.sessionByTitle(page, session.title).click()
        await page.waitForURL((url) => url.href.includes(session.id))
        await selectors.chatMessage(page).waitFor()
        await page.waitForTimeout(500)
        await sendPrompt(page, session.prompt)
        await page.waitForTimeout(1500)
        await selectors.liveActivityRow(page).waitFor({ state: 'detached', timeout: 60_000 })
      }
      await step('sessions')

      await page.reload()
      await selectors.sessionSearch(page).waitFor({ timeout: 30_000 })
      await selectors.sessionSearch(page).fill(`prefetch ${tag}`)
      await selectors.sessionByTitle(page, sessions[0]!.title).waitFor({ timeout: 20_000 })
      const row = (index: number) => () =>
        selectors.sessionByTitle(page, sessions[index]!.title).click()
      for (const [index, label] of [
        [0, 'session A, first after reload'],
        [1, 'session B, first visit'],
        [2, 'session C, first visit'],
        [0, 'session A, revisit'],
        [1, 'session B, revisit'],
      ] as const) {
        await measure(page, label, sessions[index]!.prompt, row(index))
      }
      await selectors.sessionByTitle(page, sessions[3]!.title).hover()
      await page.waitForTimeout(1500)
      await measure(page, 'session D, first visit after 1.5 s hover', sessions[3]!.prompt, () =>
        page.mouse.down().then(() => page.mouse.up()),
      )
      await step('switched')
    } finally {
      for (const session of sessions) {
        await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId: session.id })
        await dispatch(page, orchestration, { type: 'session.delete', sessionId: session.id })
      }
      const current = await settingsSnapshot(page, base)
      const remaining = current.values['providers.instances'].filter(
        (item) => item.providerInstanceId !== providerInstanceId,
      )
      const originallySet =
        before.layers.find((layer) => layer.id === 'user')?.raw['providers.instances'] !== undefined
      await writeSettings(page, base, [
        originallySet
          ? { kind: 'set', key: 'providers.instances', value: remaining }
          : { kind: 'reset', keys: ['providers.instances'] },
      ])
    }
  },
}
