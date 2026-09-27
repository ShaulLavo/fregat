import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '../../../packages/contracts/src/index'
import { dispatch, openChat, readShell } from './chat-verification'
import { isDraftChatUrl } from './draft-sessions'

/** Mod+Z only belongs to the rail while focus sits outside text, editors, terminals and the tree. */
async function focusRail(page: Page) {
  await selectors.sessionShelfTarget(page, 'pinned').click()
}

/** Waits out the notice's enter transition so the step screenshot shows it whole. */
async function noticeShown(page: Page, text: string) {
  const notice = selectors.undoNotice(page, text)
  await notice.waitFor()
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await notice.evaluate((element) => getComputedStyle(element).opacity)) === '1') return
    await page.waitForTimeout(50)
  }
}

async function pinnedOrder(page: Page, titles: readonly string[]) {
  const shown = await selectors
    .shelfRowTitles(page, 'Pinned')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('title')))
  return shown.filter(
    (title, index) => title && titles.includes(title) && shown[index - 1] !== title,
  )
}

export const sessionUndo: Scenario = {
  name: 'session-undo',
  description:
    'Unpin, settle, snooze and archive disposable sessions, then undo each by the notice button and by Mod+Z: pin keys and order return, the archived viewed session reopens, the composer keeps its own undo, Mod+Z does nothing once a notice closes, stacked notices each undo their own action, and repeated Undo/Redo restores rows.',
  async run(page, { step }) {
    const base = await openChat(page)
    const shell = await readShell(page, base)
    const worktree = shell.worktrees.find((item) => item.path.endsWith('/projects/platform'))
    ok(worktree, 'Platform worktree must be registered')
    // No turn runs here, so a throwaway owner's project without a default model still works.
    const modelSelection = shell.projects.find((item) => item.id === worktree.projectId)
      ?.defaultModelSelection ?? {
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      model: 'gpt-5.5',
    }
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const
    const prefix = `Undo verification ${ids[0].slice(0, 8)}`
    const [alpha, bravo, charlie] = ['alpha', 'bravo', 'charlie'].map((name) => `${prefix} ${name}`)
    const [alphaId, bravoId, charlieId] = ids
    const session = async (id: string) =>
      (await readShell(page, base)).sessions.find((candidate) => candidate.id === id)
    const act = async (title: string, label: string) => {
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, label).click()
    }
    const undoByKey = async () => {
      await focusRail(page)
      await page.keyboard.press('ControlOrMeta+z')
    }
    try {
      for (const [index, title] of [alpha, bravo, charlie].entries())
        await dispatch(page, base, {
          type: 'session.create',
          sessionId: ids[index],
          title,
          modelSelection,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        })
      await dispatch(page, base, { type: 'session.pin', sessionId: bravoId, orderKey: 'g' })
      await dispatch(page, base, { type: 'session.pin', sessionId: alphaId, orderKey: 'n' })
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionInShelf(page, alpha, 'Pinned').waitFor()
      deepStrictEqual(await pinnedOrder(page, [alpha, bravo]), [bravo, alpha])
      await step('pinned-order')

      await act(bravo, 'Unpin')
      await selectors.sessionInShelf(page, bravo, 'Active').waitFor()
      await noticeShown(page, '1 unpinned')
      await step('unpinned-notice')
      await selectors.toastUndo(page, '1 unpinned').click()
      await selectors.sessionInShelf(page, bravo, 'Pinned').waitFor()
      strictEqual((await session(bravoId))?.pinOrderKey, 'g')
      deepStrictEqual(await pinnedOrder(page, [alpha, bravo]), [bravo, alpha])
      await step('unpin-undone-by-button')

      await act(bravo, 'Unpin')
      await selectors.sessionInShelf(page, bravo, 'Active').waitFor()
      await undoByKey()
      await selectors.sessionInShelf(page, bravo, 'Pinned').waitFor()
      strictEqual((await session(bravoId))?.pinOrderKey, 'g')
      deepStrictEqual(await pinnedOrder(page, [alpha, bravo]), [bravo, alpha])
      await step('unpin-undone-by-mod-z')

      await act(charlie, 'Mark as settled')
      await selectors.sessionInShelf(page, charlie, 'Settled').waitFor()
      await selectors.undoNotice(page, '1 settled').waitFor()
      await selectors.toastUndo(page, '1 settled').click()
      await selectors.sessionInShelf(page, charlie, 'Active').waitFor()
      await step('settle-undone-by-button')

      await act(alpha, 'Mark as settled')
      await selectors.sessionInShelf(page, alpha, 'Settled').waitFor()
      ok(!(await session(alphaId))?.pinnedAt, 'Settling clears the pin')
      await step('pinned-row-settled')
      await undoByKey()
      await selectors.sessionInShelf(page, alpha, 'Pinned').waitFor()
      strictEqual((await session(alphaId))?.pinOrderKey, 'n')
      deepStrictEqual(await pinnedOrder(page, [alpha, bravo]), [bravo, alpha])
      await step('settle-undone-by-mod-z-restores-pin')

      await act(charlie, 'Snooze…')
      await selectors.snoozePreset(page).click()
      await selectors.snoozeDialog(page).waitFor({ state: 'hidden' })
      await selectors.sessionInShelf(page, charlie, 'Snoozed').waitFor()
      await undoByKey()
      await selectors.sessionInShelf(page, charlie, 'Active').waitFor()
      strictEqual((await session(charlieId))?.snoozedUntil, null)
      await step('snooze-undone-by-mod-z')

      await selectors.sessionByTitle(page, charlie).click()
      await page.waitForURL((url) => url.href.includes(charlieId))
      await act(charlie, 'Archive')
      await page.waitForURL(isDraftChatUrl)
      await noticeShown(page, '1 archived')
      await step('viewed-session-archived')
      await selectors.toastUndo(page, '1 archived').click()
      await page.waitForURL((url) => url.href.includes(charlieId))
      await selectors.sessionInShelf(page, charlie, 'Active').waitFor()
      strictEqual((await session(charlieId))?.archivedAt, null)
      await step('archive-undone-by-button-reopens')

      await act(charlie, 'Archive')
      await page.waitForURL(isDraftChatUrl)
      await undoByKey()
      await page.waitForURL((url) => url.href.includes(charlieId))
      strictEqual((await session(charlieId))?.archivedAt, null)
      await step('archive-undone-by-mod-z-reopens')

      const draft = 'draft kept by its own undo'
      await selectors.chatMessage(page).fill(draft)
      await act(charlie, 'Mark as settled')
      await selectors.sessionInShelf(page, charlie, 'Settled').waitFor()
      await selectors.chatMessage(page).click()
      strictEqual((await selectors.chatMessage(page).textContent())?.trim(), draft)
      await page.keyboard.press('ControlOrMeta+z')
      await page.waitForTimeout(500)
      ok(
        (await selectors.chatMessage(page).textContent())?.trim() !== draft,
        'Mod+Z in the composer undoes its own text',
      )
      strictEqual((await session(charlieId))?.settledOverride, 'settled')
      await noticeShown(page, '1 settled')
      await step('composer-keeps-its-own-undo')
      await undoByKey()
      await selectors.sessionInShelf(page, charlie, 'Active').waitFor()
      await step('settle-undone-after-composer')

      await act(charlie, 'Mark as settled')
      await selectors.sessionInShelf(page, charlie, 'Settled').waitFor()
      await selectors.undoNotice(page, '1 settled').waitFor({ state: 'hidden', timeout: 8_000 })
      await undoByKey()
      await page.waitForTimeout(500)
      strictEqual((await session(charlieId))?.settledOverride, 'settled')
      await step('mod-z-after-notice-expires-changes-nothing')

      await act(bravo, 'Mark as settled')
      await act(charlie, 'Archive')
      await page.waitForURL(isDraftChatUrl)
      await noticeShown(page, '1 archived')
      await selectors.undoNotice(page, '1 settled').waitFor()
      strictEqual(await selectors.sessionUndoNotices(page).count(), 2)
      await step('two-notices-stacked')
      await selectors.undoNotice(page, '1 archived').hover()
      await step('two-notices-expanded')
      await selectors.toastUndo(page, '1 settled').click()
      await selectors.sessionInShelf(page, bravo, 'Pinned').waitFor()
      ok((await session(charlieId))?.archivedAt, 'The settle Undo leaves the archive alone')
      await undoByKey()
      await page.waitForURL((url) => url.href.includes(charlieId))
      await step('each-notice-undoes-its-own-action')

      await act(alpha, 'Unpin')
      await selectors.sessionInShelf(page, alpha, 'Active').waitFor()
      await act(charlie, 'Archive')
      await page.waitForURL(isDraftChatUrl)
      await undoByKey()
      await page.waitForURL((url) => url.href.includes(charlieId))
      await undoByKey()
      await selectors.sessionInShelf(page, alpha, 'Pinned').waitFor()
      strictEqual((await session(alphaId))?.pinOrderKey, 'n')
      await step('two-actions-undone')
      await focusRail(page)
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await selectors.sessionInShelf(page, alpha, 'Active').waitFor()
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await page.waitForURL(isDraftChatUrl)
      await step('two-actions-redone')
      await undoByKey()
      await page.waitForURL((url) => url.href.includes(charlieId))
      await step('archive-reopened-again')

      await act(bravo, 'Snooze…')
      await selectors.snoozePreset(page).click()
      await selectors.snoozeDialog(page).waitFor({ state: 'hidden' })
      await selectors.sessionInShelf(page, bravo, 'Snoozed').waitFor()
      await act(bravo, 'Mark as settled')
      await noticeShown(page, '1 settled')
      await selectors.undoNotice(page, '1 settled').hover()
      ok(await selectors.toastUndo(page, '1 snoozed').isDisabled())
      await selectors.undoNotice(page, 'Undid 1 archived').waitFor({ state: 'hidden' })
      await step('same-session-older-undo-disabled-and-redo-discarded')
      await undoByKey()
      await selectors.sessionInShelf(page, bravo, 'Snoozed').waitFor()
      await selectors.undoNotice(page, 'Undid 1 settled').hover()
      await selectors.toastUndo(page, '1 snoozed').click()
      await selectors.sessionInShelf(page, bravo, 'Pinned').waitFor()
      strictEqual((await session(bravoId))?.pinOrderKey, 'g')
      await step('same-session-actions-undone-in-order')
      await focusRail(page)
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await selectors.sessionInShelf(page, bravo, 'Snoozed').waitFor()
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await selectors.sessionInShelf(page, bravo, 'Settled').waitFor()
      await step('same-session-actions-redone-in-order')
    } finally {
      for (const sessionId of ids) {
        if (!(await session(sessionId))) continue
        await dispatch(page, base, { type: 'session.delete', sessionId })
      }
    }
  },
}
