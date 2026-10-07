import type { Locator, Page } from 'playwright'
import type { Editor } from '../../editor/packages/editor/dist/editor'
import type {
  EditorTextBuffer,
  DocumentTextSnapshot,
  TextSnapshot,
} from '../../editor/packages/editor/dist/public/document'
import { createScriptError } from '../structured-errors'
import { detectPlatform } from '../../hotkeys/packages/hotkeys/src/platform'

export const csvSelectors = {
  engineModule: '**/src/features/workbench/utils/csv.ts*',
  presentationModule: '**/src/features/workbench/utils/csv-presentation.ts*',
  presentationError: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'CSV table could not load' }),
  table: (page: Page) => page.getByRole('table', { name: 'CSV rows', exact: true }),
  scroll: (page: Page) =>
    page
      .getByRole('table', { name: 'CSV rows', exact: true })
      .locator('[data-slot="virtual-list"]'),
  cell: (page: Page, row: number, column: number) =>
    page.getByRole('button', { name: `Row ${row}, column ${column}`, exact: true }),
  cellEditor: (page: Page, row: number, column: number) =>
    page.getByRole('textbox', { name: `Row ${row}, column ${column}`, exact: true }),
  mode: (page: Page, mode: 'Text' | 'Table') =>
    page.getByRole('button', { name: mode, exact: true }),
  header: (page: Page) => page.getByRole('button', { name: 'First row is header', exact: true }),
  undo: (page: Page) => page.getByRole('button', { name: 'Undo', exact: true }),
  redo: (page: Page) => page.getByRole('button', { name: 'Redo', exact: true }),
  parseError: (page: Page) => page.getByText('CSV could not be read', { exact: true }),
  engineError: (page: Page) => page.getByText('CSV engine could not load', { exact: true }),
  preparing: (page: Page) => page.getByRole('status', { name: 'Preparing CSV table' }),
  queryRetry: (page: Page) =>
    page.getByRole('status').getByRole('button', { name: 'Retry', exact: true }),
}

export const treeScrollSelectors = {
  scroll: '[data-file-tree-virtualized-scroll]',
  flow: '[data-file-tree-virtualized-sticky]',
  overlay: '[data-file-tree-sticky-overlay-content]',
  clip: '[data-file-tree-viewport-clip]',
} as const

export const folderTreeShadowHost = 'file-tree-container[aria-label="Folder tree"]'
export const rootSwitchRows = {
  Git: '[aria-label="Git changes"] [role="treeitem"][aria-level="2"]',
  Files: '[role="treeitem"]',
} as const

export const transientAlertSelector =
  '[role="alert"], [data-sonner-toast], [role="status"].text-warning'
export const fileIconSelector = '[data-file-icon], [style*="vscode-icons/"]'
export const wallpaperLayerSelector = '[data-workbench] img[data-workbench-wallpaper-layer="still"]'
export const wallpaperImageSelector = 'img[data-workbench-wallpaper-layer]'
export const diffPaneSelector = '.editor-diff-pane'
/** A diff pane whose syntax tokens for its current rows have landed. */
export const diffPaneSyntaxReadySelector = '.editor-diff-pane[data-syntax="ready"]'
export const diffContentRowSelector = '.editor-diff-pane [data-editor-virtual-row]'
export const editorViewportSelector = '.editor-virtualized-viewport'
export const settingsComparisonSelector = '[role="region"][aria-label="Settings comparison"]'
export const settingsNativeHostSelector = '.editor-virtualized'
/** Rows the markdown live preview has decorated (headings, lists, emphasis). */
export const markdownPreviewRowSelector = '[class*="editor-inline-"]'
export const markdownEditorLinkSelector = '.editor-markdown-link'
export const chatMessagesLogSelector = '[role="log"][aria-label="Messages"]'
const chatComposerSelector = '[data-testid="chat-input-editor"]'
const projectSwitcherSelector = '[aria-label="Switch project"]'
export const mermaidSelectors = {
  diagram: '[data-markdown="mermaid-block"] [role="img"]',
  svg: 'svg',
  node: '.node',
  label: '.nodeLabel',
  styleFixture: '[data-mermaid-style-fixture]',
}
export const editorRowSelector = '[data-editor-virtual-row]'
export const sharedTokenHighlightPrefix = 'editor-shared-token-'
export const editorTokenPaintSelectors = {
  viewportSelector: editorViewportSelector,
  rowSelector: '.editor-virtualized-row',
  excludedLayers:
    '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,' +
    '.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row',
  highlightPrefix: sharedTokenHighlightPrefix,
} as const
/** The decode plugin's hidden-rows class, its diffusion overlay, and one overlay glyph. */
export const decodeSelectors = {
  active: '.editor-decode-active',
  glyphLayer: '.editor-decode-glyph-layer',
  glyph: '.editor-decode-glyph',
} as const
export const searchEditorSelector = '[aria-label="Search result editor"]'
export const searchEditorFileRowSelector = '[role="treeitem"][aria-level="1"]'
export const editorTokenActivationSelectors = {
  group: '[data-editor-group-id]',
  selectedTab: '[data-editor-tab-path][aria-selected="true"]',
} as const
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
function sessionRowForWorktree(page: Page, worktreeId: string) {
  return page
    .getByRole('listbox', { name: 'Sessions', exact: true })
    .getByRole('option')
    .filter({ has: page.locator(`[data-worktree-id="${worktreeId}"]`) })
}

export const deferredChatModuleRoutes = {
  workspace: '**/src/features/chat-mode/components/surface-view.tsx*',
  panel: '**/src/features/chat/components/chat-side-panel.tsx*',
} as const

