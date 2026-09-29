type EditorInputPhase =
  | 'idle'
  | 'composing'
  | 'beforeinput-pending'
  | 'native-input-observed'
  | 'transaction-committed'
  | 'selection-reconciled'

type EditorInputSelectionOwner = 'dom' | 'hidden-input' | 'session'
type EditorHiddenInputValueOwner = 'browser' | 'editor'
type EditorPendingTextSource = 'beforeinput' | 'composition' | 'deduced' | 'paste' | 'drop'

export type EditorInputState = {
  readonly phase: EditorInputPhase
  readonly selectionOwner: EditorInputSelectionOwner
  readonly hiddenInputValueOwner: EditorHiddenInputValueOwner
  readonly pendingText: string
  readonly pendingTextSource: EditorPendingTextSource | null
  readonly compositionActive: boolean
  readonly compositionCommitted: boolean
  readonly compositionText: string
  readonly mouseSelectionActive: boolean
}

export type EditorInputStateOwnership = {
  readonly domSelection: 'browser' | 'editor'
  readonly sessionSelection: 'document-session'
  readonly hiddenInputValue: EditorHiddenInputValueOwner
  readonly pendingText: 'none' | 'state-machine'
}

export type EditorInputStateTransition =
  | { readonly type: 'composition-start' }
  | { readonly type: 'composition-update'; readonly text: string }
  | { readonly type: 'composition-pending'; readonly text: string }
  | { readonly type: 'composition-end' }
  | { readonly type: 'beforeinput-pending'; readonly text?: string }
  | { readonly type: 'deduced-input-pending'; readonly text: string }
  | { readonly type: 'paste-pending'; readonly text: string }
  | { readonly type: 'drop-pending'; readonly text: string }
  | { readonly type: 'native-input-observed' }
  | { readonly type: 'transaction-committed' }
  | { readonly type: 'selection-reconciled'; readonly owner: EditorInputSelectionOwner }
  | { readonly type: 'selection-owned-by-dom' }
  | { readonly type: 'selection-owned-by-hidden-input' }
  | { readonly type: 'selection-owned-by-session' }
  | { readonly type: 'mouse-selection-start' }
  | { readonly type: 'mouse-selection-finish' }
  | { readonly type: 'mouse-selection-cancel' }
  | { readonly type: 'hidden-input-written' }

export type EditorDomSelectionContext = {
  readonly hiddenInputFocused: boolean
}

export type EditorSelectionBeforeEditSource = 'dom' | 'hidden-input' | 'session'

export function createEditorInputState(): EditorInputState {
  return {
    phase: 'idle',
    selectionOwner: 'dom',
    hiddenInputValueOwner: 'editor',
    pendingText: '',
    pendingTextSource: null,
    compositionActive: false,
    compositionCommitted: false,
    compositionText: '',
    mouseSelectionActive: false,
  }
}

export function transitionEditorInputState(
  state: EditorInputState,
  transition: EditorInputStateTransition,
): EditorInputState {
  if (transition.type === 'composition-start') {
    return startComposition(state)
  }
  if (transition.type === 'composition-update') return updateComposition(state, transition.text)
  if (transition.type === 'composition-pending') {
    return setPendingText(state, 'composition', transition.text)
  }
  if (transition.type === 'composition-end') return endComposition(state)
  if (transition.type === 'beforeinput-pending') {
    return setPendingText(state, 'beforeinput', transition.text ?? '')
  }
  if (transition.type === 'deduced-input-pending') {
    return setPendingText(state, 'deduced', transition.text)
  }
  if (transition.type === 'paste-pending') return setPendingText(state, 'paste', transition.text)
  if (transition.type === 'drop-pending') return setPendingText(state, 'drop', transition.text)
  if (transition.type === 'native-input-observed') return nativeInputObserved(state)
  if (transition.type === 'transaction-committed') {
    return commitTransaction(state)
  }
  if (transition.type === 'selection-reconciled') {
    return { ...state, phase: 'selection-reconciled', selectionOwner: transition.owner }
  }
  if (transition.type === 'selection-owned-by-dom') return selectionOwnedBy(state, 'dom')
  if (transition.type === 'selection-owned-by-hidden-input') {
    return selectionOwnedBy(state, 'hidden-input')
  }
  if (transition.type === 'selection-owned-by-session') return selectionOwnedBy(state, 'session')
  if (transition.type === 'mouse-selection-start') return startMouseSelection(state)
  if (transition.type === 'mouse-selection-finish') return finishMouseSelection(state)
  if (transition.type === 'mouse-selection-cancel') return cancelMouseSelection(state)

  return { ...state, hiddenInputValueOwner: 'editor' }
}

