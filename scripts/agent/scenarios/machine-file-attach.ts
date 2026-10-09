import { equal, ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { chooseColorMode, selectors } from '../selectors'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

type Step = (label: string) => Promise<void>

/**
 * A session's composer on a fixture project holding `notes.md` and `docs/guide.md`. The browser
 * here is not verifiably the server's machine (no native chooser helper), so the paperclip offers
 * that machine's files.
 */
async function withProjectSession(
  page: Page,
  slug: string,
  drive: () => Promise<void>,
  step: Step,
) {
  const originalUrl = page.url()
  const fixture = await createModifiedFileFixture(slug, 'notes.md', ['# Notes'], ['# Notes', ''])
  try {
    await mkdir(path.join(fixture, 'docs'))
    await writeFile(path.join(fixture, 'docs', 'guide.md'), '# Guide\n')
    const base = await openFixtureChat(page, fixture)
    await createSessions(page, base, fixture)
    await page.reload()
    await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click({ timeout: 20_000 })
    await selectors.chatMessage(page).waitFor({ timeout: 20_000 })
    await chooseColorMode(page, 'dark')
    await drive()
  } catch (error) {
    await step('failed')
    throw error
  } finally {
    await page.goto(originalUrl)
    await releaseFixture(fixture)
  }
}

/** Opens "From <machine>…", chooses notes.md and docs/guide.md, and attaches both. */
async function attachTwoFromMachine(page: Page, step: Step, touch: boolean) {
  await selectors.chatAttach(page).click()
  const fromMachine = selectors.chatAttachMachineFiles(page)
  await fromMachine.waitFor()
  await selectors.chatAttachDeviceFiles(page).waitFor()
  await step('attach-menu')
  await fromMachine.click()

  const notes = selectors.filesPickerRow(page, 'notes.md')
  await notes.waitFor({ timeout: 20_000 })
  equal(await notes.getAttribute('aria-checked'), 'false', 'A file in the project can be chosen')
  await step('picker-opens-in-project')
  await notes.click()
  equal(await notes.getAttribute('aria-checked'), 'true', 'A tap or click chooses the file')

  const docs = selectors.filesPickerRow(page, 'docs')
  equal(await docs.getAttribute('aria-checked'), null, 'A folder is never a choice')
  // A tap opens a folder on a phone; a desktop opens it with a double click.
  if (touch) await docs.click()
  else await docs.dblclick()
  const guide = selectors.filesPickerRow(page, 'guide.md')
  await guide.click()
  equal(await guide.getAttribute('aria-checked'), 'true')
  const attach = selectors.filesPickerAttach(page)
  equal(await attach.textContent(), 'Attach 2 files')
  await step('two-files-chosen')
  await attach.click()

  await selectors.filesPickerDialog(page).waitFor({ state: 'detached' })
  await selectors.chatStagedFile(page, 'notes.md').waitFor({ timeout: 20_000 })
  await selectors.chatStagedFile(page, 'guide.md').waitFor()
  await selectors.chatMessage(page).fill('Read the two attached notes.')
  await page.getByRole('status').getByText('Preparing attachments…').waitFor({ state: 'detached' })
  ok(await selectors.chatSend(page).isEnabled(), 'Both files arrive ready to send')
  await step('two-files-attached')
}

export const machineFileAttach: Scenario = {
  name: 'machine-file-attach',
  description:
    'Desktop: the paperclip offers the project machine’s files where this browser is not verifiably that machine; the picker opens in the project, two files from two folders are chosen and attached ready to send. A verified local desktop sees no such offer.',
  capture: { width: 1440, height: 900 },
  requiresIsolatedServer: true,
  async run(page, { step }) {
    await withProjectSession(
      page,
      'machine-file-attach',
      async () => {
        await attachTwoFromMachine(page, step, false)
        // A browser the server verifies as its own desktop browses those disks itself.
        await page.route(/\/system\/capabilities(\?|$)/, async (route) => {
          const response = await route.fetch()
          const json = { ...(await response.json()), nativePicker: true }
          await route.fulfill({ response, json })
        })
        try {
          await page.reload()
          await selectors.chatMessage(page).waitFor({ timeout: 20_000 })
          await selectors.chatAttach(page).click()
          // The menu settles once the check answers; until then it offers the machine's files.
          await selectors.chatAttachMenuItem(page, 'Attach files…').waitFor()
          equal(await selectors.chatAttachMachineFiles(page).count(), 0)
          await step('local-desktop-no-offer')
          await page.keyboard.press('Escape')
        } finally {
          await page.unroute(/\/system\/capabilities(\?|$)/)
        }
      },
      step,
    )
  },
}

export const phoneMachineFileAttach: Scenario = {
  name: 'phone-machine-file-attach',
  description:
    'At a touch phone viewport: the paperclip’s "From <machine>…" opens the phone picker in the project; a tap opens a folder, a tap chooses a file, and two files attach ready to send.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  requiresIsolatedServer: true,
  async run(page, { step }) {
    await withProjectSession(
      page,
      'phone-machine-file-attach',
      () => attachTwoFromMachine(page, step, true),
      step,
    )
  },
}
