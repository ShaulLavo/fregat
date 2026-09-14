import type { Page } from 'playwright'

// Stable handles the app already exposes. Add here, never inline a selector in a scenario.
export const selectors = {
  folderTree: (page: Page) => page.getByLabel('Folder tree', { exact: true }),
  editorInput: (page: Page) => page.getByRole('textbox', { name: 'Editor input' }),
  editorSurface: (page: Page) => page.locator('.editor-virtualized-viewport'),
  terminalSurface: (page: Page) => page.getByRole('region', { name: 'Terminal', exact: true }),
  paletteInput: (page: Page) => page.locator('[data-slot="command-input"]').first(),
  windowToolbar: (page: Page) => page.getByLabel('Window toolbar', { exact: true }),
  editorTab: (page: Page, path: string) => page.locator(`[data-editor-tab-path="${path}"]`),
}

export const chords = {
  commandPalette: 'Control+Shift+P',
}

export async function waitForApp(page: Page, timeoutMs = 45_000) {
  await selectors.windowToolbar(page).waitFor({ timeout: timeoutMs })
}

export async function focusEditor(page: Page) {
  await selectors.editorSurface(page).first().click()
  await selectors.editorInput(page).first().focus()
}

export async function openFileByName(page: Page, name: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(name)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await selectors.editorInput(page).first().waitFor({ timeout: 15_000 })
}
