import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatShell, readShell } from './chat-verification'

export const sessionOrdering: Scenario = {
  name: 'session-ordering',
  description:
    'Move disposable sessions between empty shelves by pointer and keyboard, then verify persisted active ordering after reload.',
  async run(page, { step }) {
    const { base, project, worktree } = await openChatShell(page)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const prefix = `Ordering verification ${first.slice(0, 8)}`
    const title = `${prefix} first`
    for (const [sessionId, label] of [
      [first, title],
      [second, `${prefix} second`],
    ])
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title: label,
        modelSelection: project.defaultModelSelection,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      })
    const pointerTo = async (shelf: 'pinned' | 'active' | 'settled') => {
      const source = await selectors.sessionByTitle(page, title).boundingBox()
      const target = await selectors.sessionShelfTarget(page, shelf).boundingBox()
      ok(source && target)
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
      await page.mouse.down()
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 8)
      await selectors.draggingSession(page).waitFor()
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 12,
      })
      await step(`dragging-${shelf}`)
      await page.mouse.up()
    }
    try {
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionByTitle(page, title).waitFor()
      await step('before-pointer')
      await pointerTo('pinned')
      await step('after-pointer')
      await selectors.sessionInShelf(page, title, 'Pinned').waitFor()
      await step('pointer-empty-pinned')
      await pointerTo('settled')
      await selectors.sessionInShelf(page, title, 'Settled').waitFor()
      await step('pointer-empty-settled')
      await pointerTo('active')
      await selectors.sessionInShelf(page, title, 'Active').waitFor()
      await page.waitForFunction(
        async ({ base, first }) => {
          const response = await fetch(`${base}/shell-snapshot`)
          const snapshot = await response.json()
          return snapshot.sessions.some(
            (session: { id: string; activeOrderKey?: string | null }) =>
              session.id === first && session.activeOrderKey,
          )
        },
        { base, first },
      )
      const active = (await readShell(page, base)).sessions.find((session) => session.id === first)
      ok(active?.activeOrderKey && !active.pinnedAt && active.settledOverride === 'active')
      await step('pointer-active-key')
      await page.reload()
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionInShelf(page, title, 'Active').waitFor()
      ok(
        (await readShell(page, base)).sessions.find((session) => session.id === first)
          ?.activeOrderKey === active.activeOrderKey,
      )
      await selectors.sessionByTitle(page, title).click()
      await page.waitForURL((url) => url.href.includes(first))
      await dispatch(page, base, { type: 'session.delete', sessionId: second })
      await selectors.sessionByTitle(page, `${prefix} second`).waitFor({ state: 'hidden' })
      const row = selectors.sessionByTitle(page, title)
      await row.focus()
      await page.keyboard.press('Space')
      await selectors.draggingSession(page).waitFor()
      await step('keyboard-picked-up')
      await page.keyboard.press('ArrowUp')
      await step('keyboard-first-target')
      await page.keyboard.press('ArrowUp')
      await step('keyboard-second-target')
      await page.keyboard.press('Space')
      await selectors.sessionInShelf(page, title, 'Pinned').waitFor()
      await step('keyboard-empty-pinned-after-reload')
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId: first })
      if ((await readShell(page, base)).sessions.some((session) => session.id === second))
        await dispatch(page, base, { type: 'session.delete', sessionId: second })
    }
  },
}
