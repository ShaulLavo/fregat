import type { Page } from 'playwright'

/** Hold the lazy editor entry while the emitted page paints and remains readable. */
export async function holdEditor(page: Page): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_astro/editor.*.js', async (route) => {
    await gate
    await route.continue()
  })
  return release
}
