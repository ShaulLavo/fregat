import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const SESSION_SCAN_LIMIT = 12

export const chatCardNarrow: Scenario = {
  name: 'chat-card-narrow',
  description: 'A narrow chat stage and a narrow side panel both keep the card readable.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    ok(await openSessionWithCard(page), 'No session in the rail shows a changed-files card')
    const git = selectors.chatToolTab(page, 'Git')
    await git.waitFor({ timeout: 20_000 })
    if (!(await selectors.gitPanel(page).isVisible())) await git.click()
    await selectors.changedFilesViewDiff(page).scrollIntoViewIfNeeded()
    await step('wide')

    await dragHandleLeft(page, selectors.chatToolsHandle(page))
    await selectors.changedFilesViewDiff(page).scrollIntoViewIfNeeded()
    await step('narrow-stage')
    await expectCardFits(page)

    // The editor's side panel has no stage minimum, so it goes narrower still.
    await selectors.workspaceMode(page, 'Workbench').click()
    await selectors.sidebarTab(page, 'Chat').click()
    await selectors.changedFilesViewDiff(page).waitFor({ timeout: 20_000 })
    await dragHandleLeft(page, selectors.sidebarHandle(page))
    await selectors.changedFilesViewDiff(page).scrollIntoViewIfNeeded()
    await step('narrow-side-panel')
    await expectCardFits(page)
  },
}

async function dragHandleLeft(page: Page, handle: Locator) {
  const box = await handle.boundingBox()
  ok(box, 'The panel must have a split to drag')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(80, box.y + box.height / 2, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function expectCardFits(page: Page) {
  const card = await selectors.changedFilesCard(page).boundingBox()
  ok(card, 'The changed-files card must be laid out')
  const right = card.x + card.width + 0.5

  // Every control stays inside the card, however the header has to wrap.
  for (const action of await selectors.changedFilesActions(page).all()) {
    const box = await action.boundingBox()
    if (!box) continue

    const name = (await action.textContent())?.trim().slice(0, 40)
    ok(
      box.x + box.width <= right,
      `Card button "${name}" ends at ${Math.round(box.x + box.width)}, past the card edge at ${Math.round(right)}`,
    )
  }

  // The counts may hide themselves, but never by covering the button beside them.
  const statShown = await selectors.changedFilesStat(page).isVisible()
  const stat = statShown ? await selectors.changedFilesStat(page).boundingBox() : null
  const viewDiff = await selectors.changedFilesViewDiff(page).boundingBox()
  ok(viewDiff, 'The card must keep its diff button')
  if (stat) {
    const overlaps =
      stat.x < viewDiff.x + viewDiff.width &&
      viewDiff.x < stat.x + stat.width &&
      stat.y < viewDiff.y + viewDiff.height &&
      viewDiff.y < stat.y + stat.height
    ok(!overlaps, `Counts ${JSON.stringify(stat)} overlap View diff ${JSON.stringify(viewDiff)}`)
    ok(stat.x + stat.width <= right, 'The counts must stay inside the card')
  }

  // A row of numbers with no filename is the failure this guards.
  const name = await selectors.changedFileName(page).boundingBox()
  ok(name && name.width > 0, 'A changed-file row must still show its name')
}

async function openSessionWithCard(page: Page) {
  const sessions = selectors.sessionRows(page)
  await sessions.first().waitFor({ timeout: 20_000 })
  const count = Math.min(await sessions.count(), SESSION_SCAN_LIMIT)

  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    const shown = await selectors
      .changedFilesViewDiff(page)
      .waitFor({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return true
  }

  return false
}
