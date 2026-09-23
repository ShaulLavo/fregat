import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from 'playwright'
import type { Scenario } from './index'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

/** Mirrors `COMPACT_ACTIONS_WIDTH` in chat-input-actions.tsx. */
const COMPACT_ACTIONS_WIDTH = 380

export const chatComposerInsert: Scenario = {
  name: 'chat-composer-insert',
  description:
    'Diff lines sent to the agent and a path dropped on the composer both land in it with the caret there, and the action row is compact exactly when it measures narrow.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-composer-insert-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await writeFile(path.join(fixture, 'a.ts'), 'const a = 1\n')
      await fixtureGit(fixture, ['add', 'a.ts'])
      await fixtureGit(fixture, [
        '-c',
        'user.email=f@example.com',
        '-c',
        'user.name=F',
        'commit',
        '--quiet',
        '-m',
        'initial',
      ])
      await writeFile(path.join(fixture, 'a.ts'), 'const changed = true\n')

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      const row = selectors.diffRows(page).filter({ hasText: 'const changed = true' }).first()
      await row.hover({ position: { x: 40, y: 8 } })
      await page.mouse.down()
      await page.mouse.up()
      await selectors.askAgentAboutLines(page).click()

      const composer = selectors.chatMessage(page)
      await composer.waitFor({ timeout: 15_000 })
      await expectFocusedWith(page, 'a.ts', 'diff lines')
      await step('diff-lines-in-composer')
      await expectCompactMatchesWidth(page, 'side panel')

      await clearComposer(page)
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.composerActions(page).waitFor()
      await expectCompactMatchesWidth(page, 'chat stage')
      await step('chat-stage')

      // Start unfocused, so the focus the drop gives is the drop's own.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await dropTreePath(page, `${path.join(fixture, 'a.ts').slice(1)}`)
      await expectFocusedWith(page, 'a.ts', 'dropped path')
      await step('dropped-mention')
      await clearComposer(page)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function expectFocusedWith(page: Page, text: string, what: string) {
  const composer = selectors.chatMessage(page)
  await page
    .waitForFunction(
      ({ element, text }) =>
        element !== null &&
        element === document.activeElement &&
        (element.textContent ?? '').includes(text),
      { element: await composer.elementHandle(), text },
      { timeout: 5_000 },
    )
    .catch(async () => {
      const state = await composer.evaluate((element) => ({
        focused: element === document.activeElement,
        active: document.activeElement?.outerHTML.slice(0, 120),
        text: element.textContent,
      }))
      throw createScriptError(
        `The ${what} did not land focused in the composer: ${JSON.stringify(state)}`,
      )
    })
}

async function expectCompactMatchesWidth(page: Page, where: string) {
  const { compact, width } = await selectors.composerActions(page).evaluate((element) => ({
    compact: element.getAttribute('data-compact'),
    width: element.clientWidth,
  }))
  const expected = String(width < COMPACT_ACTIONS_WIDTH)
  if (compact === expected) return

  throw createScriptError(
    `In the ${where} the action row is ${width}px wide but data-compact is ${compact}`,
  )
}

/**
 * The payload a file tree row drags: its root-relative path as text/plain.
 * Playwright's dragTo never completes the tree's drag onto the composer.
 */
async function dropTreePath(page: Page, rootRelativePath: string) {
  await selectors.chatMessage(page).evaluate((editor, value) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', value)
    for (const type of ['dragover', 'drop']) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer })
      editor.dispatchEvent(event)
    }
  }, rootRelativePath)
}

async function clearComposer(page: Page) {
  await selectors.chatMessage(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
}
