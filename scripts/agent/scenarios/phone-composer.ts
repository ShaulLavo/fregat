import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { dispatch } from './chat-verification'
import { usageFixture } from './chat-usage-meter'
import { installNativeProvider } from './native-provider-verification'
import { fixtureWorktree, openFixtureChat } from './phone-fixture'
import type { Scenario } from './index'

const TITLE = 'Tidy the composer'
const WIDTHS = [320, 390, 430] as const
const usageRoute = /\/providers\/usage(\?|$)/

/**
 * The phone composer with every control it can show (model, access, effort, attach, plan usage,
 * send): one line of equal squares, Send inset evenly in the corner, the empty field one line
 * tall, and each control still opens what it names.
 */
export const phoneComposer: Scenario = {
  name: 'phone-composer',
  description:
    'At a touch phone viewport (320, 390, 430): the composer controls are one row of equal squares after the model name, Send sits evenly in the corner, the empty field is one line, and every control opens.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'phone-composer',
      'notes.md',
      ['# Notes', ''],
      ['# Notes', '', 'Changed.'],
    )
    const base = await openFixtureChat(page, fixture)
    const api = base.replace(/\/orchestration$/, '')
    const native = await installNativeProvider(page, api, {
      name: 'phone-composer',
      fixture: new URL('../fixtures/native-model-options.mjs', import.meta.url),
      displayLabel: 'Codex',
    })
    const sessionId = crypto.randomUUID()
    try {
      const worktree = await fixtureWorktree(page, base, fixture)
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title: TITLE,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        modelSelection: native.model,
      })
      await page.route(usageRoute, (route) =>
        route.fulfill({
          contentType: 'application/json',
          json: usageFixture(Date.now(), native.providerInstanceId),
        }),
      )
      await page.reload()
      await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 20_000 })
      await selectors.sessionByTitle(page, TITLE).click()
      await selectors.phoneLevel(page, 'session').waitFor()
      await selectors.modelOptions(page).waitFor({ timeout: 20_000 })
      await selectors.usageMeter(page).waitFor({ timeout: 20_000 })

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 844 })
        await page.waitForTimeout(250)
        const field = await expectComposerRhythm(page, width)
        // One 24px line between the 16px top and 8px bottom padding.
        ok(field && field.height <= 49, `${width}px: the empty field is ${field?.height}px tall`)
        await step(`composer-${width}`)
      }

      await page.setViewportSize({ width: 390, height: 844 })
      await selectors.chatMessage(page).fill('Make the controls feel even')
      await selectors.chatSend(page).waitFor()
      ok(await selectors.chatSend(page).isEnabled(), 'Send is ready once there is text')
      await expectComposerRhythm(page, 390)
      await step('composer-typed')

      await opens(page, step, 'model-picker', selectors.modelPickerTrigger(page), () =>
        selectors.modelPickerPanel(page),
      )
      await opens(page, step, 'access', selectors.composerModes(page), () =>
        selectors.popupMenu(page),
      )
      await opens(page, step, 'options', selectors.modelOptions(page), () =>
        selectors.popupMenu(page),
      )
      await opens(page, step, 'attach', selectors.chatAttach(page), () => selectors.popupMenu(page))
      await opens(page, step, 'usage', selectors.usageMeter(page), () =>
        selectors.usagePopover(page),
      )
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await page.unroute(usageRoute)
      await dispatch(page, base, { type: 'session.delete', sessionId }).catch(() => undefined)
      await native.remove().catch(() => undefined)
      await releaseFixture(fixture)
    }
  },
}

/** Taps a control, checks what it opens is on screen, and closes it with Escape. */
async function opens(
  page: Page,
  step: (label: string) => Promise<void>,
  name: string,
  control: Locator,
  surface: () => Locator,
) {
  // A file-only attach control opens the system picker instead of a menu.
  if (name === 'attach' && (await control.getAttribute('aria-label')) === 'Attach files') return
  await control.click()
  await surface().first().waitFor()
  await page.waitForTimeout(250)
  await step(`${name}-open`)
  await page.keyboard.press('Escape')
  await surface().first().waitFor({ state: 'hidden' })
}

/**
 * Every icon control is the same square, spaced alike, on one line; Send is as far from the
 * surface's right edge as from its bottom; the model keeps its full name from 390px up.
 */
async function expectComposerRhythm(page: Page, width: number) {
  const layout = await selectors.composerActions(page).evaluate((row) => {
    const surface = row.parentElement?.getBoundingClientRect()
    const buttons = [...row.querySelectorAll('button')].filter(
      (button) => button.getBoundingClientRect().width > 0,
    )
    const boxes = buttons.map((button) => {
      const box = button.getBoundingClientRect()
      return {
        name: button.getAttribute('aria-label') ?? '',
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      }
    })
    const model = row.querySelector('[aria-label="Provider and model"] span.truncate')
    const field = document.querySelector('[aria-label="Message"]')?.getBoundingClientRect()
    return {
      boxes,
      field: field ? { height: field.height } : null,
      modelClipped: model ? model.scrollWidth > model.clientWidth + 1 : true,
      surface: surface ? { right: surface.right, bottom: surface.bottom } : null,
    }
  })
  const label = `${width}px`
  ok(layout.surface, `${label}: the composer surface is laid out`)
  const icons = layout.boxes.filter((box) => box.name !== 'Provider and model')
  const send = icons.at(-1)
  // Under a 300px row the read-only gauge gives way; the actions all stay.
  const expected = width >= 390 ? 5 : 4
  ok(
    send && icons.length >= expected,
    `${label}: every control shows: ${JSON.stringify(layout.boxes)}`,
  )
  for (const icon of icons)
    ok(
      Math.abs(icon.width - send.width) <= 0.5 && Math.abs(icon.height - send.height) <= 0.5,
      `${label}: "${icon.name}" is ${icon.width}×${icon.height}, Send is ${send.width}×${send.height}`,
    )
  const middle = (box: (typeof layout.boxes)[number]) => (box.top + box.bottom) / 2
  for (const box of layout.boxes)
    ok(Math.abs(middle(box) - middle(send)) <= 1, `${label}: "${box.name}" leaves the line`)
  const gaps = layout.boxes.slice(1).map((box, index) => box.left - layout.boxes[index]!.right)
  // The left cluster runs from the model to Attach; the readouts and Send sit apart on the right.
  const cluster = gaps.slice(
    0,
    layout.boxes.findIndex((box) => box.name.startsWith('Attach')),
  )
  ok(
    cluster.every((gap) => Math.abs(gap - cluster[0]!) <= 1),
    `${label}: uneven gaps between the controls: ${cluster.join(', ')}`,
  )
  const right = layout.surface.right - send.right
  const bottom = layout.surface.bottom - send.bottom
  ok(Math.abs(right - bottom) <= 1, `${label}: Send inset ${right} beside, ${bottom} below`)
  // The model name is the one thing that gives way, and only once the row has no room left.
  const attach = layout.boxes.findIndex((box) => box.name.startsWith('Attach'))
  const slack = gaps[attach] ?? 0
  ok(!layout.modelClipped || slack <= 9, `${label}: the model name is cut off beside ${slack}px`)
  return layout.field
}
