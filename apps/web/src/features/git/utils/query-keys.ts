import { gitKeys } from '@/lib/query-keys'
export const historyKeys = {
  page: (path: string, ref: string, search: string) =>
    [...gitKeys.all, 'history', path, ref, search] as const,
  commit: (path: string, commit: string) =>
    [...gitKeys.all, 'history-commit', path, commit] as const,
}

export const disabledDiffQueryKey = ['git', 'diffs', 'disabled'] as const
