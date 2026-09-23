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
  // The editor parks recycled rows with `hidden`, whose rect is all zeros.
  excerpt: '.editor-virtualized-row:not([hidden])',
  result: '[role="treeitem"][aria-level="2"]',
  editor: '.search-result-file-editor-host',
}

// Stable handles the app already exposes. Add here, never inline a selector in a scenario.
export const selectors = {
  completedWorkGroup: (page: Page) => page.getByRole('button', { name: /^Worked for / }),
  reasoningDeliveryRow: (page: Page) => page.getByRole('button', { name: /^REASONING_BEGIN / }),
  reasoningDeliveryDetail: (page: Page, text: string) => page.getByText(text, { exact: true }),
  recoverableDraft: (page: Page, label: string) =>
    page
      .getByRole('listbox', { name: 'Drafts', exact: true })
      .getByRole('option')
      .filter({ hasText: label }),
  discardDraft: (page: Page, label: string) =>
    page.getByRole('button', { name: `Discard draft: ${label}`, exact: true }),
  newWorktreeChoice: (page: Page) =>
    page.getByRole('button', { name: 'New worktree', exact: true }),
  composerAccess: (page: Page) => page.getByRole('menuitemradio', { name: /^Full access/ }),
  chatExactText: (page: Page, text: string) => page.getByText(text, { exact: true }),
  composerModes: (page: Page) =>
    page.getByRole('button', { name: 'Agent access and mode', exact: true }),
  composerPlan: (page: Page) => page.getByRole('menuitemradio', { name: /^Plan/ }),
  contextMeter: (page: Page) => page.getByRole('button', { name: /^Context / }),
  notificationToast: (page: Page) =>
    page
      .locator('[data-sonner-toast]')
      .filter({ has: page.getByRole('button', { name: 'Open session', exact: true }) }),
  notificationOpenSession: (page: Page) =>
    page.getByRole('button', { name: 'Open session', exact: true }),
  notificationBadge: (page: Page) => page.locator('link[data-session-notifications]'),
  chatStash: (page: Page, count: number) =>
    page.getByRole('button', { name: `Stashed prompts: ${count}`, exact: true }),
  chatStashEntry: (page: Page, label: string) =>
    page.getByRole('button', { name: new RegExp(`^${label}`) }),
  sessionTitleInput: (page: Page) =>
    page.getByRole('textbox', { name: 'Session title', exact: true }),
  titleGenerationStatus: (page: Page) =>
    page.getByRole('status', { name: 'Generating title' }).first(),
  titleGenerationFailure: (page: Page) =>
    page.getByText('Title generation failed', { exact: true }).first(),
  sessionLifecycleAction: (page: Page, name: string) =>
    page.getByRole('menuitem', { name, exact: true }),
  sessionInShelf: (page: Page, title: string, shelf: string) =>
    page.getByRole('region', { name: shelf, exact: true }).getByTitle(title, { exact: true }),
  snoozePreset: (page: Page) => page.getByRole('button', { name: /In 1 hour/ }),
  snoozeDurationMode: (page: Page) => page.getByRole('button', { name: 'Duration', exact: true }),
  snoozeAmount: (page: Page) => page.getByRole('spinbutton', { name: 'Duration', exact: true }),
  snoozeCustomSubmit: (page: Page) =>
    page.getByRole('button', { name: 'Snooze until chosen time', exact: true }),
  snoozeDialog: (page: Page) => page.getByRole('dialog', { name: 'Snooze sessions', exact: true }),
  sessionBulkActions: (page: Page) =>
    page
      .getByRole('toolbar', { name: 'Selected sessions' })
      .getByRole('button', { name: 'Actions', exact: true }),
  toastUndo: (page: Page) =>
    page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo', exact: true }).last(),

  projectGroups: (page: Page) => page.locator('[data-project-group]'),
  projectDeleteMenu: (page: Page) =>
    page.getByRole('menuitem', { name: 'Delete Project', exact: true }),
  projectDeleteDialog: (page: Page) =>
    page.getByRole('dialog', { name: 'Delete project', exact: true }),
  projectDeleteOwners: (page: Page) =>
    page.getByRole('dialog', { name: 'Delete project', exact: true }).getByRole('listitem'),
  projectDeleteCancel: (page: Page) =>
    page
      .getByRole('dialog', { name: 'Delete project', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true }),

  asyncQuestion: (page: Page, prompt: string) =>
    page.getByRole('region', { name: 'Agent question', exact: true }).filter({ hasText: prompt }),
  questionFileInput: (page: Page, prompt: string) =>
    page
      .getByRole('region', { name: 'Agent question', exact: true })
      .filter({ hasText: prompt })
      .locator('input[type="file"]'),
  questionPrompt: (page: Page, prompt: string) =>
    page
      .getByRole('region', { name: 'Agent question', exact: true })
      .filter({ hasText: prompt })
      .getByRole('status'),
  questionAttachment: (page: Page, name: string) =>
    page.getByRole('button', { name: `Remove ${name}`, exact: true }),
  asyncQuestionAction: (page: Page, prompt: string, action: string) =>
    page
      .getByRole('region', { name: 'Agent question', exact: true })
      .filter({ hasText: prompt })
      .getByRole('button', { name: action, exact: true }),
  sessionStatus: (page: Page, title: string, status: string) =>
    page.getByTitle(title, { exact: true }).getByRole('status', { name: status, exact: true }),
  appApproval: (page: Page) => page.getByRole('region', { name: 'App access', exact: true }),
  appApprovalDecision: (page: Page, label: string) =>
    page
      .getByRole('region', { name: 'App access', exact: true })
      .getByRole('button', { name: label, exact: true }),
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
  modelPickerOption: (page: Page, label: string) =>
    page.getByRole('option').filter({ has: page.getByText(label, { exact: true }) }),
  modelOptions: (page: Page) => page.getByRole('button', { name: 'Model options', exact: true }),
  modelOptionChoice: (page: Page, group: string, choice: string) =>
    page
      .getByRole('group', { name: group, exact: true })
      .getByRole('menuitemradio', { name: choice, exact: true }),
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
  chatToolsHandle: (page: Page) => page.locator('[data-slot="resizable-handle"]').last(),
  tooltipPopup: (page: Page) => page.locator('[data-slot="tooltip-content"]'),
  sidebarHandle: (page: Page) => page.locator('[data-slot="resizable-handle"]').first(),
  changedFilesCard: (page: Page) => page.locator('[data-changed-files-state]').first(),
  changedFileName: (page: Page) =>
    page.locator('[data-changed-files-state] [data-changed-file-name]').first(),
  changedFilesActions: (page: Page) =>
    page.locator('[data-changed-files-state]').first().getByRole('button'),
  changedFilesStat: (page: Page) =>
    page
      .locator('[data-changed-files-state]')
      .first()
      .getByRole('group', { name: /additions/u })
      .first(),
  changedFilesViewDiff: (page: Page) =>
    page
      .locator('[data-changed-files-state]')
      .first()
      .getByRole('button', { name: 'View diff', exact: true }),
  expandChangedFiles: (page: Page) => page.getByRole('button', { name: /^Show all \d+ files$/ }),
  machineDialog: (page: Page) => page.getByRole('dialog', { name: 'Connect machine', exact: true }),
  machineAdd: (page: Page) => page.getByRole('button', { name: 'Add machine', exact: true }),
  machineTarget: (page: Page) => page.getByRole('textbox', { name: 'SSH target', exact: true }),
  sshHostList: (page: Page) =>
    page.getByRole('listbox', { name: 'SSH hosts', exact: true }).first(),
  patternRows: (list: Locator) => list.locator('[data-slot="list-row"]'),
  selectedPatternRows: (list: Locator) =>
    list.locator('[data-slot="list-row"][aria-selected="true"]'),
  clearTerminalHistory: (page: Page) => page.getByRole('menuitem', { name: 'Clear', exact: true }),
  restartTerminalShell: (page: Page) =>
    page.getByRole('menuitem', { name: 'Restart shell', exact: true }),
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
  sessionByTitle: (page: Page, title: string) => page.getByTitle(title, { exact: true }),
  draggingSession: (page: Page) =>
    page.locator('[data-dragging="true"][aria-roledescription="sortable session row"]'),
  sessionShelfTarget: (page: Page, shelf: 'pinned' | 'active' | 'settled') =>
    page.locator(`[data-rail-shelf-target="${shelf}"]`),
  sessionSearch: (page: Page) => page.getByRole('searchbox', { name: 'Search sessions' }),
  archivedSessions: (page: Page) =>
    page.getByRole('button', { name: 'Archived sessions', exact: true }),
  markSessionUnread: (page: Page) =>
    page.getByRole('menuitem', { name: 'Mark as unread', exact: true }),
  acknowledgeSessionWake: (page: Page) =>
    page.getByRole('menuitem', { name: 'Acknowledge wake', exact: true }),
  sessionUnread: (page: Page, title: string) =>
    page.getByTitle(title, { exact: true }).getByLabel('Unread', { exact: true }),
  sessionWoke: (page: Page, title: string) =>
    page.getByTitle(title, { exact: true }).getByText('Woke', { exact: true }),
  deleteSession: (page: Page) => page.getByRole('menuitem', { name: 'Delete', exact: true }),
  confirmSessionDelete: (page: Page) =>
    page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }),
  copySessionPath: (page: Page) => page.getByRole('menuitem', { name: 'Copy Path', exact: true }),
  copySessionBranch: (page: Page) =>
    page.getByRole('menuitem', { name: 'Copy Branch', exact: true }),
  copySessionId: (page: Page) =>
    page.getByRole('menuitem', { name: 'Copy Session ID', exact: true }),
  archiveSession: (page: Page) => page.getByRole('menuitem', { name: 'Archive', exact: true }),
  restoreSession: (page: Page) => page.getByRole('menuitem', { name: 'Unarchive', exact: true }),
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
  editorTabStrip: (page: Page, index: number) =>
    page.locator('[data-editor-group-id]').nth(index).locator('[data-editor-tab-strip]'),
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
  panelHandles: (page: Page) => page.locator('[data-slot="resizable-handle"]'),
  editorSplitHandles: (page: Page) => page.locator('[data-editor-groups]').getByRole('separator'),
  treeItem: (page: Page, name: string) =>
    page.getByLabel('Folder tree', { exact: true }).getByRole('treeitem', { name, exact: true }),
  treeNewFileButton: (page: Page) =>
    page.getByRole('button', { name: 'New file at workspace root', exact: true }),
  confirmTreeDelete: (page: Page) =>
    page.getByRole('dialog').getByRole('button', { name: /^Delete( permanently)?$/ }),
  fileConflict: (page: Page, name: string) =>
    page.getByRole('alertdialog', { name: `${name} changed on disk`, exact: true }),
  mergeConflictLensAction: (page: Page, label: string) =>
    page.locator('.editor-merge-conflict-lens').getByRole('button', { name: label, exact: true }),
  resizablePanel: (page: Page, id: string) =>
    page.locator(`[data-slot="resizable-panel"][id="${id}"]`),
  bottomTab: (page: Page, name: 'Terminal' | 'Problems') =>
    page.getByRole('tablist', { name: 'Bottom panel tabs' }).getByRole('tab', { name }),
  toolTab: (page: Page, name: string) =>
    page.getByRole('navigation', { name: 'Tool tabs' }).getByRole('button', { name, exact: true }),
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
  // Signature help keeps its own namespace, so it is distinguishable from the shared hover.
  editorSignatureHelp: (page: Page) => page.locator('.editor-lsp-plugin-hover:not([hidden])'),
  editorCompletionLabels: (page: Page) =>
    page
      .locator('[class$="-completion"]:not([hidden]) [class$="-completion-item"]')
      .evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent ?? '')),
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
  settingsContinuousSeams: (page: Page) =>
    page.getByRole('switch', { name: 'Continuous panel background', exact: true }),
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
  themeBundlePaletteOption: (page: Page) =>
    page.locator('[cmdk-item][data-value^="theme-bundle:"]'),
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
  diffLineSelectionLabel: (page: Page) =>
    page
      .getByRole('button', { name: 'Ask the agent about these lines', exact: true })
      .locator('xpath=preceding-sibling::span'),
  editorRows: (page: Page) => page.locator('.editor-virtualized-row'),
  editorCursorLineRow: (page: Page) => page.locator('.editor-virtualized-cursor-line-row:visible'),
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
  projectMenuTrigger: (page: Page) => page.getByRole('button', { name: 'Switch project' }),
  projectMenuRows: (page: Page) => page.getByRole('menuitemradio'),
  projectMenuLoader: (page: Page) => page.getByRole('status', { name: 'Loading projects' }),
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
  searchEditorInput: (page: Page) =>
    page.getByTestId('editor').getByRole('searchbox', { name: 'Search workspace', exact: true }),
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
  searchEditorRowWithText: (page: Page, text: string) =>
    page.locator(searchEditorSelector).locator('.editor-virtualized-row').filter({ hasText: text }),
  searchEditorLineOpen: (page: Page, sourceLine: number) =>
    page
      .locator(searchEditorSelector)
      .getByRole('button', { name: new RegExp(`^Open result at line ${sourceLine}\\b`) }),
  searchEditorHoveredLineActions: (page: Page) =>
    page.locator(searchEditorSelector).locator('[data-hovered="true"]'),
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
  chatRewind: (page: Page) =>
    page.getByRole('button', { name: 'Revert to checkpoint before this turn', exact: true }),
  rewindConversation: (page: Page) =>
    page.getByRole('button', { name: 'Rewind conversation only', exact: true }),
  rewindFiles: (page: Page) =>
    page.getByRole('button', { name: 'Rewind and restore files', exact: true }),
  rewindDialog: (page: Page) => page.getByRole('alertdialog'),
  chatComposerFileInput: (page: Page) =>
    page
      .getByRole('button', { name: 'Attach files', exact: true })
      .locator('..')
      .locator('input[type=file]'),
  chatStagedFile: (page: Page, name: string) =>
    page.getByLabel('Attachments', { exact: true }).getByText(name, { exact: true }),
  chatTranscriptFile: (page: Page, name: string) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .getByRole('button', { name, exact: true }),
  chatFilePreview: (page: Page) => page.locator('[data-chat-file-preview]'),
  chatFileDownload: (page: Page, name: string) =>
    page.getByRole('link', { name: `Download ${name}`, exact: true }),
  chatMessage: (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true }),
  chatNewSession: (page: Page) => page.getByRole('button', { name: 'New session', exact: true }),
  chatCorrection: (page: Page) =>
    page.getByRole('button', { name: 'Send correction', exact: true }),
  chatStop: (page: Page) => page.getByRole('button', { name: 'Stop current turn', exact: true }),
  chatSend: (page: Page) => page.getByRole('button', { name: 'Send message', exact: true }),
  chatQueue: (page: Page) => page.getByRole('button', { name: 'Queue message', exact: true }),
  chatQueuedMessages: (page: Page) =>
    page.getByRole('region', { name: 'Queued messages', exact: true }),
  chatQueuedEntry: (page: Page, prompt: string) =>
    page
      .getByRole('region', { name: 'Queued messages', exact: true })
      .getByTitle(prompt, { exact: true }),
  chatSendQueued: (page: Page) =>
    page.getByRole('button', { name: 'Send queued message now', exact: true }),
  chatRestoreQueued: (page: Page) =>
    page.getByRole('button', { name: 'Restore queued message', exact: true }),
  chatTerminalContext: (page: Page) =>
    page
      .locator('form')
      .filter({ has: page.getByRole('textbox', { name: 'Message', exact: true }) })
      .locator('[data-terminal-context-source]'),
  terminalSelectAll: (page: Page) =>
    page.getByRole('menuitem', { name: 'Select All', exact: true }),
  terminalAskAgent: (page: Page) =>
    page.getByRole('menuitem', { name: 'Ask the Agent', exact: true }),
  chatMessages: (page: Page) => page.getByRole('log', { name: 'Messages', exact: true }),
  chatDisclosures: (page: Page) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .locator('[data-scroll-anchor-ignore][aria-expanded="false"]'),
  openDisclosure: (scope: Locator) =>
    scope.locator('[data-scroll-anchor-ignore][aria-expanded="true"]').first(),
  timelineRow: (page: Page, id: string) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .locator(`[data-index] > [data-timeline-row-id="${id}"]`),
  composerActions: (page: Page) => page.locator('[data-composer-actions]'),
  askAgentAboutLines: (page: Page) =>
    page.getByRole('button', { name: 'Ask the agent about these lines', exact: true }),
  stageChanges: (page: Page) =>
    page.getByRole('button', { name: 'Stage all changes', exact: true }),
  changesHeader: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  commitMessage: (page: Page) => page.getByRole('textbox', { name: 'Commit message', exact: true }),
  commitButton: (page: Page) => page.getByRole('button', { name: /^Commit\b/ }),
  commitOutput: (page: Page) => page.getByRole('log', { name: 'Commit output', exact: true }),
  editorTitleAction: (page: Page, label: string) =>
    page.locator('[data-editor-tab-strip]').getByRole('button', { name: label, exact: true }),
  gitFixWithAgent: (page: Page) =>
    page.getByRole('button', { name: 'Fix with agent', exact: true }),
  folderTree: (page: Page) => page.getByLabel('Folder tree', { exact: true }),
  focusedTreeRow: (page: Page) =>
    page.getByLabel('Folder tree', { exact: true }).locator('[role="treeitem"][tabindex="0"]'),
  editorInput: (page: Page) => page.getByRole('textbox', { name: 'Editor input' }),
  diagnosticsList: (page: Page) => page.getByRole('listbox', { name: 'Diagnostics' }),
  diagnosticsRows: (page: Page) =>
    page.getByRole('listbox', { name: 'Diagnostics' }).getByRole('option'),
  editorSurface: (page: Page) => page.locator('.editor-virtualized-viewport'),
  editorFindInput: (page: Page) => page.getByRole('textbox', { name: 'Find', exact: true }),
  editorFindCount: (page: Page) => page.locator('.editor-find-count'),
  terminalSurface: (page: Page) =>
    page.locator('[data-slot="tool-pane"][aria-label="Terminal"]:visible'),
  paletteRowSelector: '[data-slot="command-list"] [role="option"]',
  paletteInput: (page: Page) => page.locator('[data-slot="command-input"]').first(),
  paletteOptions: (page: Page) => page.locator('[data-slot="command-list"]').getByRole('option'),
  selectedPaletteOption: (page: Page) => page.locator('[cmdk-item][data-selected="true"]'),
  settingsLoading: (page: Page) =>
    page.getByRole('status', { name: 'Loading settings', exact: true }),
  settingsModelsLoading: (page: Page) => page.getByRole('status', { name: 'Loading models' }),
  settingsNoModels: (page: Page) => page.getByText('No models are available yet.'),
  paletteScriptsLoading: (page: Page) => page.getByRole('status', { name: 'Loading scripts' }),
  paletteNoScripts: (page: Page) => page.getByText('No scripts in this project.'),
  paletteDialog: (page: Page) => page.getByRole('dialog', { name: 'Command Palette', exact: true }),
  windowToolbar: (page: Page) => page.getByLabel('Window toolbar', { exact: true }),
  editorTab: (page: Page, path: string) => page.locator(`[data-editor-tab-path="${path}"]`),
  createMissingFile: (page: Page) => page.getByRole('button', { name: 'Create File', exact: true }),
  editorTabs: (page: Page) => page.locator('[data-editor-tab-id]'),
  gitPanel: (page: Page) => page.getByRole('region', { name: 'Git panel' }),
  gitChangeRow: (page: Page, name: string) =>
    page.getByRole('region', { name: 'Git panel' }).getByText(name, { exact: true }),
  gitRowAction: (
    page: Page,
    label: 'Stage file' | 'Unstage file' | 'Discard file' | 'Open all diffs',
  ) =>
    page
      .getByRole('region', { name: 'Git panel' })
      .getByRole('button', { name: label, exact: true }),
  /** A row's own action; every row mounts its buttons, so the page-wide one is ambiguous. */
  gitFileRowAction: (page: Page, name: string, label: 'Stage file' | 'Discard file') =>
    page
      .getByRole('region', { name: 'Git panel' })
      .locator('[data-git-file]')
      .filter({ has: page.getByText(name, { exact: true }) })
      .getByRole('button', { name: label, exact: true }),
  gitDiscardDialog: (page: Page, title: string) =>
    page.getByRole('alertdialog', { name: title, exact: true }),
  unexpectedError: (page: Page) => page.getByText('Something unexpected went wrong.'),
  focusGitCommand: (page: Page) => page.getByRole('option', { name: /Focus Git/ }),
  graphButton: (page: Page) => page.getByRole('button', { name: 'Graph', exact: true }),
  // The Changes tab's accessible name carries its live file count.
  gitChangesTab: (page: Page) =>
    page.getByRole('region', { name: 'Git panel' }).getByRole('button', { name: /^Changes\b/ }),
  changesToggle: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  gitDiffScope: (page: Page, scope: 'Working tree' | 'Turn') =>
    page
      .getByRole('group', { name: 'Diff scope' })
      .getByRole('button', { name: scope, exact: true }),
  turnFiles: (page: Page) => page.getByRole('listbox', { name: 'Turn changed files' }),
  worktreeFiles: (page: Page) => page.locator('[data-git-file]:not([data-history-file])'),
  historyList: (page: Page) => page.getByRole('listbox', { name: 'Commit history' }),
  historyRowSelector: '[data-history-commit]',
  logRowSelector: '[data-log-row-summary]',
  logCopyButtons: (page: Page) => page.getByRole('button', { name: 'Copy log event', exact: true }),
  logCleared: (page: Page) => page.getByText('Visible logs cleared.', { exact: true }),
  logRows: (page: Page) => page.locator('[data-log-row-summary]'),
  logsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search logs' }),
  logsTab: (page: Page) => page.getByRole('button', { name: 'Logs', exact: true }),
  renderErrorState: (page: Page) =>
    page.locator('[data-slot="empty-state"]').filter({ hasText: 'hit a render error' }),
  renderErrorRetry: (page: Page) =>
    page
      .locator('[data-slot="empty-state"]')
      .filter({ hasText: 'hit a render error' })
      .getByRole('button', { name: 'Retry' }),
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
  togglePanel: 'Control+J',
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

