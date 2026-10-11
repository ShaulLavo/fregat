import type {
  EditorTouchSelectionAnchor,
  EditorPlugin,
  EditorTouchSelectionEvent,
  EditorViewContributionContext,
} from '@singapore-editor/core/extensions'
import { TouchSelectionMenu, type TouchMenuItem } from './touchSelectionMenu'
import { TOUCH_SELECTION_STYLES } from './touchSelectionStyles'

export type TouchSelectionMenuContext = {
  readonly selectedText: string
  readonly editable: boolean
}

export type TouchSelectionPluginOptions = {
  readonly items?: (context: TouchSelectionMenuContext) => readonly TouchMenuItem[]
  /** Light selection and menu feedback on devices exposing a supported haptic mechanism. */
  readonly haptics?: boolean
}

export type { TouchMenuItem } from './touchSelectionMenu'

/** Optional touch chrome. The core's touch gestures and selections work independently. */
export function createTouchSelectionPlugin(
  options: TouchSelectionPluginOptions = {},
): EditorPlugin {
  return {
    name: 'editor.touchSelection',
    activate: (plugin) =>
      plugin.registerViewContribution({
        createContribution: (context) => createTouchSelectionContribution(context, options),
      }),
  }
}

function createTouchSelectionContribution(
  context: EditorViewContributionContext,
  options: TouchSelectionPluginOptions,
) {
  const document = context.scrollElement.ownerDocument
  const style = document.createElement('style')
  style.dataset.editorTouchMenu = ''
  style.textContent = TOUCH_SELECTION_STYLES
  document.head.append(style)
  const menu = new TouchSelectionMenu(
    context.scrollElement,
    () => menuItems(context, options, showMenu),
    () => context.getTouchSelectionAnchor(),
    options.haptics ?? false,
  )
  const haptics = createTouchHaptics(context, options.haptics ?? false)
  let snap: string | null = null
  let lastAnchor: EditorTouchSelectionAnchor | null = null
  function showMenu() {
    const anchor = context.getTouchSelectionAnchor() ?? lastAnchor
    if (!anchor) return
    menu.show(anchor.x, anchor.y, anchor.bottom)
    haptics.tick()
  }
  const subscription = context.onDidTouchSelection((event: EditorTouchSelectionEvent) => {
    if (event.phase === 'cancel') {
      menu.hide()
      snap = null
      lastAnchor = null
      return
    }
    lastAnchor = event.anchor
    const selection = event.selections[0]
    const next = selection ? `${selection.anchorOffset}:${selection.headOffset}` : null
    if (event.phase === 'start' || (event.phase === 'update' && next !== snap)) haptics.tick()
    snap = next
    if (event.phase === 'end') showMenu()
  })
  return {
    inputs: [] as const,
    update: () => menu.hide(),
    dispose: () => {
      subscription.dispose()
      menu.dispose()
      style.remove()
    },
  }
}

function menuItems(
  context: EditorViewContributionContext,
  options: TouchSelectionPluginOptions,
  showMenu: () => void,
): readonly TouchMenuItem[] {
  const state = context.getInputCommandState()
  const clipboard = context.scrollElement.ownerDocument.defaultView?.navigator.clipboard
  const failureMessage = 'Clipboard access is required. Allow access and try again.'
  const items: TouchMenuItem[] = [
    {
      id: 'cut',
      label: 'Cut',
      disabled: !state.editable || !clipboard?.writeText,
      failureMessage,
      run: () => context.runInputCommand('cut'),
    },
    {
      id: 'copy',
      label: 'Copy',
      disabled: !clipboard?.writeText,
      failureMessage,
      run: () => context.runInputCommand('copy'),
    },
    {
      id: 'paste',
      label: 'Paste',
      disabled: !state.editable || !clipboard?.readText,
      failureMessage,
      run: () => context.runInputCommand('paste'),
    },
    {
      id: 'selectAll',
      label: 'Select all',
      run: () => {
        context.runInputCommand('selectAll')
        showMenu()
      },
    },
  ]
  for (const command of ['undo', 'redo'] as const) {
    const available = command === 'undo' ? state.canUndo : state.canRedo
    if (!state.editable || !available) continue
    items.push({
      id: command,
      label: command === 'undo' ? 'Undo' : 'Redo',
      run: () => context.runInputCommand(command),
    })
  }
  return items.concat(
    options.items?.({ selectedText: context.getSelectedText(), editable: state.editable }) ?? [],
  )
}

export function createTouchHaptics(
  context: Pick<EditorViewContributionContext, 'scrollElement'>,
  enabled: boolean,
): { tick(): void } {
  const navigator = context.scrollElement.ownerDocument.defaultView?.navigator
  return {
    tick: () => {
      if (!enabled || !navigator?.vibrate) return
      // See browser-quirks.md#touch-haptic-availability for unsupported iOS gesture-time ticks.
      navigator.vibrate(8)
    },
  }
}
