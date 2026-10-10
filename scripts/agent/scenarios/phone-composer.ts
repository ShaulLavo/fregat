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
 * dictation, send): one line of equal squares, dictation and Send inset evenly in the corner,
 * the empty field one line tall, and each control still opens what it names.
 */
export const phoneComposer: Scenario = {
  name: 'phone-composer',
  description:
    'At a touch phone viewport (320, 390, 430): the composer controls and plan gauge are one even run of equal squares after the model name, dictation and Send sit evenly in the corner with the same spacing, the empty field is one line, every control opens, and a long draft stays clear of welcome text with the keyboard open.',
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

      await keyboardDraft(page, step)
      await selectors.phoneBack(page).click()
      await selectors.chatNewSession(page).first().click()
      await selectors.chatMessage(page).waitFor()
      await keyboardDraft(page, step)
      await selectors.phoneBack(page).click()
      await selectors.sessionByTitle(page, TITLE).click()

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
      await exerciseUsage(page, step)
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

async function keyboardDraft(page: Page, step: (label: string) => Promise<void>) {
  const field = selectors.chatMessage(page)
  await field.fill(
    'This is a long draft that needs to stay readable while the keyboard is open. '.repeat(30),
  )
  await expectWelcomeContained(page)
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await field.focus()
      await page.waitForTimeout(250)
      // Stand in for the inset measured from iOS's visual viewport when its keyboard opens.
      await page.evaluate(() =>
        document.documentElement.style.setProperty('--keyboard-inset', '470px'),
      )
      await field.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await step(`keyboard-long-draft-${width}`)
      await expectWelcomeContained(page)
      const bounds = await field.boundingBox()
      const send = await selectors.chatSend(page).boundingBox()
      ok(
        bounds && send && bounds.y >= 0 && send.y + send.height <= 374,
        'The draft and Send stay above the keyboard',
      )
      await field.evaluate((element) => {
        element.scrollTop = 0
      })
      await step(`keyboard-draft-start-${width}`)
      await expectWelcomeContained(page)
    }
  } finally {
    await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard-inset'))
    await page.setViewportSize({ width: 390, height: 844 })
    await field.fill('Make the controls feel even')
  }
}

async function expectWelcomeContained(page: Page) {
  const visible = await selectors.chatWelcome(page).evaluate(async (welcome) => {
    const region = welcome.getBoundingClientRect()
    const entries = await new Promise<IntersectionObserverEntry[]>((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        observer.disconnect()
        resolve(entries)
      })
      for (const child of welcome.children) observer.observe(child)
    })
    return entries.map(({ intersectionRect: rect }) => ({
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      regionTop: region.top,
      regionBottom: region.bottom,
    }))
  })
  ok(
    visible.every(
      (rect) =>
        rect.height === 0 ||
        (rect.top >= rect.regionTop - 1 && rect.bottom <= rect.regionBottom + 1),
    ),
    `Welcome content paints outside its region: ${JSON.stringify(visible)}`,
  )
}

/** The plan gauge opens its windows, and View usage leads on to Settings › Usage. */
async function exerciseUsage(page: Page, step: (label: string) => Promise<void>) {
  await selectors.usageMeter(page).click()
  await selectors.usagePopover(page).waitFor()
  // The expired reading remains visible with its historical reset state.
  const rows = await selectors.usageWindowRows(page).count()
  ok(rows === 3, `The usage popover lists ${rows} windows`)
  await page.waitForTimeout(250)
  await step('usage-open')
  await selectors.usageMeterViewUsage(page).click()
  await selectors.usageSection(page).waitFor({ timeout: 20_000 })
  await selectors.usagePopover(page).waitFor({ state: 'hidden' })
  await step('usage-settings')
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
 * Every icon control is the same square. The model and its controls and readouts form one run
 * from the left; dictation and Send form the corner group, spaced like the run, as far from the
 * right edge as from the bottom and set apart from the run by the row gap.
 */
async function expectComposerRhythm(page: Page, width: number) {
  const layout = await selectors.composerActions(page).evaluate((actions) => {
    const surface = actions.parentElement?.getBoundingClientRect()
    const groups = [...(actions.firstElementChild?.children ?? [])]
    const measure = (group: Element | undefined) =>
      [...(group?.querySelectorAll('button') ?? [])]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => {
          const box = button.getBoundingClientRect()
          return {
            name: button.getAttribute('aria-label') ?? '',
            usage: button.hasAttribute('data-usage-meter'),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          }
        })
    const model = actions.querySelector('[aria-label="Provider and model"] span.truncate')
    const field = document.querySelector('[aria-label="Message"]')?.getBoundingClientRect()
    return {
      run: measure(groups[0]),
      corner: measure(groups[1]),
      field: field ? { height: field.height } : null,
      modelClipped: model ? model.scrollWidth > model.clientWidth + 1 : true,
      surface: surface ? { right: surface.right, bottom: surface.bottom } : null,
    }
  })
  const label = `${width}px`
  ok(layout.surface, `${label}: the composer surface is laid out`)
  const boxes = layout.run.concat(layout.corner)
  const icons = boxes.filter((box) => box.name !== 'Provider and model')
  const send = layout.corner.at(-1)
  ok(send?.name === 'Send message', `${label}: Send ends the row: ${JSON.stringify(layout.corner)}`)
  ok(
    layout.corner.some((box) => box.name === 'Start dictation'),
    `${label}: dictation sits beside Send: ${JSON.stringify(layout.corner)}`,
  )
  // Under a 300px row the read-only gauge gives way; the actions all stay.
  const expected = width >= 390 ? 4 : 3
  ok(
    layout.run.length - 1 >= expected,
    `${label}: every control shows: ${JSON.stringify(layout.run)}`,
  )
  for (const icon of icons)
    ok(
      Math.abs(icon.width - send.width) <= 0.5 && Math.abs(icon.height - send.height) <= 0.5,
      `${label}: "${icon.name}" is ${icon.width}×${icon.height}, Send is ${send.width}×${send.height}`,
    )
  const middle = (box: (typeof boxes)[number]) => (box.top + box.bottom) / 2
  for (const box of boxes)
    ok(Math.abs(middle(box) - middle(send)) <= 1, `${label}: "${box.name}" leaves the line`)
  const gapsOf = (group: typeof boxes) =>
    group.slice(1).map((box, index) => box.left - group[index]!.right)
  // One spacing inside the run and inside the corner group alike.
  const inner = gapsOf(layout.run).concat(gapsOf(layout.corner))
  ok(
    inner.every((gap) => Math.abs(gap - inner[0]!) <= 1),
    `${label}: uneven gaps between the controls: ${gapsOf(layout.run).join(', ')} | ${gapsOf(layout.corner).join(', ')}`,
  )
  const slack = layout.corner[0]!.left - layout.run.at(-1)!.right
  ok(slack >= inner[0]! + 7, `${label}: the corner group sits ${slack}px from the run`)
  if (width >= 390) {
    const attach = layout.run.findIndex((box) => box.name.startsWith('Attach'))
    ok(layout.run[attach + 1]?.usage, `${label}: the plan gauge follows Attach`)
  }
  const right = layout.surface.right - send.right
  const bottom = layout.surface.bottom - send.bottom
  ok(Math.abs(right - bottom) <= 1, `${label}: Send inset ${right} beside, ${bottom} below`)
  // The model name is the one thing that gives way, and only once the row has no room left.
  ok(!layout.modelClipped || slack <= 9, `${label}: the model name is cut off beside ${slack}px`)
  return layout.field
}