export const selectors = {
  deferredChatLoading: (page: Page, surface: 'workspace' | 'panel') =>
    page.getByRole('status', { name: `Opening chat ${surface}`, exact: true }),
  deferredChatError: (page: Page, surface: 'workspace' | 'panel') =>
    page.getByText(`Unable to load chat ${surface}`, { exact: true }),
  fileReadRetry: (page: Page) => page.getByRole('button', { name: 'Retry', exact: true }),
  fileReadErrorHeader: (page: Page) => page.locator('header[aria-label="File read error"]'),
  chatFileFallback: (page: Page) =>
    page.getByText('Download this file to view its contents.', { exact: true }),
  fileFacts: (page: Page) => page.getByRole('region', { name: 'File facts' }),
  missingFileMessage: (page: Page) =>
    page.getByText('This file no longer exists.', { exact: true }),
  pdfEngineFailure: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'The PDF viewer could not be loaded' }),
  pdfScroller: (page: Page) => page.locator('[data-pdf-pages]'),
  pdfSearch: (page: Page) => page.getByRole('textbox', { name: 'Search PDF', exact: true }),
  pdfPage: (page: Page, number: number) => page.locator(`[data-pdf-page="${number}"]`),
  pdfMatchCountValue: (page: Page, count: number) =>
    page
      .getByRole('status')
      .filter({ hasText: new RegExp(`^${count} ${count === 1 ? 'match' : 'matches'}$`) }),
  pdfMatchCount: (page: Page) => page.getByRole('status').filter({ hasText: '2 matches' }),
  pdfNext: (page: Page) => page.getByRole('button', { name: 'Next', exact: true }),
  pdfFailure: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'The PDF could not be opened' }),
  forgeActivityTab: (page: Page) => page.getByRole('tab', { name: 'Activity', exact: true }),
  forgeCommentsTab: (page: Page) => page.getByRole('tab', { name: 'Comments', exact: true }),
  forgeDiscussion: (page: Page) =>
    page.getByRole('dialog', { name: 'Pull request #7 discussion', exact: true }),
  forgeReviewSummary: (page: Page) =>
    page.getByRole('textbox', { name: 'Review summary', exact: true }),
  forgeComment: (page: Page) => page.getByRole('textbox', { name: 'Comment', exact: true }),
  forgeCommentText: (page: Page, text: string) =>
    page
      .getByRole('dialog', { name: 'Pull request #7 discussion', exact: true })
      .getByText(text, { exact: true }),

  startupFailure: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'App could not start' }),
  reloadApp: (page: Page) => page.getByRole('button', { name: 'Reload app', exact: true }),
  pullRequestLookupRetry: (page: Page) => page.locator('[data-pull-request-lookup-retry]'),
  liveWorkLogToggle: (page: Page) =>
    page.locator('[data-live-activity]').getByRole('button').first(),
  workLogGroup: (page: Page) => page.getByRole('region', { name: 'Activity history', exact: true }),
  workLogOutput: (page: Page) =>
    page
      .getByRole('region', { name: 'Activity history', exact: true })
      .locator('pre[aria-label="Output"]'),
  manageWorktrees: (page: Page) =>
    page.getByRole('button', { name: 'Manage worktrees', exact: true }),
  worktreeManager: (page: Page) => page.getByRole('dialog', { name: 'Worktrees', exact: true }),
  releaseWorktree: (page: Page) =>
    page.getByRole('button', { name: 'Stop managing…', exact: true }),
  releaseWorktreeDialog: (page: Page) =>
    page.getByRole('dialog', { name: 'Stop managing worktree', exact: true }),
  cancelWorktreeRelease: (page: Page) =>
    page
      .getByRole('dialog', { name: 'Stop managing worktree', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true }),
  completedWorkGroup: (page: Page) => page.getByRole('button', { name: /^Worked for / }),
  reasoningDetail: (page: Page) => page.getByRole('region', { name: 'Reasoning', exact: true }),
  recoverableDraft: (page: Page, label: string) =>
    page
      .getByRole('listbox', { name: 'Drafts', exact: true })
      .getByRole('option')
      .filter({ hasText: label }),
  discardDraft: (page: Page, label: string) =>
    page.getByRole('button', { name: `Discard draft: ${label}`, exact: true }),
  composerAccess: (page: Page) => page.getByRole('menuitemradio', { name: /^Full access/ }),
  composerAskFirst: (page: Page) => page.getByRole('menuitemradio', { name: /^Ask first/ }),
  chatExactText: (page: Page, text: string) => page.getByText(text, { exact: true }),
  chatContainingText: (page: Page, text: string) => page.getByText(text, { exact: false }),
  composerModes: (page: Page) =>
    page.getByRole('button', { name: 'Agent access and mode', exact: true }),
  composerPlan: (page: Page) => page.getByRole('menuitemradio', { name: /^Plan/ }),
  contextMeter: (page: Page) => page.getByRole('button', { name: /^Context / }),
  sessionCacheDetails: (page: Page) =>
    page.getByRole('region', { name: 'Recent prompt cache', exact: true }),
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
  snoozeDurationMode: (page: Page) => page.getByRole('tab', { name: 'Duration', exact: true }),
  snoozeAmount: (page: Page) => page.getByRole('spinbutton', { name: 'Duration', exact: true }),
  snoozeCustomSubmit: (page: Page) =>
    page.getByRole('button', { name: 'Snooze until chosen time', exact: true }),
  snoozeDialog: (page: Page) => page.getByRole('dialog', { name: 'Snooze sessions', exact: true }),
  selectedSessionsToolbar: (page: Page) => page.getByRole('toolbar', { name: 'Selected sessions' }),
  markedSession: (page: Page, title: string) =>
    page.getByTitle(title, { exact: true }).and(page.locator('[data-marked]')),
  sessionBulkActions: (page: Page) =>
    page
      .getByRole('toolbar', { name: 'Selected sessions' })
      .getByRole('button', { name: 'Actions', exact: true }),
  toastUndo: (page: Page, text: string) =>
    page
      .locator('[data-sonner-toast]:not([data-removed="true"])')
      .filter({ has: page.getByText(text, { exact: true }) })
      .getByRole('button', { name: 'Undo', exact: true }),
  undoNotice: (page: Page, text: string) =>
    page
      .locator('[data-sonner-toast]:not([data-removed="true"])')
      .filter({ has: page.getByText(text, { exact: true }) }),
  sessionUndoNotices: (page: Page) =>
    page
      .locator('[data-sonner-toast]:not([data-removed="true"])')
      .filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) }),
  shelfRowTitles: (page: Page, shelf: string) =>
    page.getByRole('region', { name: shelf, exact: true }).locator('[title]'),

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
      .getByRole('status')
      .filter({ hasText: prompt }),
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
  genericApproval: (page: Page) =>
    page.getByRole('region', { name: 'Approval requested', exact: true }),
  genericApprovalDecision: (page: Page, label: string) =>
    page
      .getByRole('region', { name: 'Approval requested', exact: true })
      .getByRole('button', { name: label, exact: true }),
  commandApproval: (page: Page) => page.getByRole('region', { name: 'Run a command', exact: true }),
  commandApprovalDecision: (page: Page, label: string | RegExp) =>
    page
      .getByRole('region', { name: 'Run a command', exact: true })
      .getByRole('button', { name: label, exact: true }),
  imageLightbox: (page: Page, name: string) => page.getByRole('dialog', { name, exact: true }),
  iconHintControl: (scope: Page | Locator, name: string) =>
    scope.getByRole('button', { name, exact: true }),
  chatHeaderNew: (page: Page) => page.getByRole('button', { name: 'New chat', exact: true }),
  sessionActions: (page: Page) =>
    page.getByRole('button', { name: 'Session actions', exact: true }),
  chatHeaderHistory: (page: Page) =>
    page.getByRole('button', { name: 'Conversation history', exact: true }),
  hint: (page: Page, label: string) =>
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: label }),
  popupMenu: (page: Page) => page.getByRole('menu'),
  draftAgent: (page: Page) => page.getByRole('button', { name: 'Run the session as an agent' }),
  draftAgentChoice: (page: Page, name: string) =>
    page.getByRole('menuitemradio').filter({ hasText: name }),
  modelPickerTrigger: (page: Page) =>
    page.getByRole('button', { name: 'Provider and model', exact: true }),
  modelPickerPanel: (page: Page) =>
    page.getByRole('dialog').filter({ has: page.getByLabel('Models') }),
  modelPickerSearch: (page: Page) => page.getByPlaceholder('Search models'),
  modelPickerProvider: (page: Page, provider: string) =>
    selectors.modelPickerPanel(page).getByRole('button', { name: provider, exact: true }),
  modelPickerLegacy: (page: Page) =>
    page.getByRole('option').filter({ has: page.getByText('Legacy models', { exact: true }) }),
  modelPickerOption: (page: Page, label: string) =>
    page.getByRole('option').filter({ has: page.getByText(label, { exact: true }) }),
  modelOptions: (page: Page) => page.getByRole('button', { name: 'Model options', exact: true }),
  /** The one-shot burst under the composer when the effort rises to max or ultra. */
  effortBurst: (page: Page, tier: 'max' | 'ultra') => page.locator(`[data-effort-burst="${tier}"]`),
  effortRainbow: (scope: Locator) => scope.locator('.rainbow-text'),
  modelOptionChoice: (page: Page, group: string, choice: string) =>
    page
      .getByRole('group', { name: group, exact: true })
      .getByRole('menuitemradio', { name: choice, exact: true }),
  branchLanes: (page: Page) => page.locator('[data-slot="branch-lane"]'),
  draftWorkspace: (page: Page) => page.getByRole('button', { name: 'Workspace', exact: true }),
  draftBaseBranch: (page: Page) =>
    page.getByRole('button', { name: 'Start from branch', exact: true }),
  machinePreferences: (page: Page) => page.getByRole('combobox', { name: /selection preference$/ }),
  selectOption: (page: Page, name: string) => page.getByRole('option', { name, exact: true }),
  draftMachine: (page: Page) => page.getByRole('button', { name: 'Machine', exact: true }),
  menuRadio: (page: Page, name: string) =>
    page.getByRole('menu').getByRole('menuitemradio', { name, exact: true }),
  modelOptionSwitch: (page: Page, name: string) =>
    page.getByRole('menuitemcheckbox', { name, exact: true }),
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
  timelineJumpToLatest: (page: Page) => page.locator('[data-slot="tail-jump-button"]'),
  breadcrumbLoadedSelector: '[aria-label="Breadcrumbs"] [data-breadcrumb-item]',
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
  openTooltipPopup: (page: Page) => page.locator('[data-slot="tooltip-content"][data-open]'),
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
  machineConnect: (page: Page) => page.getByRole('button', { name: 'Connect', exact: true }),
  // SSH host rows in the add form are titled buttons too; they carry role="option".
  machinePickerRows: (page: Page) =>
    page
      .getByRole('dialog', { name: 'Connect machine', exact: true })
      .locator('button[title]:not([role="option"])'),
  fixWithAi: (scope: Page | Locator) =>
    scope.getByRole('button', { name: 'Fix with AI', exact: true }),
  machineTarget: (page: Page) => page.getByRole('textbox', { name: 'SSH target', exact: true }),
  machineRemoteUrl: (page: Page) => page.getByRole('button', { name: /^Remote URL/ }),
  machineServerUrl: (page: Page) => page.getByRole('textbox', { name: 'Server URL', exact: true }),
  machineDetails: (scope: Page | Locator, label: string) =>
    scope.getByRole('button', { name: `${label} connection details`, exact: true }),
  machineDetailsPopover: (page: Page, label: string) =>
    page.getByRole('dialog', { name: `${label} connection`, exact: true }),
  machineFormCancel: (dialog: Locator) =>
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  machineDialogError: (dialog: Locator) => dialog.getByRole('alert'),
  serverOutOfDate: (scope: Page | Locator) => scope.getByText('Protocol mismatch', { exact: true }),
  sshHostList: (page: Page) =>
    page.getByRole('listbox', { name: 'SSH hosts', exact: true }).first(),
  patternRows: (list: Locator) => list.locator('[data-slot="list-row"]'),
  selectedPatternRows: (list: Locator) =>
    list.locator('[data-slot="list-row"][aria-selected="true"]'),
  clearTerminalHistory: (page: Page) => page.getByRole('menuitem', { name: 'Clear', exact: true }),
  restartTerminalShell: (page: Page) =>
    page.getByRole('menuitem', { name: 'Restart shell', exact: true }),
  treeRenameInput: (page: Page) => selectors.folderTree(page).locator('[data-item-rename-input]'),
  treeRenameMenuItem: (page: Page) => page.getByRole('menuitem', { name: /^Rename\b/ }),
  terminalName: (page: Page) => page.getByRole('textbox', { name: 'Terminal name', exact: true }),
  commitFilesTree: (page: Page) => page.getByRole('tree', { name: 'Commit files', exact: true }),
  newTerminal: (page: Page) => page.getByRole('button', { name: 'New terminal', exact: true }),
  projectMenu: (page: Page) => page.getByRole('button', { name: 'Switch project', exact: true }),
  openFolderMenu: (page: Page) => page.getByRole('menuitem', { name: 'Open folder…', exact: true }),
  pickerLoadedRowsSelector: '[role="dialog"] [role="option"]',
  settingsContentSelector: '[aria-label="Settings form"], .editor-virtualized-viewport',
  fontSampleReadySelector: '[aria-label="Code font"] span[style]:not(:has([data-slot="shimmer"]))',
  settingsFormView: (page: Page) => page.getByRole('tab', { name: 'Settings', exact: true }),
  pickerDialog: (page: Page) => page.getByRole('dialog', { name: 'Choose folder', exact: true }),
  pickerList: (page: Page) => page.getByRole('listbox', { name: 'Folders and files', exact: true }),
  pickerOptions: (page: Page) =>
    page.getByRole('listbox', { name: 'Folders and files', exact: true }).getByRole('option'),
  pickerGoToFolder: (page: Page) => page.getByRole('button', { name: 'Go to folder', exact: true }),
  pickerFolderPath: (page: Page) => page.getByRole('textbox', { name: 'Folder path', exact: true }),
  pickerSearch: (page: Page) =>
    page.getByRole('textbox', { name: 'Search files and folders', exact: true }),
  pickerEmpty: (page: Page) => page.getByText('Nothing here', { exact: true }),
  pickerRow: (page: Page, name: string) =>
    page
      .getByRole('dialog', { name: 'Choose folder', exact: true })
      .getByRole('option')
      // Folder glyphs carry whitespace between their paths, so the name follows it.
      .filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }),
  pickerHiddenToggle: (page: Page, shown: boolean) =>
    page.getByRole('button', {
      name: shown ? 'Hide hidden files' : 'Show hidden files',
      exact: true,
    }),
  pickerPreviewPath: (page: Page, path: string) => page.locator(`[data-file-preview="${path}"]`),
  pickerSidebarSection: (page: Page, name: string) =>
    selectors.pickerDialog(page).getByRole('region', { name, exact: true }),
  pickerPinFolder: (page: Page, pinned: boolean) =>
    page.getByRole('button', {
      name: pinned ? 'Unpin this folder' : 'Pin this folder',
      exact: true,
    }),
  /** A preview showing content: code, a decoded image or a folder's children. */
  pickerPreviewContentSelector:
    '[data-file-preview] [data-file-preview-text], [data-file-preview] img, [data-file-preview] ul',
  paletteImportText: (page: Page) =>
    page.getByRole('textbox', { name: 'Palette JSON', exact: true }),
  pickerPreview: (page: Page) => page.locator('[data-file-preview]'),
  pickerPreviewText: (page: Page) =>
    selectors.pickerDialog(page).locator('[data-file-preview-text]'),
  pickerPreviewFacts: (page: Page) => selectors.pickerPreview(page).locator('dl'),
  palettePreviewText: (page: Page) =>
    selectors.quickOpenPreview(page).locator('[data-file-preview-text]'),
  themeStudio: (page: Page) => page.getByRole('region', { name: 'Theme studio', exact: true }),
  themeStudioTab: (page: Page, name: string) =>
    page
      .getByRole('region', { name: 'Theme studio', exact: true })
      .getByRole('tab', { name, exact: true }),
  themeStudioMode: (page: Page, mode: 'dark' | 'light') =>
    page.getByRole('button', { name: `Preview the ${mode} half`, exact: true }),
  themeStudioCard: (page: Page, id: string) =>
    page.locator(`[data-studio-themes] [role="option"][data-theme-id="${id}"]`),
  titlebar: (page: Page) => page.locator('header[data-native-window-drag-region]').first(),
  settingsOpen: (page: Page) => page.getByRole('button', { name: 'Settings', exact: true }).first(),
  themeStudioOpen: (page: Page) => page.getByRole('button', { name: 'Open studio', exact: true }),
  quickOpenPreviewHeaderSelector: '[aria-label="File preview"] header',
  quickOpenPreviewTextSelector: '[aria-label="File preview"] [data-file-preview-text]',
  quickOpenPreview: (page: Page) => page.getByRole('region', { name: 'File preview', exact: true }),
  pickerFolderColumn: (page: Page, path: string) =>
    page.locator(`[data-picker-column-folder="${path.replace(/^\//u, '')}"]`),
  pickerColumn: (page: Page, index: number) => page.locator(`[data-picker-column="${index}"]`),
  pickerColumnBox: (page: Page, index: number) =>
    page.locator('[data-picker-column-folder]').nth(index),
  pickerColumnHandle: (page: Page, index: number) =>
    page.locator('[data-picker-column-folder]').nth(index).getByRole('separator'),
  /** 0 is the places sidebar, 1 the browsing area, 2 the preview. */
  pickerPane: (page: Page, index: number) =>
    selectors.pickerDialog(page).locator('[data-slot="resizable-panel"]').nth(index),
  /** 0 sits right of the places sidebar, 1 left of the preview. */
  pickerPaneHandle: (page: Page, index: number) =>
    selectors.pickerDialog(page).locator('[data-slot="resizable-handle"]').nth(index),
  pickerPreviewScroll: (page: Page) => page.locator('[data-file-preview-scroll]'),
  pickerPreviewLines: (page: Page) => page.locator('[data-file-preview-lines]'),
  pickerPreviewNote: (page: Page) => page.locator('[data-file-preview-scroll] [role="note"]'),
  pickerView: (page: Page, view: 'Columns' | 'List' | 'Icons') =>
    page
      .getByRole('tablist', { name: 'View', exact: true })
      .getByRole('tab', { name: view, exact: true }),
  pickerStatus: (page: Page) =>
    page.getByRole('dialog', { name: 'Choose folder', exact: true }).getByRole('status').last(),
  pickerChoose: (page: Page) =>
    page
      .getByRole('dialog', { name: 'Choose folder', exact: true })
      .getByRole('button', { name: 'Choose folder', exact: true }),
  liveUpdatesLimited: (page: Page) =>
    page.getByRole('button', { name: 'Live updates limited', exact: true }),
  navigationTarget: (page: Page) => page.locator('[data-navigation-target]'),
  navigationShield: (page: Page) => page.locator('[data-navigation-shield]'),
  treeItemFixWithAi: (page: Page, name: string) =>
    page
      .getByLabel('Folder tree', { exact: true })
      .getByRole('treeitem', { name, exact: true })
      .getByRole('button', { name: 'Fix with AI', exact: true }),
  treeItemDecoration: (page: Page, name: string) =>
    page
      .getByLabel('Folder tree', { exact: true })
      .getByRole('treeitem', { name, exact: true })
      .locator('[data-item-section="decoration"]'),
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
  terminalById: (page: Page, id: string) =>
    page
      .getByRole('tablist', { name: 'Open terminals', exact: true })
      .locator(`[data-terminal-tab-id=${JSON.stringify(id)}]`),
  terminalRows: (page: Page) =>
    page.getByRole('tablist', { name: 'Open terminals', exact: true }).getByRole('tab'),
  terminalDraggingRow: (page: Page) =>
    page
      .getByRole('tablist', { name: 'Open terminals', exact: true })
      .locator('[data-dragging="true"]'),
  connectMachineMenu: (page: Page) =>
    page.getByRole('menuitem', { name: 'Connect machine…', exact: true }),
  sessionTitleSelector: (title: string) => `[title=${JSON.stringify(title)}]`,
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
  removeWorktreeSwitch: (page: Page) =>
    page.getByRole('dialog').getByRole('switch', { name: /^Also remove its worktree/ }),
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
  sessionRowForWorktree,
  sessionPullRequestBadge: (page: Page, worktreeId: string) =>
    sessionRowForWorktree(page, worktreeId).locator('[data-pull-request-state]'),
  sessionWorktreeChip: (page: Page, worktreeId: string) =>
    sessionRowForWorktree(page, worktreeId).locator(`[data-worktree-id="${worktreeId}"]`),
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
    page.locator('[data-editor-group-id]').nth(index).getByRole('listbox', { name: 'Versions' }),
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
  codeThemePreviewHeaderSelector:
    '[aria-label="Code theme sample"] [aria-live] > span:first-child, [aria-label="Theme studio"] [data-slot="tool-pane-header"] .font-medium',
  codeThemePreviewContentSelector: '[data-code-theme-preview] pre[data-theme-id]',
  studioCodeColors: (page: Page) =>
    selectors.themeStudio(page).getByRole('listbox', { name: 'Code colors' }),
  codeThemeDialog: (page: Page) =>
    page.getByRole('dialog', { name: 'Choose code theme', exact: true }),
  codeThemeOptions: (page: Page) => page.locator('[data-value^="color-theme:"]'),
  codeThemeOption: (page: Page, id: string) => page.locator(`[data-value="color-theme:${id}"]`),
  codeThemePreviewTokens: (page: Page, id: string) =>
    page.locator(`[data-code-theme-preview="${id}"] pre code span[style*="color"]`),
  wallpaperAsset: (page: Page, id: string) =>
    page.locator(`${wallpaperStillSelector}[src*="${id}"]`),
  themeRoot: (page: Page) => page.locator('html'),

  editorHover: (page: Page) => page.locator('.editor-plugin-hover:not([hidden])'),
  // Signature help keeps its own namespace, so it is distinguishable from the shared hover.
  editorSignatureHelp: (page: Page) => page.locator('.editor-lsp-plugin-hover:not([hidden])'),
  editorCompletionFocusedLabel: (page: Page) =>
    page
      .locator('[class$="-completion"]:not([hidden]) [aria-selected="true"]')
      .evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent ?? '')[0] ?? null),
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
  settingsFontPicker: (page: Page, role: 'Interface font' | 'Code font') =>
    page.getByRole('combobox', { name: role, exact: true }),
  fontPickerSearch: (page: Page) => page.getByRole('combobox', { name: /^Search .* fonts$/u }),
  fontPickerOption: (page: Page, name: RegExp) => page.getByRole('option', { name }),
  fontPickerGroup: (page: Page, name: 'Recent' | 'Suggested') =>
    page.locator('[data-slot="combobox-group-label"]', { hasText: name }),
  chooseFolder: (page: Page) => page.getByRole('button', { name: 'Choose folder', exact: true }),
  navigationError: (page: Page) => page.getByRole('alert').filter({ hasText: 'Fix with AI' }),
  settingsDialog: (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true }),
  mcpSettings: (page: Page) => page.locator('[data-mcp-section]'),
  mcpSettingsRow: (page: Page, name: string) => page.locator(`[data-mcp-server="${name}"]`),
  settingsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search settings' }),
  quickOpenPreviewToggle: (page: Page) =>
    selectors.settingsRow(page, 'search.quickOpenPreview').getByRole('switch'),
  settingsShowAll: (page: Page) => page.getByRole('button', { name: 'Show all settings' }),
  settingsCategoryFilter: (page: Page, category: string) =>
    page.getByRole('button', {
      name: `Clear the ${category} filter and show every setting`,
      exact: true,
    }),
  settingsCategoryHeading: (page: Page, name: string) =>
    page.getByRole('heading', { name, exact: true }),
  projectSettingsSection: (page: Page, title: string) =>
    page.getByRole('region', { name: `${title} settings` }),
  projectSetting: (page: Page, name: string) => page.getByRole('combobox', { name, exact: true }),
  projectSettingOption: (page: Page, name: string | RegExp) =>
    page.getByRole('option', { name, exact: true }),
  settingsFeel: (page: Page) => page.getByRole('combobox', { name: 'Feel', exact: true }),
  feelOption: (page: Page, feel: string) =>
    page.getByRole('option', { name: feel.charAt(0).toUpperCase() + feel.slice(1), exact: true }),
  physicalGallery: (page: Page) => page.locator('[data-physical-gallery]'),
  physicalButton: (page: Page, name: string) => page.getByRole('button', { name, exact: true }),
  physicalSwitch: (page: Page, name: string) => page.getByRole('switch', { name, exact: true }),
  physicalThumb: (page: Page) =>
    page
      .getByRole('switch', { name: 'Preview switch', exact: true })
      .locator('[data-slot="switch-thumb"]'),
  physicalField: (page: Page) => page.getByRole('textbox', { name: 'Preview field', exact: true }),
  physicalMenu: (page: Page) => page.getByRole('menu'),
  physicalDialog: (page: Page) =>
    page.getByRole('dialog', { name: 'Physical dialog', exact: true }),
  physicalRow: (page: Page) => page.getByRole('option', { name: 'Silent row', exact: true }),
  settingsForm: (page: Page) => page.getByRole('region', { name: 'Settings form', exact: true }),
  settingsHeader: (page: Page) => page.locator('[data-settings-header]'),
  settingsSummaryCount: (page: Page) =>
    page.locator('[data-settings-header]').getByText(/^\d+ settings?$/),
  shortcutsSearch: (page: Page) =>
    page.getByRole('textbox', { name: 'Search keyboard shortcuts', exact: true }),
  shortcutActions: (page: Page) =>
    page.getByRole('button', { name: 'Shortcut actions', exact: true }),
  shortcutReportCopy: (page: Page) =>
    page.getByRole('menuitem', { name: 'Copy shortcut report', exact: true }),
  shortcutMetadataLoading: (page: Page) =>
    page.getByRole('status', { name: 'Loading preset report', exact: true }),
  shortcutMetadataError: (page: Page) =>
    page.getByText('The preset report could not be loaded.', { exact: true }),
  shortcutMetadataReload: (page: Page) =>
    page.getByRole('button', { name: 'Reload app', exact: true }),
  shortcutUnmapped: (page: Page) => page.getByRole('button', { name: /^Unmapped Zed actions/ }),
  shortcutsList: (page: Page) => page.getByRole('listbox', { name: 'Keyboard shortcuts' }),
  shortcutRow: (page: Page, command: string, keys?: string, context?: string) =>
    page.locator(
      `[data-shortcut-command="${command}"]${keys ? `[data-shortcut-keys="${keys}"]` : ''}${context !== undefined ? `[data-shortcut-context="${context}"]` : ''}`,
    ),
  shortcutRecorder: (page: Page, title: string) =>
    page.getByRole('textbox', { name: `Press the new shortcut for ${title}`, exact: true }),
  shortcutContext: (page: Page) =>
    page.getByRole('textbox', { name: 'Shortcut context', exact: true }),
  shortcutSave: (page: Page) => page.getByRole('button', { name: 'Save', exact: true }),
  shortcutPresetTabs: (page: Page) =>
    page.getByRole('tablist', { name: 'Keyboard mode', exact: true }),
  shortcutPresetRow: (page: Page, command: string) =>
    page.locator(`[data-shortcut-command="${command}"][data-shortcut-source="default"]`).first(),
  shortcutEntries: (page: Page) =>
    page.getByRole('button', { name: /^Authored bindings and reservations/ }),
  shortcutEntryKeys: (page: Page) =>
    page.getByRole('textbox', { name: 'Authored binding keys', exact: true }),
  shortcutEntryContext: (page: Page) =>
    page.getByRole('textbox', { name: 'Authored binding context', exact: true }),
  shortcutEntryKind: (page: Page) =>
    page.getByRole('combobox', { name: 'Binding entry kind', exact: true }),
  shortcutEntryUnbindOption: (page: Page) =>
    page.getByRole('option', { name: 'Unbind command', exact: true }),
  shortcutEntryCommand: (page: Page) =>
    page.getByRole('textbox', { name: 'Command to unbind', exact: true }),
  shortcutEntryAdd: (page: Page) => page.getByRole('button', { name: 'Add entry', exact: true }),
  shortcutEntryDelete: (page: Page, index: number) =>
    page.getByRole('button', { name: `Delete authored binding ${index + 1}`, exact: true }),
  shortcutFilter: (page: Page, name: 'All' | 'Custom' | 'Conflicts' | 'Unassigned') =>
    page.getByRole('tab', { name: new RegExp(`^${name}`) }),
  shortcutRecordKeys: (page: Page) =>
    page.getByRole('button', { name: 'Record keys', exact: true }),
  shortcutMenuItem: (page: Page, name: RegExp) => page.getByRole('menuitem', { name }),
  settingDetailsButton: (page: Page, title: string) =>
    page.getByRole('button', { name: `About ${title}`, exact: true }),
  settingsSwitch: (page: Page, title: string) =>
    page.getByRole('switch', { name: title, exact: true }),
  settingsDependencyNote: (page: Page, parentTitle: string) =>
    page.getByText(`Applies while ${parentTitle} is on`, { exact: true }),
  settingsContinuousSeams: (page: Page) =>
    page.getByRole('switch', { name: 'Continuous panel background', exact: true }),
  settingsDensity: (page: Page) =>
    page.getByRole('combobox', { name: 'Interface density', exact: true }),
  settingsDensityOption: (page: Page, density: 'compact' | 'cozy') =>
    page.getByRole('option', { name: density === 'compact' ? 'Compact' : 'Cozy', exact: true }),
  settingsJsonView: (page: Page) => page.getByRole('tab', { name: 'settings.json', exact: true }),
  settingsScopeTab: (page: Page, name: 'User' | 'Workspace' | 'Defaults', selected?: boolean) =>
    page.getByRole('tab', { name, exact: true, selected }),
  settingsDefaultsBanner: (page: Page) => page.getByText('Defaults are read-only', { exact: true }),
  settingsEnum: (page: Page, title: string) =>
    page.getByRole('combobox', { name: title, exact: true }),
  settingsEnumOption: (page: Page, title: string) =>
    page.getByRole('option', { name: title, exact: true }),
  settingsScopeIndicator: (page: Page) =>
    page
      .getByRole('tablist', { name: 'Settings scope', exact: true })
      .locator('[data-slot="tabs-indicator"]'),
  settingsRawConflictBanner: (page: Page) =>
    page.getByText('settings.json changed somewhere else', { exact: true }),
  settingsComparison: (page: Page) => page.locator(settingsComparisonSelector),
  settingsCompare: (page: Page) => page.getByRole('button', { name: 'Compare', exact: true }),
  settingsHideComparison: (page: Page) =>
    page.getByRole('button', { name: 'Hide compare', exact: true }),
  settingsKeepChanges: (page: Page) =>
    page.getByRole('button', { name: 'Keep my changes', exact: true }),
  settingsUseLatest: (page: Page) =>
    page.getByRole('button', { name: 'Use the latest version', exact: true }),
  settingsEditableViewport: (page: Page) => page.locator(editorViewportSelector).last(),
  gitSizeLimitNotice: (page: Page) =>
    page.getByText(
      'File exceeds the Git diff size limit. Adjust Diff file size limit in Settings to compare it.',
      { exact: true },
    ),
  settingsNumber: (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true }),
  settingsRow: (page: Page, id: string) => page.locator(`[data-setting-row="${id}"]`),
  settingsCodeThemePreview: (page: Page, id: string) =>
    page.locator(`[data-setting-row="${id}"] [data-code-theme-preview] pre[data-theme-id]`),
  settingsSlider: (page: Page, title: string) =>
    page.getByRole('slider', { name: title, exact: true }),
  settingsRowActions: (page: Page, id: string) =>
    page.getByRole('button', { name: `Actions for ${id}`, exact: true }),
  settingsResetMenuItem: (page: Page) =>
    page.getByRole('menuitem', { name: 'Reset to default', exact: true }),
  pushSection: (page: Page) =>
    page.getByRole('region', { name: 'Push notifications', exact: true }),
  pushTurnOn: (page: Page) =>
    page.getByRole('button', { name: 'Turn on for this device', exact: true }),
  /** A drawn skeleton bar, which appears once LoadingState's delay has passed. */
  pushLoadingBar: (page: Page) =>
    page
      .getByRole('status', { name: 'Loading push devices', exact: true })
      .locator('.skeleton-sweep')
      .first(),
  pushThisDeviceOn: (page: Page) => page.getByText('This device receives push notifications.'),
  pushSessionSwitch: (page: Page) =>
    page.getByRole('switch', { name: 'Push session notifications', exact: true }),
  pushNoDevices: (page: Page) => page.getByText('No devices registered', { exact: true }),
  pushDeviceRow: (page: Page, id: string) => page.locator(`[data-push-device="${id}"]`),
  pushDeviceAction: (page: Page, id: string, name: 'Send test' | 'Remove') =>
    page.locator(`[data-push-device="${id}"]`).getByRole('button', { name, exact: true }),
  pushDeviceSent: (page: Page, id: string) =>
    page.locator(`[data-push-device="${id}"]`).getByRole('status').filter({ hasText: 'Sent' }),
  toolPaneHeader: (page: Page, title: string) =>
    page.locator('[data-workbench-tool-pane-header]').filter({ hasText: title }).first(),
  bottomPanelTabs: (page: Page) =>
    page.getByRole('tablist', { name: 'Bottom panel tabs', exact: true }),
  copyButton: (page: Page, label: string) =>
    page.getByRole('button', { name: `Copy ${label}`, exact: true }),
  copiedButton: (page: Page, label: string) =>
    page.getByRole('button', { name: `Copied ${label}`, exact: true }),
  wallpaperCards: (page: Page) =>
    page.getByRole('button', { name: /^Select .+/ }).filter({ has: page.locator('img') }),
  wallpaperCard: (page: Page, name: string) =>
    page.getByRole('button', { name: `Select ${name}`, exact: true }),
  wallpaperCatalogCard: (page: Page, theme: string, file: string) =>
    page.getByRole('button', { name: `Download and select ${theme} ${file}`, exact: true }),
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
  historyStates: (page: Page) => page.getByRole('listbox', { name: 'Versions', exact: true }),
  historyState: (page: Page, index: number) =>
    page.getByRole('listbox', { name: 'Versions', exact: true }).getByRole('option').nth(index),
  historyRestore: (page: Page) =>
    page.getByRole('button', { name: 'Use this version', exact: true }),
  comparisonRowsSelector: '.editor-diff-pane [data-editor-virtual-row]',
  selectedComparisonTabSelector: '[data-editor-tab-id][aria-selected="true"]',
  diffRows: (page: Page) => page.locator('.editor-diff-pane [data-editor-virtual-row]'),
  diffScrollerSelector: '.editor-virtualized',
  diffPanes: (page: Page) => page.locator(diffPaneSelector),
  diffExpandRows: (page: Page) => page.locator('.editor-diff-pane .editor-diff-row-expandable'),
  diffPartialNotice: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'Changed lines only.' }),
  diffLineSelectionLabel: (page: Page) =>
    page
      .getByRole('button', { name: 'Ask the agent about these lines', exact: true })
      .locator('xpath=preceding-sibling::span'),
  editorRows: (page: Page) => page.locator('.editor-virtualized-row'),
  conflictOriginalComparison: (page: Page) =>
    page.getByRole('button', { name: 'Original comparison', exact: true }),
  conflictLatestIncoming: (page: Page) =>
    page.getByRole('button', { name: 'Latest incoming', exact: true }),
  conflictReturnResolution: (page: Page) =>
    page.getByRole('button', { name: 'Resolution', exact: true }),
  markdownRenderedPane: (page: Page) => page.locator('[data-markdown-preview]'),
  editorCursorLineRow: (page: Page) => page.locator('.editor-virtualized-cursor-line-row:visible'),
  editorTabNamed: (page: Page, label: RegExp) =>
    page.locator('[data-editor-tab-path]').filter({ hasText: label }),
  workspaceEditApplyAll: (page: Page) =>
    page.getByRole('button', { name: 'Make these changes', exact: true }),
  toast: (page: Page, title: string) => page.locator('[data-sonner-toast]', { hasText: title }),
  toastDismiss: (page: Page, title: string) =>
    page
      .locator('[data-sonner-toast]', { hasText: title })
      .getByRole('button', { name: 'Close toast', exact: true }),
  /** Every element on the page whose own text contains `text`, for counting how often a message shows. */
  textAnywhere: (page: Page, text: string) => page.getByText(text),
  toastAction: (page: Page, title: string, label: string) =>
    page
      .locator('[data-sonner-toast]', { hasText: title })
      .getByRole('button', { name: label, exact: true }),

  sidebarTab: (page: Page, name: 'Files' | 'Git' | 'Search' | 'Chat') =>
    page
      .getByRole('navigation', { name: 'Sidebar tabs' })
      .getByRole('button', { name, exact: true }),
  /** Its title is the open workspace's root path. */
  projectSwitcher: (page: Page) =>
    page.getByRole('button', { name: 'Switch project', exact: true }),
  sidebarToggle: (page: Page, mode: 'Workbench' | 'Chat') =>
    page.getByRole('button', {
      name: mode === 'Workbench' ? 'Toggle sidebar' : 'Toggle sessions',
      exact: true,
    }),
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
  searchFilterToggle: (page: Page) =>
    page.getByRole('button', { name: 'Include and exclude files', exact: true }).first(),
  searchInclude: (page: Page) => page.getByLabel('Include', { exact: true }).first(),
  searchSummary: (page: Page) =>
    page
      .locator('span[title]')
      .filter({ hasText: /(?:matches|shown, limit reached) in [\d,]+ files?/ }),
  replaceBox: (page: Page) =>
    page.getByRole('textbox', { name: 'Replace in workspace', exact: true }),
  replaceToggle: (page: Page) => page.getByRole('button', { name: 'Replace', exact: true }),
  searchResults: (page: Page) => page.getByRole('region', { name: 'Search results', exact: true }),
  chatRewind: (page: Page) =>
    page.getByRole('button', { name: 'Rewind to before this message', exact: true }),
  rewindConversation: (page: Page) =>
    page.getByRole('button', { name: 'Rewind chat only', exact: true }),
  rewindFiles: (page: Page) =>
    page.getByRole('button', { name: 'Rewind chat and files', exact: true }),
  rewindDialog: (page: Page) => page.getByRole('alertdialog'),
  clientUpdateReload: (page: Page) => page.getByRole('button', { name: 'Reload app', exact: true }),
  serverUpdate: (page: Page) => page.locator('[data-server-update]'),
  serverUpdating: (page: Page) => page.locator('[data-server-update] button[aria-busy="true"]'),
  serverUpdateRetry: (page: Page) =>
    page.getByRole('button', { name: 'Retry update', exact: true }),
  serverUpdateTooltip: (page: Page) =>
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'Retry update' }),
  serverUpdateApply: (page: Page) =>
    page.locator('[data-server-update]').getByRole('button', { name: 'Update app', exact: true }),
  updatePopover: (page: Page) => page.getByRole('dialog', { name: 'Update now?' }),
  updateSession: (page: Page, title: string) =>
    page
      .getByRole('dialog', { name: 'Update now?' })
      .getByRole('listitem')
      .filter({ hasText: title }),
  updateWhenDone: (page: Page) =>
    page.getByRole('button', { name: 'Update when done', exact: true }),
  updateNow: (page: Page) => page.getByRole('button', { name: 'Update now', exact: true }),
  chatComposerFileInput: (page: Page) =>
    page
      .getByRole('button', { name: 'Attach', exact: true })
      .locator('..')
      .locator('input[type=file]'),
  chatAttachMenuItem: (page: Page, name: 'Attach files…' | 'Screenshot…') =>
    page.getByRole('menuitem', { name, exact: true }),
  chatStagedFile: (page: Page, name: string) =>
    page.getByLabel('Attachments', { exact: true }).getByText(name, { exact: true }),
  chatStagedImage: (page: Page, name: string) =>
    page
      .getByLabel('Attachments', { exact: true })
      .getByRole('button', { name: `Open ${name}`, exact: true })
      .locator('img'),
  chatTranscriptFile: (page: Page, name: string) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .getByRole('button', { name, exact: true }),
  chatFilePreview: (page: Page) => page.locator('[data-chat-file-preview]'),
  chatFileDownload: (page: Page, name: string) =>
    page.getByRole('link', { name: `Download ${name}`, exact: true }),
  chatMessage: (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true }),
  waitForChatText: (page: Page, text: string) =>
    page.waitForFunction(
      (value) => document.querySelector('[aria-label="Message"]')?.textContent?.includes(value),
      text,
    ),
  chatWelcome: (page: Page) =>
    page.getByText('Ask about your workspace', { exact: true }).locator('../..'),
  chatNewSession: (page: Page) => page.getByRole('button', { name: 'New session', exact: true }),
  chatCorrection: (page: Page) =>
    page.getByRole('button', { name: 'Send correction', exact: true }),
  chatStop: (page: Page) => page.getByRole('button', { name: 'Stop current turn', exact: true }),
  chatAttach: (page: Page) =>
    selectors.composerActions(page).getByRole('button', { name: /^Attach/ }),
  chatSend: (page: Page) => page.getByRole('button', { name: 'Send message', exact: true }),
  reviewChanges: (page: Page) =>
    page.getByRole('button', { name: 'Review changes', exact: true }).first(),
  reviewComments: (page: Page) => page.getByRole('group', { name: 'Review comments' }),
  sleepingSchedules: (page: Page) =>
    page.getByRole('button', { name: /^(Sleeping until|Wake-up due)/ }).first(),
  cancelSchedules: (page: Page) =>
    page.getByRole('button', { name: 'Cancel schedules', exact: true }),
  sessionGoal: (page: Page) => page.getByRole('button', { name: /^Goal: / }).first(),
  turnCarryOn: (page: Page) => page.getByRole('button', { name: 'Continue', exact: true }),
  turnTryAgain: (page: Page) => page.getByRole('button', { name: 'Resend message', exact: true }),
  incompleteAnswer: (page: Page) =>
    page.getByRole('group', { name: 'Incomplete answer', exact: true }),
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
    page.getByRole('button', { name: 'Move queued message back to the message box', exact: true }),
  chatTerminalContext: (page: Page) =>
    page
      .locator('form')
      .filter({ has: page.getByRole('textbox', { name: 'Message', exact: true }) })
      .locator('[data-terminal-context-source]'),
  terminalSelectAll: (page: Page) =>
    page.getByRole('menuitem', { name: 'Select All', exact: true }),
  terminalAskAgent: (page: Page) =>
    page.getByRole('menuitem', { name: 'Ask the Agent', exact: true }),
  terminalRendererRow: (page: Page) => page.getByRole('menuitem', { name: /^Renderer: / }),
  chatMessages: (page: Page) => page.getByRole('log', { name: 'Messages', exact: true }),
  chatUserMessages: (page: Page) => page.locator('[data-user-message-body]'),
  chatCodeBlockBody: (page: Page, language: string) =>
    page
      .getByRole('log', { name: 'Messages', exact: true })
      .locator(`[data-markdown="code-block"][data-language="${language}"]`)
      .locator('[data-markdown="code-block-body"]'),
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
  reasoningRows: (page: Page) => page.locator('[data-reasoning-row]'),
  reasoningRow: (page: Page, entryId: string) =>
    page.locator(`[data-reasoning-row][data-work-log-entry-id="${entryId}"]`),
  liveActivityRow: (page: Page) =>
    page.locator('[data-index]:has(> [data-timeline-row-type="live-activity"])'),
  stackFrame: (page: Page, frame: string) => page.locator(`[data-stack-frame="${frame}"]`).first(),
  activePlanTrigger: (page: Page) =>
    page.getByRole('button').filter({ has: page.getByLabel('Plan progress', { exact: true }) }),
  planSteps: (page: Page) =>
    page.getByRole('list', { name: 'Plan steps', exact: true }).locator('li'),
  agentsRow: (page: Page) =>
    page.locator('[data-timeline-row-type="agent-group"]').getByRole('button').first(),
  agentTreeChild: (page: Page, threadId: string) =>
    page.locator(`[data-agent-tree-level="child"] [data-agent-thread-id="${threadId}"]`),
  modelSwitch: (page: Page) => page.locator('[data-model-switch]').first(),
  composerActions: (page: Page) => page.locator('[data-composer-actions]'),
  draftContext: (page: Page) => page.getByRole('group', { name: 'Session workspace', exact: true }),
  draftSetup: (page: Page) => page.getByRole('button', { name: /^Session setup: / }),
  draftSetupSheet: (page: Page) => page.getByRole('menu', { name: /^Session setup: / }),
  draftSetupRow: (page: Page, label: string) =>
    page
      .getByRole('menu', { name: /^Session setup: / })
      .getByRole('menuitem', { name: new RegExp(`^${label}`) }),
  usageMeter: (page: Page) => page.locator('[data-composer-actions] [data-usage-meter]'),
  usagePopover: (page: Page) => page.locator('[data-usage-popover]'),
  usageWindowRows: (page: Page) => page.locator('[data-usage-popover] [data-account-window]'),
  usageMeterViewUsage: (page: Page) =>
    page.locator('[data-usage-popover]').getByRole('button', { name: 'View usage', exact: true }),
  accountAllowances: (page: Page) => page.locator('[data-account-allowances]'),
  allowanceAccounts: (page: Page) => page.locator('[data-account-allowances] [data-account-usage]'),
  transcriptCoverage: (page: Page) => page.locator('[data-transcript-coverage]'),
  usageSection: (page: Page) => page.locator('[data-usage-section]'),
  usageSummary: (page: Page) => page.locator('[data-usage-section] [data-usage-summary]'),
  usageModelRows: (page: Page) => page.locator('[data-usage-section] [data-usage-model]'),
  usageChartBars: (page: Page) => page.locator('[data-usage-chart] [role="listitem"]'),
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
  // The failed step also toasts, and the toast carries its own Fix with AI.
  gitFixWithAgent: (page: Page) =>
    page
      .getByRole('alert')
      .filter({ hasText: / failed/ })
      .getByRole('button', { name: 'Fix with AI', exact: true }),
  dialog: (page: Page) => page.getByRole('dialog').last(),
  dialogClose: (dialog: Locator) => dialog.getByRole('button', { name: 'Close', exact: true }),
  buttonNamed: (page: Page, label: string) =>
    page.getByRole('button', { name: label, exact: true }).first(),
  changeRequestLink: (page: Page, number: number) =>
    page.getByRole('link').filter({ hasText: new RegExp(`^#${number}$`) }),
  gitBranchChip: (page: Page, branch: string) =>
    page.locator(`span[title="${branch}"], span[title^="${branch} @ "]`),
  worktreeChip: (page: Page, worktreeId: string) =>
    page.locator(`nav[aria-label="Session"] [data-worktree-id="${worktreeId}"]`),
  autoPullStatus: (page: Page, text: string) =>
    page.getByRole('region', { name: 'Git panel' }).getByText(text, { exact: true }),
  submodulesNotice: (page: Page) =>
    page.getByRole('alert').filter({ hasText: /submodules? (is|are) not initialized/ }),
  initializeSubmodules: (page: Page) =>
    page
      .getByRole('alert')
      .filter({ hasText: /not initialized/ })
      .getByRole('button', { name: 'Initialize', exact: true }),
  filesPaneError: (page: Page) =>
    page.getByRole('status').filter({ hasText: 'Unable to load files' }),
  filesPaneLoading: (page: Page) =>
    page.getByRole('status', { name: 'Loading files', exact: true }),
  folderTreeScroll: (page: Page) =>
    page.locator(folderTreeShadowHost).locator('[data-file-tree-virtualized-scroll]'),
  folderTree: (page: Page) => page.getByLabel('Folder tree', { exact: true }),
  focusedTreeRow: (page: Page) =>
    page.getByLabel('Folder tree', { exact: true }).locator('[role="treeitem"][tabindex="0"]'),
  editorInput: (page: Page) => page.getByRole('textbox', { name: 'Editor input' }),
  writableEditorInput: (page: Page) =>
    page
      .getByRole('textbox', { name: 'Editor input' })
      .and(page.locator('[aria-readonly="false"]')),
  problemsTree: (page: Page) => page.getByRole('tree', { name: 'Problems', exact: true }),
  problemsSettled: (page: Page) =>
    page.getByText(/^(No problems reported|No diagnostics received|Diagnostics unavailable)$/),
  problemsFailedServers: (page: Page) => page.getByText(/^Not answering: /),
  problemsFiles: (page: Page) =>
    page
      .getByRole('tree', { name: 'Problems', exact: true })
      .locator('[role="treeitem"][aria-level="1"]'),
  diagnosticsRows: (page: Page) =>
    page
      .getByRole('tree', { name: 'Problems', exact: true })
      .locator('[role="treeitem"][aria-level="2"]'),
  pendingChord: (page: Page) => page.locator('[data-slot="keymap-pending"]'),
  editorSurface: (page: Page) => page.locator('.editor-virtualized-viewport'),
  editorFindInput: (page: Page) => page.getByRole('textbox', { name: 'Find', exact: true }),
  editorFindCount: (page: Page) => page.locator('.editor-find-count'),
  editorFindWidget: (page: Page) => page.locator('.editor-find-widget'),
  editorLargeFileNotice: (page: Page) => page.getByTestId('large-file-mode'),
  editorMinimap: (page: Page) => page.locator('.editor-minimap-right'),
  terminalOpening: (page: Page) => page.getByRole('status', { name: 'Opening terminal' }),
  terminalSurface: (page: Page) =>
    page.locator('[data-slot="tool-pane"][aria-label="Terminal"]:visible'),
  terminalDomRows: (page: Page) =>
    selectors.terminalSurface(page).first().locator('.ghostty-webgpu-frame [data-row]'),
  paletteRowSelector: '[data-slot="command-list"] [role="option"]',
  paletteLoading: (page: Page) => page.getByRole('status', { name: 'Loading commands' }),
  pickerLoading: (page: Page) => page.getByRole('status', { name: 'Loading file picker' }),
  paletteInput: (page: Page) => page.locator('[data-slot="command-input"]').first(),
  paletteOptions: (page: Page) => page.locator('[data-slot="command-list"]').getByRole('option'),
  selectedPaletteOption: (page: Page) => page.locator('[cmdk-item][data-selected="true"]'),
  settingsLoading: (page: Page) =>
    page.getByRole('status', { name: 'Loading settings', exact: true }),
  settingsModelsLoading: (page: Page) => page.getByRole('status', { name: 'Loading models' }),
  settingsNoModels: (page: Page) => page.getByText('No models are available yet.'),
  settingsProviderRow: (page: Page, providerInstanceId: string) =>
    page.locator(`[data-provider-instance="${providerInstanceId}"]`),
  providerUpdateChecking: (row: Locator) =>
    row.getByRole('status', { name: 'Checking for updates' }),
  paletteScriptsLoading: (page: Page) => page.getByRole('status', { name: 'Loading scripts' }),
  paletteNoScripts: (page: Page) => page.getByText('No scripts in this project.'),
  paletteDialog: (page: Page) => page.getByRole('dialog', { name: 'Command Palette', exact: true }),
  machineLiveStatus: (page: Page, label: string) =>
    page.getByRole('status', { name: `${label} live`, exact: true }),
  machineConnectionNotice: (page: Page, label: string, summary: string) =>
    page
      .getByRole('status')
      .filter({ hasText: `${label} · ${summary}` })
      .locator('..'),
  sessionPullRequestMenu: (page: Page, number: number) =>
    page.getByRole('menuitem', { name: `Open pull request #${number}`, exact: true }),
  bootstrapRetry: (page: Page) =>
    page.getByRole('button', { name: 'Retry connection', exact: true }),
  connectionRefused: (page: Page) =>
    page.getByText('Cannot connect to the server', { exact: true }),
  bootstrapFailure: (page: Page) =>
    page.getByText('Cannot connect to the local machine', { exact: true }),
  windowToolbar: (page: Page) => page.getByLabel('Window toolbar', { exact: true }),
  phoneTerminalCanvas: (page: Page) => page.locator('[data-phone-level="terminal"] canvas').first(),
  phoneFirstScreenSelector: '[data-phone-level="sessions"] section[aria-label="Sessions"]',
  desktopFirstScreenSelector: '[aria-label="Window toolbar"]',
  phoneShell: (page: Page) => page.locator('[data-phone-shell]'),
  /** The phone shell showing `level`: sessions, session, changes, file or terminal. */
  phoneLevel: (page: Page, level: string) => page.locator(`[data-phone-level="${level}"]`),
  phoneBack: (page: Page) =>
    page.locator('[data-phone-shell]').getByRole('button', { name: 'Back', exact: true }),
  phoneHeaderAction: (page: Page, name: string) =>
    page.locator('[data-phone-shell] header').getByRole('button', { name, exact: true }),
  /** The scrim under a picker the phone presents as a bottom sheet. */
  sheetBackdrop: (page: Page) => page.locator('[data-slot="sheet-backdrop"]'),
  /** The line numbers of the editor on the phone's file screen. */
  phoneDiffBand: (page: Page, type: 'addition' | 'deletion') =>
    page.locator(`[data-phone-level="file"] .editor-diff-gutter-band-${type}`),
  phoneDiffNumberLanes: (page: Page) =>
    page.locator(
      '[data-phone-level="file"] .editor-diff-gutter:not([hidden]) :is(.editor-diff-gutter-lane-old, .editor-diff-gutter-lane-new)',
    ),
  editorTab: (page: Page, path: string) => page.locator(`[data-editor-tab-path="${path}"]`),
  openReadOnly: (page: Page) => page.getByRole('button', { name: 'Open read-only', exact: true }),
  pagedContents: (page: Page) => page.getByLabel('Read-only file contents'),
  pagedNext: (page: Page) => page.getByRole('button', { name: 'Next lines', exact: true }),
  pagedLine: (page: Page) => page.getByRole('spinbutton', { name: 'Line number' }),
  pagedGo: (page: Page) => page.getByRole('button', { name: 'Go to line', exact: true }),
  pagedCopy: (page: Page) => page.getByRole('button', { name: 'Copy displayed text', exact: true }),
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
  statusFrame: (page: Page, tone: 'pending' | 'error') =>
    page.locator(`[data-slot="status-frame"][data-tone="${tone}"]`),
  statusFrameBody: (page: Page) => page.locator('[data-slot="status-frame"] > div'),
  valueGridRow: (page: Page, label: string) =>
    page
      .locator('[data-slot="value-grid-row"]')
      .filter({ has: page.getByRole('term').getByText(label, { exact: true }) }),
  tailJump: (page: Page) => page.locator('[data-slot="tail-jump-button"]'),
  holdButton: (scope: Locator, name: string) =>
    scope.locator('[data-slot="hold-button"]').filter({ hasText: name }),
  tabsIndicator: (page: Page, list: string) =>
    page.getByRole('tablist', { name: list, exact: true }).locator('[data-slot="tabs-indicator"]'),
  gitDiscardDialog: (page: Page, title: string) =>
    page.getByRole('alertdialog', { name: title, exact: true }),
  unexpectedError: (page: Page) => page.getByText('Something unexpected went wrong.'),
  focusGitCommand: (page: Page) => page.getByRole('option', { name: /Focus Git/ }),
  graphButton: (page: Page) => page.getByRole('tab', { name: 'Graph', exact: true }),
  // The Changes tab's accessible name carries its live file count.
  gitChangesTab: (page: Page) =>
    page.getByRole('region', { name: 'Git panel' }).getByRole('tab', { name: /^Changes\b/ }),
  changesToggle: (page: Page) => page.getByRole('button', { name: 'Changes', exact: true }),
  gitDiffScope: (page: Page, scope: 'Working tree' | 'Turn') =>
    page
      .getByRole('tablist', { name: 'Diff scope' })
      .getByRole('tab', { name: scope, exact: true }),
  turnHunkSelector: '[aria-label="Turn changed files"] [data-turn-hunk]',
  turnFilesHeaderSelector: 'div:has(> [aria-label="Turn changed files"]) > p',
  branchActionSelector: '[data-branch-actions] button',
  branchPush: (page: Page, count: number) =>
    page.getByRole('button', { name: `Push ${count}`, exact: true }),
  turnFiles: (page: Page) => page.getByRole('tree', { name: 'Turn changed files' }),
  worktreeFileRowSelector: '[data-git-file]:not([data-history-file])',
  worktreeFiles: (page: Page) => page.locator('[data-git-file]:not([data-history-file])'),
  historyList: (page: Page) => page.getByRole('listbox', { name: 'Commit history' }),
  historyRowSelector: '[data-history-commit]',
  historyDetailsFrameSampler: `() => {
    const details = document.querySelector('[aria-label="Commit details"]')
    return {
      hash: details?.querySelector('[aria-label="Commit information"]')?.getAttribute('title'),
      subject: details?.querySelector('p')?.textContent,
    }
  }`,
  logRowSelector: '[data-log-row-summary]',
  chatReconnecting: (page: Page) => page.getByText('Reconnecting chat…', { exact: true }),
  conversationTitle: (page: Page, title: string) =>
    page
      .getByRole('navigation', { name: 'Session', exact: true })
      .getByRole('heading', { name: title, exact: true })
      .or(page.locator('[data-workbench-tool-pane-header]').getByTitle(title, { exact: true })),
  conversationHistory: (page: Page) =>
    page.getByRole('button', { name: 'Conversation history', exact: true }),
  conversationChoice: (page: Page, title: string) =>
    page.getByRole('menuitem').filter({ hasText: title }),
  conversationTitleSelector:
    'nav[aria-label="Session"] h1, [data-workbench-tool-pane-header] > div[title] > .truncate',
  conversationLoadingSelector:
    '[data-slot="tool-pane-header"] [data-slot="spinner"][aria-label="Loading conversation"]',
  chatAssistantMarkdown: (page: Page) =>
    page.locator(
      `${chatMessagesLogSelector} article:not(:has([data-user-message-body])) [data-chat-markdown]`,
    ),
  /** Every rendered markdown body in the chat timeline, including user messages. */
  chatMarkdownSelector: '[role="log"][aria-label="Messages"] [data-chat-markdown]',
  chatCodeBlockSelector: '[data-markdown="code-block"]',
  logCopyButtons: (page: Page) => page.getByRole('button', { name: 'Copy log event', exact: true }),
  logCleared: (page: Page) => page.getByText('Visible logs cleared.', { exact: true }),
  logRows: (page: Page) => page.locator('[data-log-row-summary]'),
  logsModuleSpinnerSelector: '[aria-label="Opening logs"]',
  logsSearch: (page: Page) => page.getByRole('textbox', { name: 'Search logs' }),
  logsTab: (page: Page) => page.getByRole('button', { name: 'Logs', exact: true }),
  renderErrorState: (page: Page) =>
    page.locator('[data-slot="empty-state"]').filter({ hasText: 'could not be shown' }),
  renderErrorRetry: (page: Page) =>
    page
      .locator('[data-slot="empty-state"]')
      .filter({ hasText: 'could not be shown' })
      .getByRole('button', { name: 'Retry' }),
  historyRows: (page: Page) => page.locator('[data-history-commit]'),
  historyCircles: (page: Page) => page.locator('[data-history-commit] svg circle'),
  historyFileSelector: '[data-history-file]',
  historyFiles: (page: Page) => page.locator('[data-history-file]'),
  historyDetails: (page: Page) => page.getByRole('region', { name: 'Commit details' }),
  historyInformation: (page: Page) =>
    page.getByRole('button', { name: 'Commit information', exact: true }),
  historyInformationFor: (page: Page, commit: string) =>
    page.locator('[aria-label="Commit information"]').and(page.locator(`[title="${commit}"]`)),
  historyCopyMessage: (page: Page) =>
    page.getByRole('button', { name: 'Copy message', exact: true }),
  treeFilterInput: (page: Page) => page.getByRole('textbox', { name: 'Filter files', exact: true }),
  treeFilterClear: (page: Page) =>
    page.getByRole('button', { name: 'Clear file filter', exact: true }),
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
  commandPalette: 'ControlOrMeta+Shift+P',
  settings: 'ControlOrMeta+,',
  togglePanel: 'ControlOrMeta+J',
  nextItem: 'ControlOrMeta+Alt+BracketRight',
  toggleSidebar: 'ControlOrMeta+B',
}

