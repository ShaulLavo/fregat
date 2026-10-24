import { describe, expect, it } from 'vitest'
import {
  createEditorInputState,
  editorInputStateOwnership,
  selectionBeforeEditSource,
  shouldCommitCompositionEnd,
  shouldSyncCustomSelectionFromDom,
  shouldSyncSessionSelectionFromDom,
  transitionEditorInputState,
} from '../src/editor/inputState'

describe('editor input state machine', () => {
  it('represents beforeinput, commit, and selection reconciliation transitions', () => {
    let state = createEditorInputState()

    state = transitionEditorInputState(state, { type: 'beforeinput-pending' })
    expect(state.phase).toBe('beforeinput-pending')

    state = transitionEditorInputState(state, { type: 'transaction-committed' })
    expect(state.phase).toBe('transaction-committed')

    state = transitionEditorInputState(state, {
      owner: 'session',
      type: 'selection-reconciled',
    })

    expect(state.phase).toBe('selection-reconciled')
    expect(editorInputStateOwnership(state)).toEqual({
      domSelection: 'editor',
      hiddenInputValue: 'editor',
      pendingText: 'none',
      sessionSelection: 'document-session',
    })
  })

  it('records which side last wrote the hidden input', () => {
    let state = createEditorInputState()

    expect(editorInputStateOwnership(state).hiddenInputValue).toBe('editor')

    state = transitionEditorInputState(state, { type: 'native-input-observed' })

    expect(state.phase).toBe('native-input-observed')
    expect(editorInputStateOwnership(state).hiddenInputValue).toBe('browser')

    state = transitionEditorInputState(state, { type: 'hidden-input-written' })

    expect(editorInputStateOwnership(state).hiddenInputValue).toBe('editor')
  })

  it('tracks text deduced from the hidden input as its own pending source', () => {
    let state = createEditorInputState()

    state = transitionEditorInputState(state, { text: 'the', type: 'deduced-input-pending' })

    expect(state).toMatchObject({
      pendingText: 'the',
      pendingTextSource: 'deduced',
      phase: 'beforeinput-pending',
    })
    expect(editorInputStateOwnership(state).pendingText).toBe('state-machine')

    state = transitionEditorInputState(state, { type: 'transaction-committed' })

    expect(editorInputStateOwnership(state).pendingText).toBe('none')
  })

  it('tracks paste and drop pending text sources', () => {
    let state = createEditorInputState()

    state = transitionEditorInputState(state, { text: 'pasted', type: 'paste-pending' })
    expect(state).toMatchObject({
      pendingText: 'pasted',
      pendingTextSource: 'paste',
      phase: 'beforeinput-pending',
    })

    state = transitionEditorInputState(state, { type: 'transaction-committed' })
    state = transitionEditorInputState(state, { text: 'dropped', type: 'drop-pending' })

    expect(state).toMatchObject({
      pendingText: 'dropped',
      pendingTextSource: 'drop',
      phase: 'beforeinput-pending',
    })
  })

  it('commits compositionend only when composition text was not already handled', () => {
    let state = createEditorInputState()

    state = transitionEditorInputState(state, { type: 'composition-start' })
    state = transitionEditorInputState(state, { text: '文', type: 'composition-update' })

    expect(shouldCommitCompositionEnd(state, state.compositionText)).toBe(true)

    state = transitionEditorInputState(state, { text: '文', type: 'composition-pending' })
    state = transitionEditorInputState(state, { type: 'transaction-committed' })

    expect(shouldCommitCompositionEnd(state, '文')).toBe(false)

    state = transitionEditorInputState(state, { type: 'composition-end' })

    expect(state).toMatchObject({
      compositionActive: false,
      compositionCommitted: false,
      compositionText: '',
      phase: 'idle',
    })
  })

  it('owns DOM selection reconciliation decisions', () => {
    let state = createEditorInputState()

    expect(
      shouldSyncSessionSelectionFromDom(state, {
        hiddenInputFocused: false,
      }),
    ).toBe(true)
    expect(selectionBeforeEditSource(state, { hiddenInputFocused: false })).toBe('dom')

    state = transitionEditorInputState(state, { type: 'selection-owned-by-session' })

    expect(shouldSyncCustomSelectionFromDom(state, { hiddenInputFocused: false })).toBe(false)
    expect(selectionBeforeEditSource(state, { hiddenInputFocused: false })).toBe('session')

    state = transitionEditorInputState(state, { type: 'selection-owned-by-dom' })
    state = transitionEditorInputState(state, { type: 'mouse-selection-start' })

    expect(shouldSyncSessionSelectionFromDom(state, { hiddenInputFocused: false })).toBe(false)
    expect(selectionBeforeEditSource(state, { hiddenInputFocused: true })).toBe('hidden-input')

    state = transitionEditorInputState(state, { type: 'mouse-selection-finish' })

    expect(shouldSyncSessionSelectionFromDom(state, { hiddenInputFocused: false })).toBe(true)
  })
})
