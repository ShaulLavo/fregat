import {
  editorStatusBarSourcesEqual,
  type EditorStatusBarSource,
} from '@/features/editor/state/status-bar-source'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LanguageServerReferencesResult } from '@singapore-editor/lsp-plugin'
import type { ReactEditorController } from '@singapore-editor/react'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'
import type { TabId } from '@/lib/documents/utils/types'
import { TabPresentations } from '@/features/editor/state/tab-presentation'

type DefinitionTarget = { readonly tabId: TabId; readonly target: LanguageServerDefinitionTarget }
type References = { readonly tabId: TabId; readonly result: LanguageServerReferencesResult }

type EditorUiStoreState = {
  controllersByTabId: ReadonlyMap<TabId, ReactEditorController>
  definitionTarget: DefinitionTarget | null
  languageServerReferences: References | null
  moveTabId: TabId | null
  tabPresentation: TabPresentations
  statusBarSource: EditorStatusBarSource | null
}

type EditorUiStoreActions = {
  registerEditorController: (tabId: TabId, controller: ReactEditorController) => () => void
  clearDefinitionTargetForPath: (path: string) => void
  clearStatusBarSource: (controller?: ReactEditorController) => void
  renameDefinitionTargetPath: (from: string, to: string) => void
  renameLanguageServerReferencesPath: (from: string, to: string) => void
  resetEditorUiState: () => void
  setDefinitionTarget: (target: LanguageServerDefinitionTarget | null, tabId: TabId) => void
  setLanguageServerReferences: (
    references: LanguageServerReferencesResult | null,
    tabId: TabId,
  ) => void
  setMoveTabId: (tabId: TabId | null) => void
  retainTabPresentation: (tabIds: ReadonlySet<TabId>) => void
  copyTabPresentation: (fromTabId: TabId, toTabId: TabId) => void
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
  const tabPresentation = new TabPresentations()
  return createStore<EditorUiStore>()((set) => ({
    controllersByTabId: new Map(),
    registerEditorController: (tabId, controller) => {
      set((state) => ({
        controllersByTabId: new Map(state.controllersByTabId).set(tabId, controller),
      }))
      return () =>
        set((state) => {
          if (state.controllersByTabId.get(tabId) !== controller) return state
          const controllersByTabId = new Map(state.controllersByTabId)
          controllersByTabId.delete(tabId)
          return { controllersByTabId }
        })
    },
    definitionTarget: null,
    languageServerReferences: null,
    moveTabId: null,
    tabPresentation,
    retainTabPresentation: (tabIds) => {
      tabPresentation.retain(tabIds)
      set((state) => ({
        definitionTarget:
          state.definitionTarget && tabIds.has(state.definitionTarget.tabId)
            ? state.definitionTarget
            : null,
        languageServerReferences:
          state.languageServerReferences && tabIds.has(state.languageServerReferences.tabId)
            ? state.languageServerReferences
            : null,
        moveTabId: state.moveTabId && tabIds.has(state.moveTabId) ? state.moveTabId : null,
      }))
    },
    copyTabPresentation: (fromTabId, toTabId) => tabPresentation.copy(fromTabId, toTabId),
    statusBarSource: null,
    clearDefinitionTargetForPath: (path) =>
      set((state) => {
        if (state.definitionTarget?.target.path !== path) return state

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
        if (state.definitionTarget?.target.path !== from) return state

        return {
          definitionTarget: {
            ...state.definitionTarget,
            target: { ...state.definitionTarget.target, path: to },
          },
        }
      }),
    renameLanguageServerReferencesPath: (from, to) =>
      set((state) => {
        const owner = state.languageServerReferences
        if (!owner) return state
        const references = renamedLanguageServerReferences(owner.result, from, to)
        if (references === owner.result) return state

        return { languageServerReferences: { ...owner, result: references } }
      }),
    resetEditorUiState: () =>
      set({
        controllersByTabId: new Map(),
        definitionTarget: null,
        languageServerReferences: null,
        moveTabId: null,
        statusBarSource: null,
      }),
    setDefinitionTarget: (target, tabId) =>
      set((state) => {
        if (target) return { definitionTarget: { tabId, target } }
        if (state.definitionTarget?.tabId !== tabId) return state
        return { definitionTarget: null }
      }),
    setLanguageServerReferences: (result, tabId) =>
      set((state) => {
        if (result) return { languageServerReferences: { tabId, result } }
        if (state.languageServerReferences?.tabId !== tabId) return state
        return { languageServerReferences: null }
      }),
    setMoveTabId: (moveTabId) => set({ moveTabId }),
    setStatusBarSource: (statusBarSource) =>
      set((state) => {
        if (editorStatusBarSourcesEqual(statusBarSource, state.statusBarSource)) return state

        return { statusBarSource }
      }),
  }))
}

function renamedLanguageServerReferences(
  references: LanguageServerReferencesResult,
  from: string,
  to: string,
) {
  let changed = false
  const targets = references.targets.map((target) => {
    if (target.path !== from) return target

    changed = true
    return { ...target, path: to }
  })
  if (!changed) return references

  return { ...references, targets }
}