export function editorInputStateOwnership(state: EditorInputState): EditorInputStateOwnership {
  return {
    domSelection: state.selectionOwner === 'dom' ? 'browser' : 'editor',
    sessionSelection: 'document-session',
    hiddenInputValue: state.hiddenInputValueOwner,
    pendingText: state.pendingText.length === 0 ? 'none' : 'state-machine',
  }
}

export function shouldCommitCompositionEnd(state: EditorInputState, text: string): boolean {
  if (!state.compositionActive) return false
  if (state.compositionCommitted) return false
  return text.length > 0
}

export function shouldSyncSessionSelectionFromDom(
  state: EditorInputState,
  context: EditorDomSelectionContext,
): boolean {
  if (state.mouseSelectionActive) return false
  if (state.selectionOwner === 'session') return false
  return !context.hiddenInputFocused
}

export function shouldSyncCustomSelectionFromDom(
  state: EditorInputState,
  context: EditorDomSelectionContext,
): boolean {
  return shouldSyncSessionSelectionFromDom(state, context)
}

export function selectionBeforeEditSource(
  state: EditorInputState,
  context: EditorDomSelectionContext,
): EditorSelectionBeforeEditSource {
  if (context.hiddenInputFocused) return 'hidden-input'
  if (state.selectionOwner === 'session') return 'session'
  return 'dom'
}

function startComposition(state: EditorInputState): EditorInputState {
  return clearPendingText({
    ...state,
    phase: 'composing',
    compositionActive: true,
    compositionCommitted: false,
    compositionText: '',
  })
}

function updateComposition(state: EditorInputState, text: string): EditorInputState {
  if (!state.compositionActive) return state

  return {
    ...state,
    phase: 'composing',
    compositionText: text,
  }
}

function endComposition(state: EditorInputState): EditorInputState {
  return clearPendingText({
    ...state,
    phase: 'idle',
    compositionActive: false,
    compositionCommitted: false,
    compositionText: '',
  })
}

function commitTransaction(state: EditorInputState): EditorInputState {
  return clearPendingText({
    ...state,
    phase: 'transaction-committed',
    compositionCommitted: state.compositionActive || state.compositionCommitted,
  })
}

/**
 * The browser wrote the hidden input itself, so what the editor remembers of it is one event out of
 * date. Recording that is what tells the next diff which of the two strings it holds is stale.
 */
function nativeInputObserved(state: EditorInputState): EditorInputState {
  return {
    ...state,
    phase: 'native-input-observed',
    hiddenInputValueOwner: 'browser',
  }
}

function clearPendingText(state: EditorInputState): EditorInputState {
  return {
    ...state,
    pendingText: '',
    pendingTextSource: null,
  }
}

function setPendingText(
  state: EditorInputState,
  source: EditorPendingTextSource,
  text: string,
): EditorInputState {
  return {
    ...clearPendingText(state),
    phase: 'beforeinput-pending',
    pendingText: text,
    pendingTextSource: source,
  }
}

function selectionOwnedBy(
  state: EditorInputState,
  owner: EditorInputSelectionOwner,
): EditorInputState {
  return { ...state, phase: 'selection-reconciled', selectionOwner: owner }
}

function startMouseSelection(state: EditorInputState): EditorInputState {
  return {
    ...state,
    mouseSelectionActive: true,
  }
}

function finishMouseSelection(state: EditorInputState): EditorInputState {
  return {
    ...state,
    mouseSelectionActive: false,
  }
}

function cancelMouseSelection(state: EditorInputState): EditorInputState {
  return finishMouseSelection(state)
}
