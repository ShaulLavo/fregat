import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { preserveAppearance } from '../preserve-settings'
import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

type Frame = {
  mode: string
  viewTransition: boolean
  snapshots: (string | null)[]
  transitions: { property: string; slot: string | null; duration: number | string }[]
}

type Snapshot = { pseudo: string; keyframes: ComputedKeyframe[] }

declare global {
  interface Window {
    colorModeEvidence: { selected: (string | null)[]; frames: Frame[][]; snapshots: Snapshot[][] }
  }
}

export const colorModePreview: Scenario = {
  name: 'color-mode-preview',
  description:
    'Open on the saved mode, preview both modes without color transitions, cancel, and follow the system.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['workbench.colorTheme'])
    await page.evaluate(() => {
      window.colorModeEvidence = { selected: [], frames: [], snapshots: [] }
    })
    try {
      await openPicker(page)
      await selectors.colorModeOption(page, 'dark').click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await openPicker(page)
      await recordSelection(page)
      await step('opened-dark')
      await captureMidTransition(page, 'light', step)
      await captureMidTransition(page, 'dark', step)
      await capturePreview(page, 'light')
      await step('preview-light')
      await capturePreview(page, 'dark')
      await step('preview-dark')
      await page.keyboard.press('Escape')
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      strictEqual(await selectors.themeRoot(page).getAttribute('class'), 'dark')
      await openPicker(page)
      await selectors.colorModeOption(page, 'system').click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await page.emulateMedia({ colorScheme: 'dark' })
      await openPicker(page)
      await recordSelection(page)
      await step('opened-system')
      await page.keyboard.press('ArrowUp')
      strictEqual(
        await selectors.selectedPaletteOption(page).getAttribute('data-value'),
        'color-mode:dark',
      )
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(500)
      strictEqual(await selectors.themeRoot(page).getAttribute('class'), 'light')
      await selectors.paletteInput(page).fill('dark')
      strictEqual(
        await selectors.selectedPaletteOption(page).getAttribute('data-value'),
        'color-mode:dark',
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      strictEqual(await selectors.themeRoot(page).getAttribute('class'), 'dark')
      await step('keyboard-cancelled')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openPicker(page)
      await capturePreview(page, 'light')
      await step('reduced-motion')
      const evidence = await page.evaluate(() => window.colorModeEvidence)
      strictEqual(evidence.selected.join(','), 'color-mode:dark,color-mode:system')
      ok(
        evidence.frames.flat().some((frame) => frame.mode === 'light'),
        'Light preview painted',
      )
      ok(
        evidence.frames.flat().some((frame) => frame.mode === 'dark'),
        'Dark preview painted',
      )
      strictEqual(
        evidence.frames.flatMap((frames) => frames.flatMap((frame) => frame.transitions)).length,
        0,
        'Theme changes must not start per-element color transitions',
      )
      ok(
        evidence.frames.slice(0, 2).every((frames) => frames.some((frame) => frame.viewTransition)),
        'Both directions use the color-mode View Transition',
      )
      ok(
        evidence.frames.at(-1)?.every((frame) => !frame.viewTransition),
        'Reduced motion switches without a snapshot fade',
      )
    } finally {
      await page.keyboard.press('Escape')
      await restore()
    }
  },
  inspect: (page) => page.evaluate(() => window.colorModeEvidence),
}

async function openPicker(page: Page) {
  await page.mouse.move(0, 0)
  await page.keyboard.press(chords.commandPalette)
  await selectors.paletteInput(page).fill('>Choose light / dark mode')
  await selectors.commandOption(page, 'Choose light / dark mode').click()
  await selectors.colorModeOption(page, 'dark').waitFor()
  await page.waitForTimeout(300)
}

async function recordSelection(page: Page) {
  const value = await selectors.selectedPaletteOption(page).getAttribute('data-value')
  await page.evaluate((selected) => window.colorModeEvidence.selected.push(selected), value)
}

async function captureMidTransition(
  page: Page,
  mode: 'light' | 'dark',
  step: (label: string) => Promise<void>,
) {
  const dialog = await selectors.paletteDialog(page).boundingBox()
  ok(dialog)
  const paused = page.evaluate(pauseColorModeSnapshots)
  await selectors.colorModeOption(page, mode).hover()
  const snapshots = await paused
  await step(`mid-transition-${mode}`)
  ok(
    snapshots.some(
      (snapshot) =>
        snapshot.pseudo.includes('match-element') &&
        snapshot.keyframes.some(
          (frame) =>
            Math.abs(parseFloat(String(frame.width)) - dialog.width) < 1 &&
            Math.abs(parseFloat(String(frame.height)) - dialog.height) < 1,
        ),
    ),
    'The modal has its own snapshot throughout the fade',
  )
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (
        !(animation.effect instanceof KeyframeEffect) ||
        !animation.effect.pseudoElement?.startsWith('::view-transition')
      )
        continue
      animation.play()
    }
  })
  await page.waitForTimeout(300)
}

async function pauseColorModeSnapshots(): Promise<Snapshot[]> {
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    await new Promise(requestAnimationFrame)
    const animations = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.pseudoElement?.startsWith('::view-transition'),
      )
    if (!animations.length) continue
    const snapshots: Snapshot[] = []
    for (const animation of animations) {
      animation.pause()
      animation.currentTime = Number(animation.effect?.getTiming().duration ?? 0) / 2
      if (!(animation.effect instanceof KeyframeEffect)) continue
      const pseudo = animation.effect.pseudoElement
      if (!pseudo?.startsWith('::view-transition-group(')) continue
      snapshots.push({ pseudo, keyframes: animation.effect.getKeyframes() })
    }
    window.colorModeEvidence.snapshots.push(snapshots)
    return snapshots
  }
  return []
}

async function capturePreview(page: Page, mode: 'light' | 'dark') {
  const recording = page.evaluate(async () => {
    const frames: Frame[] = []
    const start = performance.now()
    while (performance.now() - start < 700) {
      await new Promise(requestAnimationFrame)
      const transitions = document
        .getAnimations()
        .filter(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition &&
            /color|shadow|fill|stroke/.test(animation.transitionProperty),
        )
      frames.push({
        mode: document.documentElement.className,
        viewTransition: document.documentElement.matches(
          ':active-view-transition-type(color-mode)',
        ),
        snapshots: document
          .getAnimations()
          .flatMap((animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.pseudoElement?.startsWith('::view-transition')
              ? [animation.effect.pseudoElement]
              : [],
          ),
        transitions: transitions.map((animation) => ({
          property: animation.transitionProperty,
          slot:
            animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
              ? animation.effect.target.getAttribute('data-slot')
              : null,
          duration: String(animation.effect?.getTiming().duration ?? 0),
        })),
      })
    }
    window.colorModeEvidence.frames.push(frames)
  })
  await selectors.colorModeOption(page, mode).hover()
  await recording
}