export async function pressShortcut(page: Page, chord: string) {
  // Playwright resolves ControlOrMeta from the host; the app resolves Mod from the browser.
  const platform = await page.evaluate(detectPlatform)
  const modifier = platform === 'mac' ? 'Meta' : 'Control'
  await page.keyboard.press(chord.replace(/\b(?:ControlOrMeta|Mod)\b/g, modifier))
}

export async function waitForSessionWorkspace(
  page: Page,
  sessionId: string,
  canonicalPath: string,
  environmentId: string,
) {
  await page.waitForFunction(
    ({ composerSelector, switcherSelector, expectedNamespace, rootPath }) => {
      const title = document.querySelector(switcherSelector)?.getAttribute('title')
      const composer = document.querySelector(composerSelector) as
        | (HTMLElement & { __lexicalEditor?: { _config: { namespace: string } } })
        | null
      // Lexical's rendered owner can lag the session URL during a workspace switch.
      const namespace = composer?.__lexicalEditor?._config.namespace
      const workspaceReady = title === rootPath || title?.startsWith(`${rootPath} ·`)
      return workspaceReady && namespace === expectedNamespace
    },
    {
      composerSelector: chatComposerSelector,
      switcherSelector: projectSwitcherSelector,
      expectedNamespace: `platform-chat-input:${environmentId}:${canonicalPath.replace(/^\/+/, '')}:${sessionId}`,
      rootPath: canonicalPath.replace(/^\/+/, ''),
    },
  )
}

