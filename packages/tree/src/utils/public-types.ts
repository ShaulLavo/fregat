export type GitStatus = 'added' | 'deleted' | 'ignored' | 'modified' | 'renamed' | 'untracked'

export type GitStatusEntry = {
  path: string
  status: GitStatus
}
