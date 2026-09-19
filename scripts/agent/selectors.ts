import type { Page } from 'playwright'

export const fileIconSelector = '[data-file-icon], [style*="vscode-icons/"]'
export const wallpaperLayerSelector = '[data-workbench] img[data-workbench-wallpaper-layer="still"]'

// Stable handles the app already exposes. Add here, never inline a selector in a scenario.
export const selectors = {
  editorHover: (page: Page) => page.locator('.editor-plugin-hover:not([hidden])'),
  unicodeAdjustSettings: (page: Page) =>
    page.getByRole('button', { name: 'Adjust settings', exact: true }),
  diffAmbiguousCharacters: (page: Page) =>
    page.locator('.editor-diff-pane [data-editor-hidden-character="ambiguous"]'),
  diffInvisibleCharacters: (page: Page) =>
    page.locator('.editor-diff-pane [data-editor-hidden-character="invisible"]'),
  editorAmbiguousCharacters: (page: Page) =>
    page.locator('[data-editor-hidden-character="ambiguous"]'),
  editorInvisibleCharacters: (page: Page) =>
    page.locator('[data-editor-hidden-character="invisible"]'),
  fileIconElements: (page: Page) => page.locator(fileIconSelector),
  colorModeOption: (page: Page, mode: string) => page.locator(`[data-value="color-mode:${mode}"]`),
  settingsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search settings' }),
  settingsScopeTab: (page: Page, name: 'User' | 'Workspace' | 'Defaults') =>
    page.getByRole('tab', { name, exact: true }),
  settingsDefaultsBanner: (page: Page) => page.getByText('Defaults are read-only', { exact: true }),
  wallpaperTile: (page: Page) =>
    page.getByRole('button', { name: 'Choose wallpaper', exact: true }),
  wallpaperPicker: (page: Page) => page.getByRole('dialog', { name: 'Wallpaper', exact: true }),
  wallpaperCards: (page: Page) =>
    page.getByRole('button', { name: /^Select .+/ }).filter({ has: page.locator('img') }),
  wallpaperCard: (page: Page, name: string) =>
    page.getByRole('button', { name: `Select ${name}`, exact: true }),
  wallpaperSelectedChoice: (page: Page) =>
    page.getByRole('dialog').locator('section button[aria-pressed="true"]'),
  wallpaperChoice: (page: Page, label: string) =>
    page.getByRole('dialog').locator('section').getByRole('button', { name: label, exact: true }),
  wallpaperFilter: (page: Page) => page.getByRole('textbox', { name: 'Filter wallpapers' }),
  wallpaperUploadInput: (page: Page) => page.getByLabel('Upload wallpapers', { exact: true }),
  wallpaperActions: (page: Page, name: string) =>
    page.getByRole('button', { name: `Actions for ${name}`, exact: true }),
  wallpaperPaletteOption: (page: Page, name: string) =>
    page.locator('[cmdk-item][data-value^="wallpaper:"]').filter({ hasText: name }),
  menuItem: (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true }),
  wallpaperLibraryOption: (page: Page) =>
    page.locator('[cmdk-item][data-value^="wallpaper:"]').filter({ has: page.locator('img') }),
  wallpaperMedia: (page: Page) => page.locator('[data-workbench-wallpaper-layer]'),
  wallpaperStill: (page: Page) => page.locator(wallpaperStillSelector),
  commandOption: (page: Page, name: string) => page.getByRole('option', { name, exact: false }),
  renameInput: (page: Page) => page.getByRole('textbox', { name: 'New name', exact: true }),
  historyPane: (page: Page) => page.locator('[data-history-pane]'),
  historyStates: (page: Page) => page.getByRole('listbox', { name: 'History states', exact: true }),
  historyState: (page: Page, index: number) =>
    page
      .getByRole('listbox', { name: 'History states', exact: true })
      .getByRole('option')
      .nth(index),
  historyRestore: (page: Page) => page.getByRole('button', { name: 'Restore', exact: true }),
  diffRows: (page: Page) => page.locator('.editor-diff-pane [data-editor-virtual-row]'),
  editorRows: (page: Page) => page.locator('.editor-virtualized-row'),
  editorTabNamed: (page: Page, label: RegExp) =>
    page.locator('[data-editor-tab-path]').filter({ hasText: label }),
  workspaceEditApplyAll: (page: Page) =>
    page.getByRole('button', { name: 'Apply all', exact: true }),
  toast: (page: Page, title: string) => page.locator('[data-sonner-toast]', { hasText: title }),
  toastAction: (page: Page, title: string, label: string) =>
    page
      .locator('[data-sonner-toast]', { hasText: title })
      .getByRole('button', { name: label, exact: true }),

  sidebarTab: (page: Page, name: 'Files' | 'Git' | 'Search' | 'Chat') =>
    page
      .getByRole('navigation', { name: 'Sidebar tabs' })
      .getByRole('button', { name, exact: true }),
  demoPreview: (page: Page) => page.locator('#demo-frame .demo-preview'),
  demoFrame: (page: Page) => page.locator('#demo-frame'),
  demoReady: (page: Page) => page.locator('#demo-frame[aria-busy="false"]'),
  demoReset: (page: Page) => page.getByRole('button', { name: 'reset demo', exact: true }),
  demoEditor: (page: Page) =>
    page.frameLocator('#workbench-demo').getByRole('textbox', { name: 'Editor input' }).first(),
  demoIframe: (page: Page) => page.locator('#workbench-demo'),
  workspaceSearch: (page: Page) =>
    page.getByRole('searchbox', { name: 'Search workspace', exact: true }),
  replaceBox: (page: Page) =>
    page.getByRole('textbox', { name: 'Replace in workspace', exact: true }),
  replaceToggle: (page: Page) => page.getByRole('button', { name: 'Replace', exact: true }),
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
  paletteRowSelector: '[data-slot="command-list"] [role="option"]',
  paletteInput: (page: Page) => page.locator('[data-slot="command-input"]').first(),
  windowToolbar: (page: Page) => page.getByLabel('Window toolbar', { exact: true }),
  editorTab: (page: Page, path: string) => page.locator(`[data-editor-tab-path="${path}"]`),
  gitPanel: (page: Page) => page.getByRole('region', { name: 'Git panel' }),
  focusGitCommand: (page: Page) => page.getByRole('option', { name: /Focus Git/ }),
  graphButton: (page: Page) => page.getByRole('button', { name: 'Graph', exact: true }),
  changesToggle: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  worktreeFiles: (page: Page) => page.locator('[data-git-file]:not([data-history-file])'),
  historyList: (page: Page) => page.getByRole('listbox', { name: 'Commit history' }),
  historyRowSelector: '[data-history-commit]',
  logRowSelector: '[data-log-row-summary]',
  logRows: (page: Page) => page.locator('[data-log-row-summary]'),
  logsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search logs' }),
  logsTab: (page: Page) => page.getByRole('button', { name: 'Logs', exact: true }),
  historyRows: (page: Page) => page.locator('[data-history-commit]'),
  historyCircles: (page: Page) => page.locator('[data-history-commit] svg circle'),
  historyFiles: (page: Page) => page.locator('[data-history-file]'),
  historyDetails: (page: Page) => page.getByRole('region', { name: 'Commit details' }),
  historyInformation: (page: Page) =>
    page.getByRole('button', { name: 'Commit information', exact: true }),
  historyCopyMessage: (page: Page) =>
    page.getByRole('button', { name: 'Copy message', exact: true }),
  historySearch: (page: Page) => page.getByRole('textbox', { name: 'Search commit history' }),
  historyClearSearch: (page: Page) => page.getByRole('button', { name: 'Clear history search' }),
  historyExpand: (page: Page) => page.getByRole('button', { name: 'Expand commit graph' }),
  historyDialog: (page: Page) => page.getByRole('dialog', { name: 'Commit graph' }),
  historyCurrent: (page: Page) => page.getByRole('button', { name: 'Go to current commit' }),
  historyLoadMore: (page: Page) => page.getByRole('button', { name: 'Load more', exact: true }),
  historyLoadedCount: (page: Page, count: number) =>
    page.getByText(new RegExp(`^${count} commits`), { exact: false }),
  historyReference: (page: Page) => page.getByRole('combobox', { name: 'History reference' }),
  historyAllRefs: (page: Page) =>
    page.getByRole('option', { name: 'All branches & tags', exact: true }),
}

export const chords = {
  commandPalette: 'Control+Shift+P',
}

export async function waitForApp(page: Page, timeoutMs = 45_000) {
  await selectors.windowToolbar(page).waitFor({ timeout: timeoutMs })
}

export async function openGitPanel(page: Page) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill('>Focus Git')
  await selectors.focusGitCommand(page).first().click()
  await selectors.gitPanel(page).waitFor({ timeout: 15_000 })
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

export const wallpaperStillSelector = '[data-workbench-wallpaper-layer="still"]'

/** For a fresh workspace, where the terminal holds focus and the palette chord does not land. */
export async function openFileFromTree(page: Page, name: string) {
  await waitForApp(page)
  await selectors
    .folderTree(page)
    .getByRole('treeitem', { name })
    .first()
    .click({ timeout: 15_000 })
  await selectors.editorInput(page).first().waitFor({ timeout: 15_000 })
}

export async function runPaletteCommand(page: Page, title: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(`>${title}`)
  await selectors.commandOption(page, title).first().click({ timeout: 5_000 })
}
