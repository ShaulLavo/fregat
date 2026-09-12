import type { GitRepositoryInfo } from '@workspace/contracts'

export function aheadBehindLabel(repository: GitRepositoryInfo) {
  const parts: string[] = []
  if (repository.ahead > 0) parts.push(`↑${repository.ahead}`)
  if (repository.behind > 0) parts.push(`↓${repository.behind}`)
  if (parts.length === 0) return ''

  return parts.join(' ')
}

export function canSyncChanges(repository: GitRepositoryInfo, hasLocalChanges: boolean) {
  return !hasLocalChanges && repository.ahead > 0
}

export function syncChangesLabel(repository: GitRepositoryInfo) {
  const parts: string[] = []
  if (repository.behind > 0) parts.push(`${repository.behind}↓`)
  if (repository.ahead > 0) parts.push(`${repository.ahead}↑`)
  if (parts.length === 0) return 'Sync Changes'

  return `Sync Changes ${parts.join(' ')}`
}
