import { deepStrictEqual, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { collaborationReviewSelectors as ui } from '../selectors'

type HeldBroadcast = {
  reviewBroadcast: { held: boolean; packets: (() => void)[] }
}

async function merge(page: Page): Promise<void> {
  await ui.start(page).click()
  await ui.connected(page).waitFor()
  await page.waitForFunction(
    ({ status }) =>
      document.querySelectorAll(status).length === 2 &&
      [...document.querySelectorAll(status)].every((node) => node.textContent?.includes('2 peers')),
    ui.css,
  )
  await page.evaluate(() => {
    ;(window as unknown as HeldBroadcast).reviewBroadcast.held = true
  })
  for (const [index, name] of ['Alice', 'Bob'].entries()) {
    await ui.input(page, index).focus()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    for (let step = 0; step < 5; step++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.insertText(name)
  }
  await page.evaluate(() => {
    const state = (window as unknown as HeldBroadcast).reviewBroadcast
    state.held = false
    for (const send of state.packets.splice(0)) send()
  })
  await ui.dots(page).nth(1).waitFor()
  deepStrictEqual(
    await ui.dots(page).evaluateAll(
      (dots, { editor: editorSelector, row }) =>
        dots.map((dot) => {
          const bounds = dot.getBoundingClientRect()
          const editor = dot.closest(editorSelector)!.getBoundingClientRect()
          const text = dot.closest(editorSelector)!.querySelector(row)!.getBoundingClientRect()
          return (
            dot.closest('[data-editor-gutter-contribution="merge-review"]') !== null &&
            bounds.left >= editor.left &&
            bounds.right <= text.left &&
            bounds.top >= editor.top &&
            bounds.bottom <= editor.bottom
          )
        }),
      ui.css,
    ),
    [true, true],
  )
}

async function hover(page: Page): Promise<void> {
  await ui.input(page, 0).focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.press('ControlOrMeta+i')
  await ui.action(page, 'Keep both').waitFor()
}

export const collaborationMergeReview: Scenario = {
  name: 'collaboration-merge-review',
  description:
    'Concurrent typing in the two-peer Edit together example, followed by local dismissal and each author-selective resolution.',
  surface: 'site',
  capture: { width: 1440, height: 1100 },
  async run(page, { step }) {
    await page.addInitScript(() => {
      const state = { held: false, packets: [] as (() => void)[] }
      ;(window as unknown as HeldBroadcast).reviewBroadcast = state
      const send = BroadcastChannel.prototype.postMessage
      BroadcastChannel.prototype.postMessage = function (message: unknown) {
        if (state.held) {
          state.packets.push(() => send.call(this, message))
          return
        }
        send.call(this, message)
      }
    })
    for (const choice of ['both', 'yours', 'theirs']) {
      await page.goto(new URL('/collaboration.html', page.url()).href)
      await merge(page)
      await ui.invitation(page).evaluate((input) => {
        ;(input as HTMLInputElement).type = 'password'
      })
      const before = await ui.rows(page).allTextContents()
      await step(`${choice}-mark`)
      await hover(page)
      await ui.base(page).waitFor()
      await ui.yours(page).waitFor()
      const contrast = await ui.hover(page).evaluate((element) => {
        const style = getComputedStyle(element)
        const luminance = (color: string) => {
          const channels = color
            .match(/\d+(?:\.\d+)?/g)!
            .slice(0, 3)
            .map((value) => {
              const channel = Number(value) / 255
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
            })
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        }
        const foreground = luminance(style.color)
        const background = luminance(style.backgroundColor)
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      })
      ok(contrast >= 4.5, `Hover contrast ${contrast} falls below 4.5`)
      await step(`${choice}-hover`)
      await ui.action(page, `Keep ${choice}`).click()
      if (choice === 'both') {
        await ui.dots(page).first().waitFor()
        await page.waitForFunction((dot) => document.querySelectorAll(dot).length === 1, ui.css.dot)
        deepStrictEqual(await ui.rows(page).allTextContents(), before)
      } else {
        const name = choice === 'yours' ? 'Alice' : 'Bob'
        await page.waitForFunction(
          ({ name, editor, row }) =>
            [...document.querySelectorAll(editor)].every((element) =>
              [...element.querySelectorAll(row)].some(
                (line) => line.textContent === `const message = "Hello, ${name}";`,
              ),
            ),
          { ...ui.css, name },
        )
      }
      await page.keyboard.press('Escape')
      await ui.input(page, 0).focus()
      await step(`${choice}-resolved`)
    }
  },
}