export async function waitForApp(page: Page, timeoutMs = 45_000) {
  // The phone shell carries no window toolbar; its stack frame is its first paint.
  await selectors
    .windowToolbar(page)
    .or(selectors.phoneShell(page))
    .first()
    .waitFor({ timeout: timeoutMs })
}

export async function waitForInitialContent(page: Page) {
  const timeoutMs = 1_500
  const cap = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => cap.resolve(false), timeoutMs)
  const ready = page
    .waitForFunction(initialContentReady, undefined, { timeout: timeoutMs })
    .then(async () => {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      return page.evaluate(initialContentReady)
    })
  return Promise.race([ready, cap.promise]).finally(() => clearTimeout(timer))
}

function initialContentReady() {
  const shell = document.querySelector('[aria-label="Window toolbar"], [data-phone-shell]')
  const surface = shell?.closest('[aria-busy]')
  return (
    surface?.getAttribute('aria-busy') === 'false' && !document.querySelector('[aria-busy="true"]')
  )
}

export async function openGitPanel(page: Page) {
  await pressShortcut(page, chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill('>Focus Git')
  await selectors.focusGitCommand(page).first().click()
  await selectors.gitPanel(page).waitFor({ timeout: 15_000 })
}

/** Holds a hold-to-confirm button until `done` resolves, the way a user keeps the mouse down. */
export async function holdToConfirm(page: Page, button: Locator, done: () => Promise<unknown>) {
  await button.hover()
  await page.mouse.down()
  try {
    await done()
  } finally {
    await page.mouse.up()
  }
}

export async function focusEditor(page: Page) {
  await selectors.editorSurface(page).first().click()
  await selectors.editorInput(page).first().focus()
}

/** Right-clicks the middle of the first visible occurrence of `word` in any editor's text. */
export async function rightClickEditorWord(page: Page, word: string) {
  const point = await page.evaluate((target) => {
    for (const surface of document.querySelectorAll('.editor-virtualized-viewport')) {
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent?.indexOf(target) ?? -1
        if (index < 0) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + target.length)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        // A kept-alive editor for another tab holds text too, under whatever is on top.
        if (!surface.contains(document.elementFromPoint(x, y))) continue
        return { x, y }
      }
    }
    return null
  }, word)
  if (!point) throw createScriptError(`"${word}" is not on a visible editor row`)
  await page.mouse.click(point.x, point.y, { button: 'right' })
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
  await pressShortcut(page, chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(name)
  // Enter opens the selected row: a row of the previous query until this query's results land.
  const basename = name.split('/').at(-1) ?? name
  await selectors
    .selectedPaletteOption(page)
    .filter({ hasText: basename })
    .waitFor({ timeout: 15_000 })
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
  await pressShortcut(page, chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(`>${title}`)
  await selectors.commandOption(page, title).first().click({ timeout: 5_000 })
}

export async function chooseColorMode(page: Page, value: 'light' | 'dark' | 'system') {
  await pressShortcut(page, chords.commandPalette)
  await selectors.paletteInput(page).fill('>Choose light / dark mode')
  await selectors.commandOption(page, 'Choose light / dark mode').click()
  await selectors.colorModeOption(page, value).click()
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
}

/**
 * Waits for the page's running, finite animations (tab indicators, fades, view transitions),
 * capped at a second. Looping spinners and paused animations are left alone.
 */
export async function settleRunningAnimations(page: Page, capMs = 1_000) {
  const cap = Promise.withResolvers<void>()
  const timer = setTimeout(cap.resolve, capMs)
  await Promise.race([
    page.evaluate(async () => {
      const finite = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    }),
    cap.promise,
  ]).finally(() => clearTimeout(timer))
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
        // Scroll-driven animations (`scroll-fade`) follow the scroll position and never finish.
        .filter((animation) => animation.timeline instanceof DocumentTimeline)
        // A toast can be dismissed mid-animation; a cancelled one is settled, not a failure.
        .map((animation) => animation.finished.catch(() => undefined)),
    )
  })
}

