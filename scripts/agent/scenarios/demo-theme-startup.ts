import { reloadDelayedDemo } from '../demo-startup'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const captureTheme = `(() => {
  if (window.parent === window) return;
  window.__themeFrames = [];
  const started = performance.now();
  function sample() {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const value = {
      theme: root.className,
      colorScheme: style.colorScheme,
      background: style.backgroundColor,
    };
    const key = JSON.stringify(value);
    const previous = window.__themeFrames.at(-1);
    if (!previous || previous.key !== key) {
      window.__themeFrames.push({ ...value, key, at: performance.now() });
    }
    if (performance.now() - started < 15000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})()`

export const demoThemeStartup: Scenario = {
  name: 'demo-theme-startup',
  surface: 'site',
  description: 'Capture the demo theme before modules load and after startup on a light OS theme.',
  inspect: async (page) => {
    const frame = await (await selectors.demoIframe(page).elementHandle())?.contentFrame()
    return frame?.evaluate('window.__themeFrames ?? []') ?? null
  },
  async run(page, { step }) {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(captureTheme)
    const frame = await reloadDelayedDemo(page, '**/demo/assets/demo-*.js', 1500)
    await frame.waitForFunction('window.__themeFrames?.length > 0')
    await step('first-paint')
    await selectors.demoReady(page).waitFor({ timeout: 60_000 })
    await step('ready')
    const stayedDark = await frame.evaluate<boolean>(
      `window.__themeFrames.every(frame => frame.theme.includes('dark') && frame.colorScheme === 'dark')`,
    )
    if (!stayedDark)
      throw createScriptError('The demo painted a light or unresolved theme before dark.')
  },
}
