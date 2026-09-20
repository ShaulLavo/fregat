import {
  isDirectoryEntry,
  type FsEntry,
  type PickedFsEntry,
  type ServerInfo,
} from '@/lib/file-system-types'
import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { useCallback, useState } from 'react'

import { ROOT_PATH, initialPathForOpen, pickerParentPath } from '@/features/file-picker/utils/model'

type NavigationState = {
  readonly backHistory: readonly string[]
  readonly currentPath: string
  readonly forwardHistory: readonly string[]
}

const initialNavigationState: NavigationState = {
  backHistory: [],
  currentPath: ROOT_PATH,
  forwardHistory: [],
}

export function useFilePickerSession(value: PickedFsEntry | null) {
  const [isInitialized, setIsInitialized] = useState(false)
  const [navigation, setNavigation] = useState(initialNavigationState)
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebouncedValue(query, { wait: 180 })
  const effectiveQuery = query.trim() ? debouncedQuery : ''
  const [selectedEntry, setSelectedEntry] = useState<FsEntry | null>(value)

  const initializeOpenSession = useCallback(
    (info: ServerInfo) => {
      if (isInitialized) return

      setIsInitialized(true)
      setNavigation({
        backHistory: [],
        currentPath: initialPathForOpen(value, info.defaultPath ?? info.homePath),
        forwardHistory: [],
      })
      setQuery('')
      setSelectedEntry(value)
    },
    [isInitialized, value],
  )

  const resetOpenSession = useCallback(() => {
    setIsInitialized(false)
    setNavigation(initialNavigationState)
    setQuery('')
    setSelectedEntry(null)
  }, [])

  const moveToPath = useCallback(
    (path: string) => {
      if (path === navigation.currentPath) return

      setNavigation((current) => navigate(current, path))
      setSelectedEntry(null)
      setQuery('')
    },
    [navigation.currentPath],
  )

  const goBack = useCallback(() => {
    if (navigation.backHistory.length === 0) return

    setNavigation(back)
    setSelectedEntry(null)
    setQuery('')
  }, [navigation.backHistory.length])

  const goForward = useCallback(() => {
    if (navigation.forwardHistory.length === 0) return

    setNavigation(forward)
    setSelectedEntry(null)
    setQuery('')
  }, [navigation.forwardHistory.length])

  const revealEntry = useCallback(
    (entry: FsEntry) => {
      const directory = isDirectoryEntry(entry)
      const path = directory ? entry.path : pickerParentPath(entry.path)
      if (path !== navigation.currentPath) {
        setNavigation((current) => navigate(current, path))
      }

      setSelectedEntry(directory ? null : entry)
      setQuery('')
    },
    [navigation.currentPath],
  )

  return {
    backPath: navigation.backHistory.at(-1) ?? null,
    canGoBack: navigation.backHistory.length > 0,
    canGoForward: navigation.forwardHistory.length > 0,
    canGoUp: navigation.currentPath !== ROOT_PATH,
    currentPath: navigation.currentPath,
    effectiveQuery,
    forwardPath: navigation.forwardHistory[0] ?? null,
    goBack,
    goForward,
    initializeOpenSession,
    isInitialized,
    jumpTo: moveToPath,
    navigateTo: moveToPath,
    query,
    revealEntry,
    resetOpenSession,
    selectedEntry,
    setQuery,
    setSelectedEntry,
  }
}

function navigate(current: NavigationState, path: string): NavigationState {
  if (path === current.currentPath) return current

  return {
    backHistory: current.backHistory.concat(current.currentPath),
    currentPath: path,
    forwardHistory: [],
  }
}

function back(current: NavigationState): NavigationState {
  const previousPath = current.backHistory.at(-1)
  if (previousPath === undefined) return current

  return {
    backHistory: current.backHistory.slice(0, -1),
    currentPath: previousPath,
    forwardHistory: [current.currentPath, ...current.forwardHistory],
  }
}

function forward(current: NavigationState): NavigationState {
  const nextPath = current.forwardHistory[0]
  if (nextPath === undefined) return current

  return {
    backHistory: current.backHistory.concat(current.currentPath),
    currentPath: nextPath,
    forwardHistory: current.forwardHistory.slice(1),
  }
}