export const provisionalTokenSelector = '[data-editor-provisional-row] span[style*="color"]'

/** The colors the shared-token CSS highlights actually paint on an element. */
export function paintedTokenColors(target: Locator): Promise<string[]> {
  return target.evaluate((element) =>
    Array.from(CSS.highlights.entries())
      .filter(([name, highlight]) => name.startsWith('editor-shared-token-') && highlight.size > 0)
      .map(([name]) => getComputedStyle(element, `::highlight(${name})`).color),
  )
}

/** Opens the palette's code theme picker and lists its theme ids in order. */
export async function codeThemePickerIds(page: Page): Promise<string[]> {
  await pressShortcut(page, chords.commandPalette)
  await selectors.paletteInput(page).fill('code ')
  const rows = selectors.codeThemeOptions(page)
  await rows.first().waitFor()
  const values = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-value') ?? ''),
  )
  return values.map((value) => value.slice('color-theme:'.length))
}

/**
 * Each painted token's text and colour, with editor variables resolved. `getComputedStyle(el,
 * '::highlight(x)')` leaves a `var()` colour unresolved in Chromium, so each active rule's colour is
 * resolved on a probe inside the editor, where the theme's variables are in scope.
 */
export function paintedTokenWords(target: Locator): Promise<[string, string][]> {
  return target.evaluate((element) => {
    const sheets = [...document.styleSheets, ...document.adoptedStyleSheets]
    const rules = sheets.flatMap((sheet) => {
      try {
        return [...sheet.cssRules]
      } catch {
        return []
      }
    })
    const probe = document.createElement('span')
    element.append(probe)
    const words: [string, string][] = []
    for (const [name, highlight] of CSS.highlights.entries()) {
      if (!name.startsWith('editor-shared-token-') || highlight.size === 0) continue
      const rule = rules.find(
        (candidate): candidate is CSSStyleRule =>
          candidate instanceof CSSStyleRule && candidate.selectorText.includes(`(${name})`),
      )
      const color = rule?.style.getPropertyValue('color')
      if (!color) continue
      probe.style.color = color
      const resolved = getComputedStyle(probe).color
      for (const painted of highlight) {
        // The editor paints with StaticRanges, which carry no text of their own.
        const range = document.createRange()
        range.setStart(painted.startContainer, painted.startOffset)
        range.setEnd(painted.endContainer, painted.endOffset)
        words.push([range.toString().trim(), resolved])
      }
    }
    probe.remove()
    return words
  })
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

/**
 * The fenced block in the shared hover whose text includes `text`, once painted: whether its code
 * holds a CR, and the text of each span that carries a colour.
 */
export async function hoverCodePaint(page: Page, text: string) {
  const code = selectors.editorHover(page).locator('pre > code[data-language]', { hasText: text })
  await code.locator('span[style]').first().waitFor({ timeout: 8000 })
  return code.evaluate((element) => ({
    carriageReturn: (element.textContent ?? '').includes('\r'),
    coloured: [...element.querySelectorAll('span[style]')]
      .filter((span) => /(^|;)\s*color:/.test(span.getAttribute('style') ?? ''))
      .map((span) => span.textContent ?? ''),
  }))
}

/** Rests the pointer on the first on-screen occurrence of the word, under `within`, until the hover shows. */
/**
 * The centre of `part` where it first appears inside `context` on screen, under `within`. The
 * context picks one occurrence of a word that appears on several lines.
 */
export async function textPoint(page: Page, context: string, part = context, within = 'body') {
  // A string: this package types without the DOM, and the callback runs in the page.
  return (await page.evaluate(`((needle, part, root) => {
    const walker = document.createTreeWalker(document.querySelector(root) ?? document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index < 0) continue
      const start = index + needle.indexOf(part)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + part.length)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) continue
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    throw new Error(needle + ' is not on screen')
  })(${JSON.stringify(context)}, ${JSON.stringify(part)}, ${JSON.stringify(within)})`)) as {
    x: number
    y: number
  }
}

export async function hoverWord(page: Page, word: string, within = 'body') {
  const point = await textPoint(page, word, word, within)
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

/** Layers an editor row draws beside its text; a row's text is what remains without them. */
export const EDITOR_ROW_LAYERS =
  '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,' +
  '.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row'

/** Page-side: the window of text the focused editor input holds, textarea or EditContext host. */
export function focusedEditorInputText(): string {
  const input = document.activeElement as
    | (HTMLElement & { value?: string; editContext?: { text: string } | null })
    | null
  return input?.editContext?.text ?? input?.value ?? ''
}

/** Page-side: the focused input's text before the caret, as a screen reader is shown it. */
export function focusedEditorTextBeforeCaret(): string {
  const input = document.activeElement
  if (input instanceof HTMLTextAreaElement) return input.value.slice(0, input.selectionStart)
  const selection = document.getSelection()
  if (!input || selection?.anchorNode !== input.firstChild) return ''
  return (input.textContent ?? '').slice(0, selection.anchorOffset)
}

/** Actual colored highlight ranges, including syntax twins and untokenized overlay ranges. */
export async function diagnosticTagPaint(page: Page, kind: 'fade' | 'strike') {
  return page.evaluate(`((kind) => {
    const styles = new Map()
    const visit = rules => {
      for (const rule of rules) {
        if (rule.cssRules) visit(rule.cssRules)
        const name = rule.selectorText?.match(/::highlight\\(([^)]+)\\)/)?.[1]
        if (name) styles.set(name, rule.style)
      }
    }
    for (const sheet of document.styleSheets) visit(sheet.cssRules)
    const painted = []
    for (const [name, highlight] of CSS.highlights) {
      const style = styles.get(name)
      if (!style) continue
      const matches = kind === 'strike' ? style.textDecoration.includes('line-through') : style.color.includes('color-mix') && style.color.includes('transparent')
      if (!matches) continue
      for (const range of highlight) {
        const live = document.createRange()
        live.setStart(range.startContainer, range.startOffset)
        live.setEnd(range.endContainer, range.endOffset)
        painted.push({ text: live.toString(), color: style.color, decoration: style.textDecoration })
      }
    }
    return painted
  })(${JSON.stringify(kind)})`) as Promise<{ text: string; color: string; decoration: string }[]>
}

/** Page-side: selected source text in the focused editor's input window. */
export function focusedEditorSelectedText(): string {
  const input = document.activeElement as
    | (HTMLElement & {
        editContext?: { text: string; selectionStart: number; selectionEnd: number } | null
      })
    | null
  if (input instanceof HTMLTextAreaElement)
    return input.value.slice(input.selectionStart, input.selectionEnd)
  const context = input?.editContext
  if (context) return context.text.slice(context.selectionStart, context.selectionEnd)
  return document.getSelection()?.toString() ?? ''
}

export const ghosttySiteSelectors = {
  examples: '.example',
  factLead: '.facts strong',
  sectionHeadings: '.measured h2, .preview h2',
  backend: '#backend',
  canvas: 'canvas',
  composition: '.ghostty-webgpu-composition',
  pty: '.pty-example',
  preview: '.preview',
  screen: '.screen',
  stat: '#stat',
  window: '#window',
} as const

export const nativeHostSelectors = {
  settledPickerError: `Promise.all(Array.from(document.querySelectorAll('[data-sonner-toast]')).flatMap(toast => toast.getAnimations({subtree:true})).map(animation => animation.finished.catch(() => {}))).then(() => true)`,
  openProjectMenu: `document.querySelector('button[aria-label="Switch project"]')?.click()`,
  openFolderMenu: `Array.from(document.querySelectorAll('[role="menuitem"]')).find(row => row.textContent?.trim() === 'Open folder…')?.click()`,
  pickerError: `document.body.innerText.includes('The file chooser closed after its time limit.')`,
  bridgeFacts: `({picker:typeof globalThis.platformBridge?.pickEntry,capture:globalThis.platformBridge?.capabilities?.displayCapture,titlebar:globalThis.platformBridge?.titlebar})`,
  readiness: `({ready:Boolean(document.querySelector('[aria-label="Window toolbar"]') && document.querySelector('[aria-label="Folder tree"] [role="treeitem"][aria-label="a.txt"]')),picker:typeof globalThis.platformBridge?.pickEntry,capture:globalThis.platformBridge?.capabilities?.displayCapture})`,
} as const

type FilePreviewFiber = {
  return: FilePreviewFiber | null
  memoizedProps: Record<string, unknown>
  child: FilePreviewFiber | null
  sibling: FilePreviewFiber | null
  stateNode?: { current: FilePreviewFiber } | Element
}
type FilePreviewRead =
  | {
      kind: 'live'
      scope: { environmentId: string; rootPath: string }
      key: string
      buffer: EditorTextBuffer
      revision: number
      snapshot: DocumentTextSnapshot
      text: string
      maxBytes: number
      utf8Bytes: number
      complete: boolean
    }
  | {
      kind: 'disk'
      input: {
        origin: string
        maxBytes: number
        reader: TextSnapshot
        head: { content: string; path: string; truncated: boolean }
      }
    }
  | { kind: 'released' | 'unavailable'; reason: string }
type FilePreviewLease = { read(): FilePreviewRead }
type FilePreviewController = {
  getEditor(): Editor | null
  getSnapshot(): { geometryCommitted?: boolean } | null
}
type FilePreviewDocument = {
  key: string
  buffer: EditorTextBuffer
  target: { kind: string; resource?: { path: string } }
  sync: { kind: string }
}
export type FilePreviewFrame = {
  element: Element
  ownerDocument: Document
  root: { current: FilePreviewFiber }
  runtime: {
    documentStore: {
      getState(): {
        previewScope: { environmentId: string; rootPath: string } | null
        previewSources: ReadonlyMap<FilePreviewLease, FilePreviewRead>
        liveDocumentsByKey: Readonly<Record<string, FilePreviewDocument>>
        viewsByTabId: Readonly<Record<string, { tabId: string; documentKey: string; view: object }>>
      }
    }
    uiStore: { getState(): { controllersByTabId: ReadonlyMap<string, FilePreviewController> } }
    previewSource: { queryClient: object; store: object; origin: string }
    queryClient: object
    storage: { environmentId: string }
  }
  read: Extract<FilePreviewRead, { kind: 'live' | 'disk' }>
  lease: FilePreviewLease | null
  name: string
  controller: FilePreviewController | null
  native: Editor | null
  view: object | null
}

export function captureFilePreviewFrame(element: Element): FilePreviewFrame | null {
  const isRuntime = (value: unknown): value is FilePreviewFrame['runtime'] => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('documentStore' in value) ||
      !('uiStore' in value) ||
      !('previewSource' in value)
    )
      return false
    const docs = value.documentStore
    const ui = value.uiStore
    if (
      !docs ||
      typeof docs !== 'object' ||
      !('getState' in docs) ||
      typeof docs.getState !== 'function'
    )
      return false
    if (!ui || typeof ui !== 'object' || !('getState' in ui) || typeof ui.getState !== 'function')
      return false
    const state: unknown = docs.getState()
    const views: unknown = ui.getState()
    return Boolean(
      state &&
      typeof state === 'object' &&
      'previewSources' in state &&
      state.previewSources instanceof Map &&
      views &&
      typeof views === 'object' &&
      'controllersByTabId' in views &&
      views.controllersByTabId instanceof Map,
    )
  }
  const isRead = (value: unknown): value is FilePreviewFrame['read'] => {
    if (!value || typeof value !== 'object' || !('kind' in value)) return false
    if (value.kind === 'live')
      return (
        'buffer' in value &&
        'snapshot' in value &&
        'scope' in value &&
        'text' in value &&
        typeof value.text === 'string'
      )
    return (
      value.kind === 'disk' &&
      'input' in value &&
      Boolean(
        value.input &&
        typeof value.input === 'object' &&
        'reader' in value.input &&
        'head' in value.input,
      )
    )
  }
  let host: Element | null = element
  let anchor: Element | null = null
  let cursor: FilePreviewFiber | null = null
  for (; host && !cursor; host = host.parentElement) {
    const key = Object.getOwnPropertyNames(host).find((name) => name.startsWith('__reactFiber$'))
    if (key) {
      cursor = Reflect.get(host, key)
      anchor = host
    }
  }
  let top = cursor
  while (top?.return) top = top.return
  const root = top?.stateNode
  if (!root || !('current' in root)) return null
  const pending = [root.current]
  cursor = null
  while (pending.length) {
    const current = pending.pop()
    if (!current) continue
    if (current.stateNode === anchor) {
      cursor = current
      break
    }
    if (current.child) pending.push(current.child)
    if (current.sibling) pending.push(current.sibling)
  }
  let runtime: FilePreviewFrame['runtime'] | null = null
  let read: FilePreviewFrame['read'] | null = null
  let name = ''
  while (cursor) {
    const props = cursor.memoizedProps
    if (isRead(props?.read) && typeof props.name === 'string') {
      read = props.read
      name = props.name
    }
    if (isRuntime(props?.runtime)) runtime = props.runtime
    if (!cursor.return) break
    cursor = cursor.return
  }
  if (!runtime || !read) return null
  const state = runtime.documentStore.getState()
  const lease =
    Array.from(state.previewSources).find(([, candidate]) => candidate === read)?.[0] ?? null
  const view =
    read.kind === 'live'
      ? Object.values(state.viewsByTabId).find((candidate) => candidate.documentKey === read.key)
      : null
  const controller = view
    ? (runtime.uiStore.getState().controllersByTabId.get(view.tabId) ?? null)
    : null
  return {
    element,
    ownerDocument: element.ownerDocument,
    root,
    runtime,
    read,
    lease,
    name,
    controller,
    native: controller?.getEditor() ?? null,
    view: view?.view ?? null,
  }
}

