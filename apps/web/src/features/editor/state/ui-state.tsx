import {
  editorStatusBarSourcesEqual,
  type EditorStatusBarSource,
} from '@/features/editor/state/status-bar-source'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapore-editor/lsp-plugin'
import type { ReactEditorController } from '@singapore-editor/react'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'

type EditorUiStoreState = {
  definitionTarget: LanguageServerDefinitionTarget | null
  languageServerReferences: LanguageServerReferencesResult | null
  statusBarSource: EditorStatusBarSource | null
}

type EditorUiStoreActions = {
  clearDefinitionTargetForPath: (path: string) => void
  clearStatusBarSource: (controller?: ReactEditorController) => void
  renameDefinitionTargetPath: (from: string, to: string) => void
  renameLanguageServerReferencesPath: (from: string, to: string) => void
  resetEditorUiState: () => void
  setDefinitionTarget: (target: LanguageServerDefinitionTarget | null) => void
  setLanguageServerReferences: (references: LanguageServerReferencesResult | null) => void
  setStatusBarSource: (source: EditorStatusBarSource | null) => void
}

export type EditorUiStore = EditorUiStoreState & EditorUiStoreActions

export type EditorUiStoreApi = StoreApi<EditorUiStore>

export const EditorUiStateContext = createContext<EditorUiStoreApi | null>(null)

export function useEditorUiStoreApi() {
  const store = use(EditorUiStateContext)
  if (!store) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useEditorUiStoreApi must be used within EditorStateProvider',
    })
  }

  return store
}

export function useEditorUiState<T>(selector: (state: EditorUiStore) => T): T {
  return useStore(useEditorUiStoreApi(), selector)
}

export function createEditorUiStore() {
  return createStore<EditorUiStore>()((set) => ({
    definitionTarget: null,
    languageServerReferences: null,
    statusBarSource: null,
    clearDefinitionTargetForPath: (path) =>
      set((state) => {
        if (state.definitionTarget?.path !== path) return state

        return { definitionTarget: null }
      }),
    clearStatusBarSource: (controller) =>
      set((state) => {
        if (!state.statusBarSource) return state
        if (controller && state.statusBarSource.controller !== controller) return state

        return { statusBarSource: null }
      }),
    renameDefinitionTargetPath: (from, to) =>
      set((state) => {
        if (state.definitionTarget?.path !== from) return state

        return { definitionTarget: { ...state.definitionTarget, path: to } }
      }),
    renameLanguageServerReferencesPath: (from, to) =>
      set((state) => {
        const references = renamedLanguageServerReferences(state.languageServerReferences, from, to)
        if (references === state.languageServerReferences) return state

        return { languageServerReferences: references }
      }),
    resetEditorUiState: () =>
      set({
        definitionTarget: null,
        languageServerReferences: null,
        statusBarSource: null,
      }),
    setDefinitionTarget: (definitionTarget) => set({ definitionTarget }),
    setLanguageServerReferences: (languageServerReferences) => set({ languageServerReferences }),
    setStatusBarSource: (statusBarSource) =>
      set((state) => {
        if (editorStatusBarSourcesEqual(statusBarSource, state.statusBarSource)) return state

        return { statusBarSource }
      }),
  }))
}

function renamedLanguageServerReferences(
  references: LanguageServerReferencesResult | null,
  from: string,
  to: string,
) {
  if (!references) return references

  let changed = false
  const targets = references.targets.map((target) => {
    if (target.path !== from) return target

    changed = true
    return { ...target, path: to }
  })
  if (!changed) return references

  return { ...references, targets }
}
