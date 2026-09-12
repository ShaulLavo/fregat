import type { QueryClient } from '@tanstack/react-query'
import { createStore, type StoreApi } from 'zustand/vanilla'

/**
 * What a commit's hooks have said so far, per repository.
 *
 * A store rather than mutation state because the lines arrive while the
 * mutation is still pending: TanStack Query has no notion of partial progress,
 * and the whole point is to show the hook talking before the commit resolves.
 *
 * Bounded, because a hook can run a whole test suite and its output is not
 * something anyone scrolls back through — the last screenful is what says
 * whether it is progressing or wedged.
 */
const MAX_COMMIT_PROGRESS_LINES = 200

type CommitProgressLine = {
  readonly stream: 'stderr' | 'stdout'
  readonly text: string
}

type CommitProgressState = {
  linesByRootPath: Readonly<Record<string, readonly CommitProgressLine[]>>
}

type CommitProgressActions = {
  appendCommitProgress: (rootPath: string, line: CommitProgressLine) => void
  clearCommitProgress: (rootPath: string) => void
}

export type CommitProgressStore = CommitProgressState & CommitProgressActions

const NO_LINES: readonly CommitProgressLine[] = []

const storesByClient = new WeakMap<QueryClient, StoreApi<CommitProgressStore>>()

export function commitProgressStoreFor(queryClient: QueryClient) {
  const existing = storesByClient.get(queryClient)
  if (existing) return existing

  const store = createCommitProgressStore()
  storesByClient.set(queryClient, store)
  return store
}

function createCommitProgressStore() {
  return createStore<CommitProgressStore>((set) => ({
    linesByRootPath: {},
    appendCommitProgress: (rootPath, line) =>
      set((state) => ({
        linesByRootPath: {
          ...state.linesByRootPath,
          [rootPath]: boundedLines(state.linesByRootPath[rootPath] ?? NO_LINES, line),
        },
      })),
    clearCommitProgress: (rootPath) => set((state) => withoutRootProgress(state, rootPath)),
  }))
}

function withoutRootProgress(state: CommitProgressStore, rootPath: string) {
  if (!state.linesByRootPath[rootPath]) return state

  const { [rootPath]: _cleared, ...linesByRootPath } = state.linesByRootPath
  return { linesByRootPath }
}

export function selectCommitProgress(
  state: Pick<CommitProgressStore, 'linesByRootPath'>,
  rootPath: string,
) {
  return state.linesByRootPath[rootPath] ?? NO_LINES
}

function boundedLines(lines: readonly CommitProgressLine[], line: CommitProgressLine) {
  const next = lines.concat(line)
  if (next.length <= MAX_COMMIT_PROGRESS_LINES) return next

  return next.slice(next.length - MAX_COMMIT_PROGRESS_LINES)
}