export function filePreviewFrameFacts(frame: FilePreviewFrame | null) {
  if (!frame) return null
  const current = frame.lease?.read() ?? frame.read
  const state = frame.runtime.documentStore.getState()
  const native = frame.native
  const input = native?.getInputElement() ?? null
  const captured = native?.captureSnapshot() ?? null
  const paint = captured ? JSON.parse(captured.paint) : null
  const box = frame.element.closest('[data-file-preview]')?.getBoundingClientRect()
  const nativeBox = input?.closest('.editor-virtualized')?.getBoundingClientRect()
  return {
    name: frame.name,
    kind: current.kind,
    capturedKind: frame.read.kind,
    interestCount: state.previewSources.size,
    leasePresent: frame.lease !== null && state.previewSources.has(frame.lease),
    exactReadInStore: frame.lease !== null && state.previewSources.get(frame.lease) === current,
    scope: state.previewScope,
    environmentId: frame.runtime.storage.environmentId,
    sourceClientMatches: frame.runtime.previewSource.queryClient === frame.runtime.queryClient,
    sourceStoreMatches: frame.runtime.previewSource.store === frame.runtime.documentStore,
    origin: frame.runtime.previewSource.origin,
    projectionHasNativeInput:
      frame.element.closest('[data-file-preview]')?.querySelector('[aria-label="Editor input"]') !==
      null,
    prefix:
      current.kind === 'live'
        ? current.text.slice(0, 128)
        : current.kind === 'disk'
          ? current.input.head.content.slice(0, 128)
          : null,
    capturedPrefix:
      frame.read.kind === 'live'
        ? frame.read.text.slice(0, 128)
        : frame.read.input.head.content.slice(0, 128),
    capturedSnapshotPrefix:
      frame.read.kind === 'live'
        ? frame.read.snapshot.readRange(0, Math.min(128, frame.read.snapshot.length))
        : frame.read.input.reader.readRange(0, Math.min(128, frame.read.input.reader.length)),
    revision: current.kind === 'live' ? current.revision : null,
    currentBufferRevision: frame.read.kind === 'live' ? frame.read.buffer.getRevision() : null,
    currentSnapshotMatches:
      current.kind === 'live' ? current.snapshot === current.buffer.getTextSnapshot() : null,
    currentBufferMatches:
      current.kind === 'live' && frame.read.kind === 'live'
        ? current.buffer === frame.read.buffer
        : null,
    maxBytes:
      current.kind === 'live'
        ? current.maxBytes
        : current.kind === 'disk'
          ? current.input.maxBytes
          : null,
    utf8Bytes: current.kind === 'live' ? current.utf8Bytes : null,
    complete:
      current.kind === 'live'
        ? current.complete
        : current.kind === 'disk'
          ? !current.input.head.truncated
          : null,
    snapshotLength:
      frame.read.kind === 'live' ? frame.read.snapshot.length : frame.read.input.reader.length,
    dirty: frame.read.kind === 'live' ? frame.read.buffer.isDirty() : null,
    canUndo: frame.read.kind === 'live' ? frame.read.buffer.canUndo() : null,
    nativeBufferMatches:
      frame.read.kind === 'live' ? native?.getBufferSession()?.buffer === frame.read.buffer : null,
    editability: native?.getState().editability ?? null,
    nativeInputConnected: input?.isConnected ?? null,
    sameDocument: input ? input.ownerDocument === frame.ownerDocument : null,
    geometryCommitted: frame.controller?.getSnapshot()?.geometryCommitted ?? null,
    selections: native?.getSelections() ?? null,
    scroll: native?.getScrollPosition() ?? null,
    nativeCapture: captured,
    paintWidth: paint?.viewportWidth ?? null,
    paintHeight: paint?.viewportHeight ?? null,
    paintRows: paint?.rows?.length ?? null,
    box: box ? { width: box.width, height: box.height } : null,
    nativeBox: nativeBox ? { width: nativeBox.width, height: nativeBox.height } : null,
  }
}

export function filePreviewIdentityFacts(
  current: FilePreviewFrame | null,
  initial: FilePreviewFrame | null,
) {
  if (!current || !initial || current.read.kind !== 'live' || initial.read.kind !== 'live')
    return null
  return {
    sameBuffer: current.read.buffer === initial.read.buffer,
    sameNative: initial.native !== null && current.native === initial.native,
    sameView: initial.view !== null && current.view === initial.view,
    sameController: initial.controller !== null && current.controller === initial.controller,
    sameRuntime: current.runtime === initial.runtime,
    sameRoot: current.root === initial.root,
    sameDocument: current.ownerDocument === initial.ownerDocument,
    sameKey: current.read.key === initial.read.key,
    initialNativeBufferMatches: initial.native?.getBufferSession()?.buffer === initial.read.buffer,
    currentNativeBufferMatches: current.native?.getBufferSession()?.buffer === initial.read.buffer,
    controllerRetainsInitialNative: initial.controller?.getEditor() === initial.native,
    controllerRetainsCurrentNative: current.controller?.getEditor() === current.native,
  }
}
