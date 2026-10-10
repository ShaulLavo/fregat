import { deepStrictEqual, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { collaborationReviewSelectors as ui } from '../selectors'

type HeldBroadcast = {
  reviewBroadcast: { held: boolean; packets: (() => void)[] }
}

async function connect(page: Page): Promise<void> {
  await ui.start(page).click()
  await ui.connected(page).waitFor()
  await page.waitForFunction(
    ({ status }) =>
      document.querySelectorAll(status).length === 2 &&
      [...document.querySelectorAll(status)].every((node) => node.textContent?.includes('2 peers')),
    ui.css,
  )
}

async function hold(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as HeldBroadcast).reviewBroadcast.held = true
  })
}

async function release(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as HeldBroadcast).reviewBroadcast
    state.held = false
    for (const send of state.packets.splice(0)) send()
  })
}

async function merge(page: Page, indent = 0): Promise<void> {
  await connect(page)
  if (indent)
    await baseline(
      page,
      `// Type together. Undo changes only your own edits.\n${' '.repeat(indent)}const message = "Hello, peers";\n`,
    )
  await hold(page)
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
  await release(page)
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

async function hover(page: Page, index = 0, line = 1, indent = 0, review = true): Promise<void> {
  await ui.input(page, index).focus()
  await page.keyboard.press('ControlOrMeta+Home')
  if (indent) {
    const prefix = '// Type together. Undo changes only your own edits.\n'.length
    for (let step = 0; step <= prefix + indent; step++) await page.keyboard.press('ArrowRight')
  } else {
    for (let step = 0; step < line; step++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
  }
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.press('ControlOrMeta+i')
  if (review) await ui.action(page, 'Keep both').waitFor()
}

async function baseline(page: Page, text: string): Promise<void> {
  await ui.input(page, 0).focus()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ControlOrMeta+Shift+End')
  await page.keyboard.insertText(text)
  await page.waitForFunction(
    ({ editor, row, text }) =>
      [...document.querySelectorAll(editor)].every(
        (element) =>
          [...element.querySelectorAll(row)].map((node) => node.textContent).join('') ===
          text.replaceAll('\n', ''),
      ),
    { ...ui.css, text },
  )
}

async function replace(
  page: Page,
  index: number,
  from: number,
  to: number,
  text: string,
): Promise<void> {
  await ui.input(page, index).focus()
  await page.keyboard.press('ControlOrMeta+Home')
  for (let step = 0; step < from; step++) await page.keyboard.press('ArrowRight')
  for (let step = from; step < to; step++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.insertText(text)
}

async function assertHover(page: Page, index: number, normal = true): Promise<void> {
  const geometry = await ui.hover(page).evaluate(
    (element, { editor, index }) => {
      const rect = element.getBoundingClientRect()
      const owner = document.querySelectorAll(editor)[index]!.getBoundingClientRect()
      const body = element.querySelector<HTMLElement>('[class$="-hover-body"]')!
      const controls = element.querySelector<HTMLElement>('[class$="-hover-controls"]')!
      const anchorName = (element as HTMLElement).style.getPropertyValue('position-anchor')
      const anchor = [...document.querySelectorAll<HTMLElement>('[style]')]
        .find((node) => node.style.getPropertyValue('anchor-name') === anchorName)!
        .getBoundingClientRect()
      const actions = [...controls.querySelectorAll('button')].map((button) => {
        const bounds = button.getBoundingClientRect()
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        )
        const style = getComputedStyle(button)
        return {
          label: button.textContent,
          visible:
            bounds.left >= rect.left &&
            bounds.right <= rect.right &&
            bounds.top >= rect.top &&
            bounds.bottom <= rect.bottom &&
            bounds.bottom <= innerHeight - 12 &&
            (hit === button || button.contains(hit)),
          button:
            style.textDecorationLine === 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        }
      })
      return {
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        owner: { left: owner.left, right: owner.right },
        anchor: { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
        actions,
        toneOnly: [...body.querySelectorAll<HTMLElement>('[role="document"]')].every((region) => {
          const style = getComputedStyle(region)
          return style.outlineStyle === 'none' && style.borderTopStyle === 'none'
        }),
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      }
    },
    { ...ui.css, index },
  )
  ok(geometry.rect.left >= geometry.owner.left + 11, JSON.stringify(geometry))
  ok(geometry.rect.right <= geometry.owner.right - 11, JSON.stringify(geometry))
  ok(
    geometry.rect.top >= geometry.anchor.bottom || geometry.rect.bottom <= geometry.anchor.top,
    JSON.stringify(geometry),
  )
  ok(
    geometry.actions.length >= 2 &&
      geometry.actions.every((action) => action.visible && action.button),
    JSON.stringify(geometry),
  )
  ok(geometry.toneOnly, JSON.stringify(geometry))
  if (normal) ok(geometry.scrollHeight <= geometry.clientHeight + 1, JSON.stringify(geometry))
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
      await assertHover(page, 0)
      await step(`${choice}-hover`)
      if (choice === 'both') {
        await page.keyboard.press('Escape')
        await hover(page, 1)
        await assertHover(page, 1)
        await step('peer-two-hover')
        await page.keyboard.press('Escape')
        await hover(page)
      }
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
        await page.waitForFunction((dot) => document.querySelectorAll(dot).length === 0, ui.css.dot)
        await page.keyboard.press('Escape')
        await hover(page, 0, 1, 0, false)
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
        deepStrictEqual(await ui.action(page, 'Keep yours').count(), 0)
        deepStrictEqual(await ui.action(page, 'Keep theirs').count(), 0)
        deepStrictEqual(await ui.dots(page).count(), 0)
      }
      await page.keyboard.press('Escape')
      await ui.input(page, 0).focus()
      await step(`${choice}-resolved`)
    }
    await page.goto(new URL('/collaboration.html', page.url()).href)
    await merge(page, 40)
    await ui.invitation(page).evaluate((input) => {
      ;(input as HTMLInputElement).type = 'password'
    })
    await hover(page, 0, 1, 40)
    await assertHover(page, 0)
    await step('pane-edge-hover')

    await page.addInitScript(() => {
      const randomUUID = crypto.randomUUID.bind(crypto)
      let calls = 0
      crypto.randomUUID = () => {
        calls++
        if (calls === 1) return randomUUID()
        // Ordered fixture identities retain Alice's insertion in the first declaration.
        return `${calls.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
      }
    })
    await page.goto(new URL('/collaboration.html', page.url()).href)
    await connect(page)
    const source = 'const first = "base";\nconst second = 0;\n'
    await baseline(page, source)
    await hold(page)
    const from = source.indexOf('base')
    await replace(page, 0, from, from + 4, 'Alice')
    await replace(page, 1, from, source.indexOf('0') + 1, 'Bob";\nconst second = 1;\n// ')
    await release(page)
    await ui.dots(page).nth(1).waitFor()
    await ui.invitation(page).evaluate((input) => {
      ;(input as HTMLInputElement).type = 'password'
    })
    await hover(page, 0, 0)
    await ui.action(page, 'Jump to edit').waitFor()
    await assertHover(page, 0)
    await step('manual-cross-unit-hover')
  },
}