/** Whether any language-server error is painted, read from the CSS highlight registry. */
export function lspErrorPainted(page: Page) {
  return page.evaluate(hasLspErrorHighlight)
}

export async function waitForLspErrorPaint(page: Page) {
  await page.waitForFunction(hasLspErrorHighlight, undefined, { timeout: 30_000 })
}

function hasLspErrorHighlight() {
  return Array.from(CSS.highlights).some(
    ([name, highlight]) => name.endsWith('-lsp-plugin-error') && highlight.size > 0,
  )
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

export async function chooseColorMode(page: Page, value: 'light' | 'dark' | 'system') {
  await page.keyboard.press(chords.commandPalette)
  await selectors.paletteInput(page).fill('>Choose light / dark mode')
  await selectors.commandOption(page, 'Choose light / dark mode').click()
  await selectors.colorModeOption(page, value).click()
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
}

/** Two frames, then every running animation under the target. Collapsed panels animate open. */
export async function settleAnimations(target: Locator) {
  await target.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        // A toast can be dismissed mid-animation; a cancelled one is settled, not a failure.
        .map((animation) => animation.finished.catch(() => undefined)),
    )
  })
}

/** The colors the shared-token CSS highlights actually paint on an element. */
export function paintedTokenColors(target: Locator): Promise<string[]> {
  return target.evaluate((element) =>
    Array.from(CSS.highlights.entries())
      .filter(([name, highlight]) => name.startsWith('editor-shared-token-') && highlight.size > 0)
      .map(([name]) => getComputedStyle(element, `::highlight(${name})`).color),
  )
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

/** Whether the hover's fenced code wraps the word in a span that carries a token colour. */
export async function hoverTokenColor(page: Page, word: string): Promise<boolean> {
  const spans = selectors.editorHover(page).locator('pre > code > span')
  await spans.first().waitFor({ state: 'attached', timeout: 8000 })
  const style = await spans.getByText(word, { exact: true }).first().getAttribute('style')
  return /(^|;)\s*color:/.test(style ?? '')
}

/** Rests the pointer on the first on-screen occurrence of the word, under `within`, until the hover shows. */
export async function hoverWord(page: Page, word: string, within = 'body') {
  // A string: this package types without the DOM, and the callback runs in the page.
  const point = (await page.evaluate(`((needle, root) => {
    const walker = document.createTreeWalker(document.querySelector(root) ?? document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) continue
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    throw new Error(needle + ' is not on screen')
  })(${JSON.stringify(word)}, ${JSON.stringify(within)})`)) as { x: number; y: number }
  await page.mouse.move(point.x, point.y)
  await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(400)
}

/** Starts recording whether any hover paints a fenced block before its token colours are in. */
export async function watchHoverPlainCode(page: Page) {
  await page.evaluate(`(() => {
    window.__hoverPlainCode = false
    new MutationObserver(() => {
      for (const code of document.querySelectorAll('[data-editor-popup] pre > code[data-language]')) {
        if (!code.querySelector('span')) window.__hoverPlainCode = true
      }
    }).observe(document.body, { childList: true, subtree: true })
  })()`)
}

export async function hoverShowedPlainCode(page: Page): Promise<boolean> {
  return (await page.evaluate('window.__hoverPlainCode')) as boolean
}
