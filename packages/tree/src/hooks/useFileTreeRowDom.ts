import { type RefObject, useRef } from 'react'

import type { FileTreeRowElements } from '../utils/render/rowElements'

export interface FileTreeRowDom {
  readonly getList: () => HTMLDivElement | null
  readonly getRenameInput: () => HTMLInputElement | null
  readonly getRoot: () => HTMLDivElement | null
  readonly getRowButtons: () => ReadonlyMap<string, HTMLElement>
  readonly getScroll: () => HTMLDivElement | null
  readonly getSearchInput: () => HTMLInputElement | null
  readonly getStickyRowButtons: () => ReadonlyMap<string, HTMLElement>
}

export interface FileTreeRowDomBinding extends FileTreeRowDom {
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly renameInputRef: RefObject<HTMLInputElement | null>
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  readonly registerRenameInput: (element: HTMLInputElement | null) => void
  readonly registerRowButton: (path: string, element: HTMLElement | null) => void
  readonly registerStickyRowButton: (path: string, element: HTMLElement | null) => void
}

function updateButtonRegistry(
  registry: Map<string, HTMLElement>,
  path: string,
  element: HTMLElement | null,
): void {
  if (element == null) {
    registry.delete(path)
    return
  }

  registry.set(path, element)
}

export function useFileTreeRowDom(rowElements?: FileTreeRowElements): FileTreeRowDomBinding {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const rowButtonsRef = useRef(new Map<string, HTMLElement>())
  const stickyRowButtonsRef = useRef(new Map<string, HTMLElement>())
  const getList = (): HTMLDivElement | null => listRef.current
  const getRenameInput = (): HTMLInputElement | null => renameInputRef.current
  const getRoot = (): HTMLDivElement | null => rootRef.current
  const getRowButtons = (): ReadonlyMap<string, HTMLElement> => rowButtonsRef.current
  const getScroll = (): HTMLDivElement | null => scrollRef.current
  const getSearchInput = (): HTMLInputElement | null => searchInputRef.current
  const getStickyRowButtons = (): ReadonlyMap<string, HTMLElement> => stickyRowButtonsRef.current
  const registerRenameInput = (element: HTMLInputElement | null): void => {
    renameInputRef.current = element
  }
  const registerRowButton = (path: string, element: HTMLElement | null): void => {
    updateButtonRegistry(rowButtonsRef.current, path, element)
    rowElements?.register(path, element, false)
  }
  const registerStickyRowButton = (path: string, element: HTMLElement | null): void => {
    updateButtonRegistry(stickyRowButtonsRef.current, path, element)
    rowElements?.register(path, element, true)
  }

  return {
    getList,
    getRenameInput,
    getRoot,
    getRowButtons,
    getScroll,
    getSearchInput,
    getStickyRowButtons,
    listRef,
    registerRenameInput,
    registerRowButton,
    registerStickyRowButton,
    renameInputRef,
    rootRef,
    scrollRef,
    searchInputRef,
  }
}
