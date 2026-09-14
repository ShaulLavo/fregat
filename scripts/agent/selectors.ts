import type { Page } from 'playwright'

// Stable handles the app already exposes. Add here, never inline a selector in a scenario.
export const selectors = {
  sidebarTab: (page: Page, name: 'Files' | 'Git' | 'Search' | 'Chat') =>
    page
      .getByRole('navigation', { name: 'Sidebar tabs' })
      .getByRole('button', { name, exact: true }),
  demoFrame: (page: Page) => page.locator('#demo-frame'),
  demoReady: (page: Page) => page.locator('#demo-frame[aria-busy="false"]'),
  demoReset: (page: Page) => page.getByRole('button', { name: 'reset demo', exact: true }),
  demoEditor: (page: Page) =>
    page.frameLocator('#workbench-demo').getByRole('textbox', { name: 'Editor input' }).first(),
  demoIframe: (page: Page) => page.locator('#workbench-demo'),
  workspaceSearch: (page: Page) =>
    page.getByRole('searchbox', { name: 'Search workspace', exact: true }),
  searchResults: (page: Page) => page.getByRole('region', { name: 'Search results', exact: true }),
  chatMessage: (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true }),
  chatSend: (page: Page) => page.getByRole('button', { name: 'Send message', exact: true }),
  chatMessages: (page: Page) => page.getByRole('log', { name: 'Messages', exact: true }),
  stageChanges: (page: Page) =>
    page.getByRole('button', { name: 'Stage all changes', exact: true }),
  changesHeader: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  commitMessage: (page: Page) => page.getByRole('textbox', { name: 'Commit message', exact: true }),
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
