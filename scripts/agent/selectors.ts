import type { Locator, Page } from 'playwright'

export const fileIconSelector = '[data-file-icon], [style*="vscode-icons/"]'
export const wallpaperLayerSelector = '[data-workbench] img[data-workbench-wallpaper-layer="still"]'
export const diffPaneSelector = '.editor-diff-pane'
export const searchEditorSelector = '[aria-label="Search result editor"]'
export const searchEditorFileRowSelector = '[role="treeitem"][aria-level="1"]'
export const selectedEditorFileTabSelector = '[data-editor-tab-path][aria-selected="true"]'
export const searchEditorGeometrySelectors = {
  header: searchEditorFileRowSelector,
  row: '[data-index]',
  listRow: '[data-slot="list-row"]',
  excerpt: '.editor-virtualized-row',
  result: '[role="treeitem"][aria-level="2"]',
  editor: '.search-result-file-editor-host',
}

// Stable handles the app already exposes. Add here, never inline a selector in a scenario.
export const selectors = {
  imageLightbox: (page: Page, name: string) => page.getByRole('dialog', { name, exact: true }),
  iconHintControl: (scope: Page | Locator, name: string) =>
    scope.getByRole('button', { name, exact: true }),
  chatHeaderNew: (page: Page) => page.getByRole('button', { name: 'New chat', exact: true }),
  chatHeaderHistory: (page: Page) =>
    page.getByRole('button', { name: 'Conversation history', exact: true }),
  hint: (page: Page, label: string) =>
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: label }),
  paletteCardActions: (page: Page) =>
    page
      .getByRole('radiogroup', { name: 'App colors', exact: true })
      .getByRole('button', { name: / actions$/ }),
  wallpaperClose: (page: Page) =>
    page
      .getByRole('dialog', { name: 'Wallpaper', exact: true })
      .getByRole('button', { name: 'Close', exact: true }),
  popupMenu: (page: Page) => page.getByRole('menu'),
  modelPickerTrigger: (page: Page) =>
    page.getByRole('button', { name: 'Provider and model', exact: true }),
  modelPickerPanel: (page: Page) =>
    page.getByRole('dialog').filter({ has: page.getByLabel('Models') }),
  modelPickerSearch: (page: Page) => page.getByPlaceholder('Search models'),
  listTabStops: (list: Locator) =>
    list.locator(
      '[tabindex="0"], button:not([tabindex="-1"]), input:not([tabindex="-1"]), select:not([tabindex="-1"]), a[href]:not([tabindex="-1"])',
    ),
  menuSurface: (page: Page, surface: string) => page.locator(`[data-menu-surface="${surface}"]`),
  focusableContents: (scope: Locator) =>
    scope.locator('button, input, textarea, select, a, [tabindex], [contenteditable="true"]'),
  timelineRows: (page: Page) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .locator('[data-index] > [data-timeline-row-id]'),
  timelineJumpToLatest: (page: Page) =>
    page.getByRole('button', { name: 'Scroll to latest message', exact: true }),
  breadcrumbCrumb: (page: Page, label: string) =>
    page
      .getByRole('navigation', { name: 'Breadcrumbs', exact: true })
      .getByRole('button', { name: label, exact: true }),
  folderPickerTree: (page: Page) =>
    page.getByRole('tree', { name: 'Folder contents', exact: true }),
  folderPickerRow: (page: Page, label: string) =>
    page
      .getByRole('tree', { name: 'Folder contents', exact: true })
      .getByRole('treeitem', { name: label, exact: true }),
  symbolPickerTree: (page: Page) => page.getByRole('tree', { name: 'Symbols', exact: true }),
  referenceResults: (page: Page) =>
    page.getByRole('tree', { name: 'Reference results', exact: true }),
  changedFilesTree: (page: Page) => page.getByRole('tree', { name: 'Changed files', exact: true }),
  changedFilesSections: (page: Page) => page.locator('[data-changed-files-state]'),
  expandChangedFiles: (page: Page) => page.getByRole('button', { name: /^Show all \d+ files$/ }),
  machineDialog: (page: Page) => page.getByRole('dialog', { name: 'Connect machine', exact: true }),
  machineAdd: (page: Page) => page.getByRole('button', { name: 'Add machine', exact: true }),
  machineTarget: (page: Page) => page.getByRole('textbox', { name: 'SSH target', exact: true }),
  sshHostList: (page: Page) =>
    page.getByRole('listbox', { name: 'SSH hosts', exact: true }).first(),
  patternRows: (list: Locator) => list.locator('[data-slot="list-row"]'),
  selectedPatternRows: (list: Locator) =>
    list.locator('[data-slot="list-row"][aria-selected="true"]'),
  terminalName: (page: Page) => page.getByRole('textbox', { name: 'Terminal name', exact: true }),
  commitFilesTree: (page: Page) => page.getByRole('tree', { name: 'Commit files', exact: true }),
  newTerminal: (page: Page) => page.getByRole('button', { name: 'New terminal', exact: true }),
  projectMenu: (page: Page) => page.getByRole('button', { name: 'Switch project', exact: true }),
  openFolderMenu: (page: Page) => page.getByRole('menuitem', { name: 'Open folder…', exact: true }),
  pickerDialog: (page: Page) => page.getByRole('dialog', { name: 'Choose folder', exact: true }),
  pickerList: (page: Page) => page.getByRole('listbox', { name: 'Folders and files', exact: true }),
  pickerOptions: (page: Page) =>
    page.getByRole('listbox', { name: 'Folders and files', exact: true }).getByRole('option'),
  pickerGoToFolder: (page: Page) => page.getByRole('button', { name: 'Go to folder', exact: true }),
  pickerFolderPath: (page: Page) => page.getByRole('textbox', { name: 'Folder path', exact: true }),
  pickerSearch: (page: Page) =>
    page.getByRole('textbox', { name: 'Search files and folders', exact: true }),
  pickerEmpty: (page: Page) => page.getByText('Nothing here', { exact: true }),
  pickerCurrentFolderHeading: (page: Page) =>
    page
      .getByRole('listbox', { name: 'Folders and files', exact: true })
      .getByText('Current folder', { exact: true }),
  searchResultTree: (page: Page) => page.getByRole('tree', { name: 'Search results', exact: true }),
  activeResultReplace: (page: Page) =>
    page
      .getByRole('tree', { name: 'Search results', exact: true })
      .locator('[aria-selected="true"] [data-row-action="replace"]'),
  terminalList: (page: Page) => page.getByRole('tablist', { name: 'Open terminals', exact: true }),
  terminalRows: (page: Page) =>
    page.getByRole('tablist', { name: 'Open terminals', exact: true }).getByRole('tab'),
  terminalDraggingRow: (page: Page) =>
    page
      .getByRole('tablist', { name: 'Open terminals', exact: true })
      .locator('[data-dragging="true"]'),
  connectMachineMenu: (page: Page) =>
    page.getByRole('menuitem', { name: 'Connect machine…', exact: true }),
  sessionRows: (page: Page) => page.locator('aside [aria-roledescription="sortable session row"]'),
  sessionDraggingRow: (page: Page) =>
    page.locator('aside [aria-roledescription="sortable session row"][data-dragging="true"]'),
  sessionRail: (page: Page) => page.getByRole('listbox', { name: 'Sessions', exact: true }),
  gitChangeTree: (page: Page) => page.getByRole('tree', { name: 'Git changes', exact: true }),
  logList: (page: Page) => page.getByRole('listbox', { name: 'Log events', exact: true }),
  workspaceReplaceAll: (page: Page) => page.getByRole('button', { name: 'All', exact: true }),
  editorGroupBreadcrumbs: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .getByRole('navigation', { name: 'Breadcrumbs', exact: true }),
  editorGroupTabStrip: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .getByRole('tablist', { name: 'Editor tabs', exact: true }),
  editorInsertionBeforeTab: (page: Page) =>
    page.locator('[data-editor-tab-insertion]').locator('..').getByRole('tab'),
  editorBlurProbeFrame: (page: Page) => page.locator('iframe[data-editor-blur-probe]'),
  editorGroupStructuralFoldToggle: (page: Page, index: number, collapsed: boolean) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .locator('[data-editor-fold-key]:not([data-editor-fold-key*="\u003aindent\u003a"])')
      .and(
        page.getByRole('button', {
          name: collapsed ? 'Expand folded region' : 'Collapse foldable region',
          exact: true,
        }),
      ),
  editorGroupHistoryStates: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .getByRole('listbox', { name: 'History states' }),
  editorGroupDiffRows: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .locator('.editor-diff-pane [data-editor-virtual-row]'),
  editorGroupEmptyText: (page: Page, index: number, text: string) =>
    page.locator('[data-editor-group-id]').nth(index).getByText(text, { exact: true }),
  unsavedChangesDialog: (page: Page) =>
    page.getByRole('dialog', { name: 'Unsaved changes', exact: true }),
  editorGroupFind: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .getByRole('textbox', { name: 'Find', exact: true }),
  editorGroups: (page: Page) => page.locator('[data-editor-group-id]'),
  editorGroupContent: (page: Page, index: number) =>
    page.locator('[data-editor-group-id]').nth(index).locator('[data-editor-group-content]'),
  editorGroupTabs: (page: Page, index: number) =>
    page.locator('[data-editor-group-id]').nth(index).getByRole('tab'),
  editorGroupInput: (page: Page, index: number) =>
    page
      .locator('[data-editor-group-id]')
      .nth(index)
      .getByRole('textbox', { name: 'Editor input' }),
  editorGroupRows: (page: Page, index: number) =>
    page.locator('[data-editor-group-id]').nth(index).locator('.editor-virtualized-row'),
  editorGroupViewport: (page: Page, index: number) =>
    page.locator('[data-editor-group-id]').nth(index).locator('.editor-virtualized-viewport'),
  editorDropPreview: (page: Page) => page.locator('[data-editor-drop-preview]'),
  editorTabInsertion: (page: Page) => page.locator('[data-editor-tab-insertion]'),
  editorGroupDialog: (page: Page) => page.getByRole('dialog', { name: 'Move tab to group' }),
  editorSplitHandles: (page: Page) => page.locator('[data-editor-groups]').getByRole('separator'),
  treeItem: (page: Page, name: string) =>
    page.getByLabel('Folder tree', { exact: true }).getByRole('treeitem', { name, exact: true }),
  fileConflict: (page: Page, name: string) =>
    page.getByRole('alertdialog', { name: `${name} changed on disk`, exact: true }),
  terminalTool: (page: Page) =>
    page
      .getByRole('navigation', { name: 'Tool tabs' })
      .getByRole('button', { name: 'Terminal', exact: true }),
  codeThemeOptions: (page: Page) => page.locator('[data-value^="color-theme:"]'),
  codeThemeOption: (page: Page, id: string) => page.locator(`[data-value="color-theme:${id}"]`),
  wallpaperAsset: (page: Page, id: string) =>
    page.locator(`${wallpaperStillSelector}[src*="${id}"]`),
  themeGallery: (page: Page) => page.getByLabel('Theme bundles', { exact: true }),
  themeCard: (page: Page, id: string) =>
    page.locator(`[data-theme-bundle="${id}"]`).getByRole('button'),
  paletteActions: (page: Page, name: string) =>
    page.getByRole('button', { name: `${name} actions`, exact: true }),
  paletteMenuAction: (page: Page, name: string) =>
    page.getByRole('menuitem', { name, exact: true }),
  themeAction: (page: Page, name: string) => page.getByRole('button', { name, exact: true }),
  themeEditor: (page: Page) => page.getByRole('dialog', { name: 'Create a theme bundle' }),
  themeName: (page: Page) => page.getByRole('textbox', { name: 'Name', exact: true }),
  themeEditorPalette: (page: Page, mode: string) => page.locator(`#theme-palette-${mode}`),
  themeRoot: (page: Page) => page.locator('html'),

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
  settingsFontFamily: (page: Page) =>
    page.getByRole('textbox', { name: 'Font family', exact: true }),
  chooseFolder: (page: Page) => page.getByRole('button', { name: 'Choose folder', exact: true }),
  settingsDialog: (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true }),
  settingsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search settings' }),
  settingsHeader: (page: Page) => page.locator('[data-settings-header]'),
  settingsDensity: (page: Page) =>
    page.getByRole('combobox', { name: 'Interface density', exact: true }),
  settingsDensityOption: (page: Page, density: 'compact' | 'cozy') =>
    page.getByRole('option', { name: density, exact: true }),
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
  diffExpandRows: (page: Page) => page.locator('.editor-diff-pane .editor-diff-row-expandable'),
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
  workspaceMode: (page: Page, mode: 'Workbench' | 'Chat') =>
    page.getByRole('button', { name: `${mode} mode`, exact: true }),
  workspaceRail: (page: Page, mode: 'Workbench' | 'Chat') =>
    page.getByRole('navigation', {
      name: mode === 'Workbench' ? 'Sidebar tabs' : 'Tool tabs',
      exact: true,
    }),
  workspaceRailButtons: (page: Page, mode: 'Workbench' | 'Chat') =>
    page
      .getByRole('navigation', { name: mode === 'Workbench' ? 'Sidebar tabs' : 'Tool tabs' })
      .getByRole('button'),
  chatToolTab: (page: Page, name: string) =>
    page.getByRole('navigation', { name: 'Tool tabs' }).getByRole('button', { name, exact: true }),
  sidebarSettingsButton: (page: Page, mode: 'Workbench' | 'Chat' = 'Workbench') =>
    page
      .getByRole('navigation', { name: mode === 'Workbench' ? 'Sidebar tabs' : 'Tool tabs' })
      .getByRole('button', { name: 'Settings', exact: true }),
  demoPreview: (page: Page) => page.locator('#demo-frame .demo-preview'),
  demoFrame: (page: Page) => page.locator('#demo-frame'),
  demoReady: (page: Page) => page.locator('#demo-frame[aria-busy="false"]'),
  demoReset: (page: Page) => page.getByRole('button', { name: 'reset demo', exact: true }),
  demoEditor: (page: Page) =>
    page.frameLocator('#workbench-demo').getByRole('textbox', { name: 'Editor input' }).first(),
  demoIframe: (page: Page) => page.locator('#workbench-demo'),
  workspaceSearch: (page: Page) =>
    page.getByRole('searchbox', { name: 'Search workspace', exact: true }),
  openSearchEditor: (page: Page) =>
    page.getByRole('button', { name: 'Open search editor', exact: true }),
  searchEditor: (page: Page) => page.locator(searchEditorSelector),
  searchEditorTab: (page: Page) => page.getByRole('tab', { name: /^Search(?:\s|$)/ }),
  searchEditorHeaderToggle: (page: Page, expanded: boolean) =>
    page
      .locator(searchEditorSelector)
      .locator(searchEditorFileRowSelector)
      .first()
      .getByRole('button', {
        name: expanded ? 'Collapse file results' : 'Expand file results',
        exact: true,
      }),
  searchEditorHosts: (page: Page) =>
    page.locator(searchEditorSelector).locator('.search-result-file-editor-host'),
  searchEditorRows: (page: Page) =>
    page.locator(searchEditorSelector).locator('.editor-virtualized-row'),
  searchEditorVisibleRows: (page: Page) =>
    page.locator(searchEditorSelector).locator('.editor-virtualized-row:visible'),
  editorHighlightStyles: (page: Page) =>
    page.locator('head style').filter({ hasText: '::highlight(' }),
  searchSummary: (page: Page) =>
    page
      .locator('span[title]')
      .filter({ hasText: /(?:matches|shown, limit reached) in [\d,]+ files/ }),
  replaceBox: (page: Page) =>
    page.getByRole('textbox', { name: 'Replace in workspace', exact: true }),
  replaceToggle: (page: Page) => page.getByRole('button', { name: 'Replace', exact: true }),
  searchResults: (page: Page) => page.getByRole('region', { name: 'Search results', exact: true }),
  chatMessage: (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true }),
  chatNewSession: (page: Page) => page.getByRole('button', { name: 'New session', exact: true }),
  chatCorrection: (page: Page) =>
    page.getByRole('button', { name: 'Send correction', exact: true }),
  chatStop: (page: Page) => page.getByRole('button', { name: 'Stop current turn', exact: true }),
  chatSend: (page: Page) => page.getByRole('button', { name: 'Send message', exact: true }),
  chatMessages: (page: Page) => page.getByRole('log', { name: 'Messages', exact: true }),
  stageChanges: (page: Page) =>
    page.getByRole('button', { name: 'Stage all changes', exact: true }),
  changesHeader: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  commitMessage: (page: Page) => page.getByRole('textbox', { name: 'Commit message', exact: true }),
  folderTree: (page: Page) => page.getByLabel('Folder tree', { exact: true }),
  focusedTreeRow: (page: Page) =>
    page.getByLabel('Folder tree', { exact: true }).locator('[role="treeitem"][tabindex="0"]'),
  editorInput: (page: Page) => page.getByRole('textbox', { name: 'Editor input' }),
  editorSurface: (page: Page) => page.locator('.editor-virtualized-viewport'),
  terminalSurface: (page: Page) =>
    page.locator('[data-slot="tool-pane"][aria-label="Terminal"]:visible'),
  paletteRowSelector: '[data-slot="command-list"] [role="option"]',
  paletteInput: (page: Page) => page.locator('[data-slot="command-input"]').first(),
  selectedPaletteOption: (page: Page) => page.locator('[cmdk-item][data-selected="true"]'),
  paletteDialog: (page: Page) => page.getByRole('dialog', { name: 'Command Palette', exact: true }),
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

export async function selectedEditorTabId(page: Page, group: number) {
  return selectors
    .editorGroupTabs(page, group)
    .evaluateAll(
      (elements) =>
        elements
          .find((element) => element.getAttribute('aria-selected') === 'true')
          ?.getAttribute('data-editor-tab-id') ?? null,
    )
}
