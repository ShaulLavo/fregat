import type { QueryClient } from '@tanstack/react-query'
import { DEFAULT_SETTING_VALUES, type SettingsSnapshot } from '@workspace/contracts'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { gitKeys } from '@/lib/query-keys'

export function installGitBudgetInvalidation(queryClient: QueryClient) {
  const read = () =>
    queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())?.values[
      'git.maxDiffFileSizeMiB'
    ] ?? DEFAULT_SETTING_VALUES['git.maxDiffFileSizeMiB']
  let budget = read()
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== 'settings' || event.query.queryKey[1] !== 'document') return
    const next = read()
    if (next === budget) return
    budget = next
    // Blob ids stay the same when a size policy changes; discard policy-dependent cached text too.
    void queryClient.resetQueries({ queryKey: gitKeys.diffs() })
  })
}
