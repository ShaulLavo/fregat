import type { GitHistoryCommit, GitHistoryRef } from '@workspace/contracts'

export function historyCountLabel(count: number, search: string) {
  if (search) return `${count} ${count === 1 ? 'match' : 'matches'}`
  return `${count} ${count === 1 ? 'commit' : 'commits'}`
}

export function historyRefLabel(ref: GitHistoryRef) {
  return ref.name.replace(/^refs\/(heads|remotes|tags)\//, '')
}

export function historyMessageBody(message: string, subject: string) {
  // Git normalizes whitespace in %s, so it need not be an exact prefix of %B.
  return message.startsWith(subject) ? message.slice(subject.length).trimStart() : message
}

export function historyRefLabels(refs: readonly GitHistoryRef[]) {
  const byCommit = new Map<string, GitHistoryRef[]>()
  for (const ref of refs) {
    const values = byCommit.get(ref.commitId) ?? []
    values.push(ref)
    byCommit.set(ref.commitId, values)
  }
  return byCommit
}

export function historyCommitTitle(commit: GitHistoryCommit, refs: readonly GitHistoryRef[]) {
  const labels = refs.map(historyRefLabel).join(', ')
  return `${commit.subject}\n${commit.author} <${commit.authorEmail}>\n${new Date(commit.timestamp).toLocaleString()}\n${commit.id}${labels ? `\n${labels}` : ''}`
}
