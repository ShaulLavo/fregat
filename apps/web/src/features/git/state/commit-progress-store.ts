import type { QueryClient } from '@tanstack/react-query'
import { createStore, type StoreApi } from 'zustand/vanilla'

// TanStack owns the mutation; this store holds its bounded streaming output.
const MAX_COMMIT_PROGRESS_LINES = 200

type CommitProgressLine = {
  readonly stream: 'stderr' | 'stdout'
  readonly text: string
}

type CommitProgressState = {
  runsByRootPath: Readonly<
    Record<
      string,
      {
        readonly commit: string | null
        readonly lines: readonly CommitProgressLine[]
      }
    >
  >
}

type CommitProgressActions = {
  beginCommitProgress: (rootPath: string, commit: string | null) => void
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
    runsByRootPath: {},
    beginCommitProgress: (rootPath, commit) =>
      set((state) => ({
        runsByRootPath: { ...state.runsByRootPath, [rootPath]: { commit, lines: NO_LINES } },
      })),
    appendCommitProgress: (rootPath, line) => set((state) => appendLine(state, rootPath, line)),
    clearCommitProgress: (rootPath) => set((state) => withoutRootProgress(state, rootPath)),
  }))
}

function withoutRootProgress(state: CommitProgressStore, rootPath: string) {
  if (!state.runsByRootPath[rootPath]) return state

  const { [rootPath]: _cleared, ...runsByRootPath } = state.runsByRootPath
  return { runsByRootPath }
}

function appendLine(state: CommitProgressStore, rootPath: string, line: CommitProgressLine) {
  const run = state.runsByRootPath[rootPath]
  if (!run) return state
  return {
    runsByRootPath: {
      ...state.runsByRootPath,
      [rootPath]: { ...run, lines: boundedLines(run.lines, line) },
    },
  }
}

export function selectCommitProgress(
  state: Pick<CommitProgressStore, 'runsByRootPath'>,
  rootPath: string,
) {
  return state.runsByRootPath[rootPath]?.lines ?? NO_LINES
}

function boundedLines(lines: readonly CommitProgressLine[], line: CommitProgressLine) {
  const next = lines.concat(line)
  if (next.length <= MAX_COMMIT_PROGRESS_LINES) return next

  return next.slice(next.length - MAX_COMMIT_PROGRESS_LINES)
}
