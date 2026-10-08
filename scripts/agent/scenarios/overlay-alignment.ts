import { ok } from 'node:assert/strict'
import type { Locator } from 'playwright'
import {
  overlayAlignmentSelectors as alignment,
  selectors,
  settleRunningAnimations,
} from '../selectors'
import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { openFixtureChat, createSessions } from './phone-fixture'
import { expectPhoneSafeAreas } from './phone-safe-areas'
import type { Scenario } from './index'

type Measurement = { name: string; delta: number }

async function left(locator: Locator) {
  const box = await locator.boundingBox()
  ok(box, 'The measured element must be visible')
  return box.x
}

export const overlayAlignment: Scenario = {
  name: 'overlay-alignment',
  description:
    'Measure palette input, row icons and text, project-menu labels, modified Settings labels and descriptions, and dialog edges in cozy and compact density. Record geometry and screenshots before asserting a half-pixel tolerance.',
  requiresIsolatedServer: true,
  capture: { width: 1440, height: 1000 },
  async run(page, { step, evidence, server }) {
    ok(server, 'Alignment writes require the throwaway server')
    const measurements: Measurement[] = []
    const note = (name: string, a: number, b: number) => measurements.push({ name, delta: a - b })
    for (const density of ['cozy', 'compact']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.density = value
      }, density)
      for (const [mode, chord, query] of [
        ['commands', 'Control+Shift+P', '>'],
        ['quick-open', 'Control+p', 'package.json'],
      ]) {
        await page.keyboard.press(chord!)
        const input = selectors.paletteInput(page)
        await input.waitFor()
        await input.fill(query!)
        const row =
          mode === 'quick-open'
            ? selectors.paletteOptions(page).filter({ hasText: 'package.json' }).first()
            : selectors.paletteOptions(page).first()
        await row.waitFor()
        await settleRunningAnimations(page)
        const start = await input.evaluate((node) => {
          const style = getComputedStyle(node)
          return (
            node.getBoundingClientRect().x +
            parseFloat(style.paddingLeft) +
            parseFloat(style.borderLeftWidth)
          )
        })
        note(`${density}/${mode}/text`, await left(alignment.rowLabel(row)), start)
        note(
          `${density}/${mode}/icon`,
          await left(alignment.rowIcon(row)),
          await left(alignment.inputIcon(page)),
        )
        await step(`${density}-${mode}`)
        await page.keyboard.press('Escape')
      }
      await selectors.projectMenu(page).click()
      const open = selectors.openFolderMenu(page)
      await open.waitFor()
      await settleRunningAnimations(page)
      const icon = alignment.menuIcon(open)
      const iconBox = await icon.boundingBox()
      ok(iconBox)
      const gap = await open.evaluate((node) => parseFloat(getComputedStyle(node).columnGap))
      for (const [index, label] of (await alignment.menuLabels(page).all()).entries()) {
        note(
          `${density}/project-menu/text-${index}`,
          await left(label),
          iconBox.x + iconBox.width + gap,
        )
      }
      await step(`${density}-project-menu`)
      await selectors.openFolderMenu(page).click()
      const picker = selectors.pickerDialog(page)
      await picker.waitFor()
      await settleRunningAnimations(page)
      const pickerBox = await picker.boundingBox()
      const pickerButton = await alignment.pickerFooterButton(page).boundingBox()
      ok(pickerBox && pickerButton)
      const padding = await alignment
        .pickerFooter(page)
        .evaluate((node) => parseFloat(getComputedStyle(node).paddingRight))
      note(
        `${density}/file-picker/footer`,
        pickerBox.x + pickerBox.width - padding,
        pickerButton.x + pickerButton.width,
      )
      await step(`${density}-file-picker`)
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('semantic tokens')
      const toggle = selectors.settingsSwitch(page, 'Semantic tokens enabled')
      await toggle.waitFor()
      if ((await toggle.getAttribute('aria-checked')) === 'false') await toggle.click()
      const row = toggle.locator('xpath=ancestor::*[@data-setting-row][1]')
      await alignment.modified(row).waitFor()
      note(
        `${density}/settings/modified-label`,
        await left(alignment.settingLabel(row)),
        await left(alignment.settingDescription(row)),
      )
      note(
        `${density}/settings/section`,
        await left(alignment.settingLabel(row)),
        await left(alignment.settingHeading(row)),
      )
      const parentControl = await toggle.boundingBox()
      const childControl = await selectors
        .settingsSwitch(page, 'Semantic tokens delta')
        .boundingBox()
      ok(parentControl && childControl)
      note(
        `${density}/settings/control`,
        parentControl.x + parentControl.width,
        childControl.x + childControl.width,
      )
      await step(`${density}-settings-modified`)
      await page.keyboard.press('Escape')
    }
    const home = new URL(page.url())
    home.pathname = '/dev/overlays'
    home.search = ''
    await page.goto(home.href)
    await alignment.gallery(page).waitFor()
    for (const density of ['cozy', 'compact']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.density = value
      }, density)
      for (const kind of ['menu', 'context menu']) {
        const trigger = alignment.trigger(page, `Alignment ${kind}`)
        await trigger.click(kind === 'context menu' ? { button: 'right' } : {})
        const iconRow = alignment.menuRow(page, 'Icon action')
        const textRow = alignment.menuRow(page, 'Text action')
        await iconRow.waitFor()
        await settleRunningAnimations(page)
        const iconLabel = await left(alignment.rowLabel(iconRow))
        note(`${density}/${kind}/text`, await left(alignment.rowLabel(textRow)), iconLabel)
        note(
          `${density}/${kind}/check`,
          await left(alignment.rowLabel(alignment.checkedRow(page))),
          iconLabel,
        )
        const a = await alignment.shortcut(iconRow).boundingBox()
        const b = await alignment.shortcut(textRow).boundingBox()
        ok(a && b)
        note(`${density}/${kind}/shortcut`, a.x + a.width, b.x + b.width)
        await step(`${density}-${kind.replace(' ', '-')}`)
        await page.keyboard.press('Escape')
      }
      await alignment.trigger(page, 'Alignment dialog').click()
      await alignment.dialog(page).waitFor()
      await settleRunningAnimations(page)
      note(
        `${density}/dialog/body`,
        await left(alignment.dialogTitle(page)),
        await left(alignment.dialogBody(page)),
      )
      note(
        `${density}/dialog/description`,
        await left(alignment.dialogTitle(page)),
        await left(alignment.dialogDescription(page)),
      )
      const body = await alignment.dialogBody(page).boundingBox()
      const button = await alignment.dialogButton(page).boundingBox()
      ok(body && button)
      note(`${density}/dialog/footer`, body.x + body.width, button.x + button.width)
      await step(`${density}-dialog`)
      await page.keyboard.press('Escape')
    }
    await evidence.json('alignment.json', measurements)
    const fixture = await createModifiedFileFixture(
      'overlay-alignment',
      'notes.md',
      ['# Notes'],
      ['# Notes', 'Changed'],
    )
    const context = await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await context.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(server.origin)}`)
    const phone = await context.newPage()
    try {
      await phone.goto(new URL('/', page.url()).href)
      const base = await openFixtureChat(phone, fixture)
      await createSessions(phone, base, fixture)
      await selectors.phoneLevel(phone, 'sessions').waitFor()
      await expectPhoneSafeAreas(phone, (label) => step(label, phone))
      for (const density of ['cozy', 'compact']) {
        await phone.evaluate((value) => {
          document.documentElement.dataset.density = value
        }, density)
        const header = alignment.phoneHeader(phone)
        const headerBox = await header.boundingBox()
        const padding = await header.evaluate((node) => ({
          left: parseFloat(getComputedStyle(node).paddingLeft),
          right: parseFloat(getComputedStyle(node).paddingRight),
        }))
        const last = await alignment.phoneButtons(phone).last().boundingBox()
        ok(headerBox && last)
        ok(
          last.width >= 40 && last.height >= 40,
          'Phone header controls retain a 40px touch target',
        )
        note(
          `${density}/phone/title`,
          await left(alignment.phoneTitle(phone)),
          headerBox.x + padding.left,
        )
        note(
          `${density}/phone/end`,
          last.x + last.width,
          headerBox.x + headerBox.width - padding.right,
        )
        note(
          `${density}/phone/control-center`,
          last.y + last.height / 2,
          headerBox.y + headerBox.height / 2,
        )
        const headerIcon = await alignment
          .rowIcon(alignment.phoneButtons(phone).last())
          .boundingBox()
        const toolbarIcon = await alignment.phoneAddProjectIcon(phone).boundingBox()
        ok(headerIcon && toolbarIcon)
        note(
          `${density}/phone/toolbar-icon`,
          headerIcon.x + headerIcon.width / 2,
          toolbarIcon.x + toolbarIcon.width / 2,
        )
        await step(`${density}-phone-header`, phone)
      }
    } finally {
      await context.close()
      await releaseFixture(fixture)
    }
    await evidence.json('alignment.json', measurements)
    for (const { name, delta } of measurements)
      ok(Math.abs(delta) <= 0.5, `${name}: ${delta}px (maximum 0.5px)`)
  },
}
