import { ok, strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { changeAppConstant, prepareFixture, showTurnScope } from './checkpoint-states'
import { isolatedNativeScenario } from './native-provider-verification'

type TooltipPart = { readonly text: string; readonly tone?: string }

/** A row tooltip's parts without its status and separators. */
function rowFacts(tooltip: string | null) {
  const parts: TooltipPart[] = JSON.parse(tooltip ?? '[]')
  return parts.filter((part) => part.tone !== 'muted')
}

export const chatGitTurnRows = isolatedNativeScenario({
  name: 'chat-git-turn-rows',
  description:
    'Working tree and Turn scopes of the chat Git tool draw the same file row: one native turn edits a file, and both scopes show it with its status.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { root, step, worktreePath }) {
    await changeAppConstant(page, root, worktreePath)
    await showTurnScope(page)
    const turnRow = selectors
      .turnFiles(page)
      .getByRole('treeitem', { name: /app\.ts/ })
      .first()
    await turnRow.waitFor({ timeout: 15_000 })
    const turnTooltip = await turnRow.getAttribute('data-tooltip')
    await step('turn')

    await selectors.gitDiffScope(page, 'Working tree').click()
    const worktreeRow = selectors.worktreeFiles(page).filter({ hasText: 'app.ts' }).first()
    await worktreeRow.waitFor({ timeout: 15_000 })
    await step('working-tree')

    const worktreeTooltip = await worktreeRow.getAttribute('data-tooltip')
    ok(turnTooltip?.includes(' · '), `Turn rows carry a status: ${turnTooltip}`)
    ok(worktreeTooltip?.includes(' · '), `Working tree rows carry a status: ${worktreeTooltip}`)
    // The status says what each scope means (unstaged vs this turn); path and stat must agree.
    strictEqual(
      JSON.stringify(rowFacts(worktreeTooltip)),
      JSON.stringify(rowFacts(turnTooltip)),
      'Both scopes draw the same path and diff stat for the same change',
    )
  },
})
