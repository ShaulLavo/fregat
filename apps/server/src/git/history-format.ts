import type { GitCommitDetails, GitCommitFile, GitHistoryRef } from '@workspace/contracts'
import { historyErrors } from './utils/history-errors'

// NULs cannot appear in Git commit fields; -z terminates each seven-field record.
export const historyLogFormat = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%B'
const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export function parseHistoryCommits(output: string): Omit<GitCommitDetails, 'files'>[] {
  if (!output) return []
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 7 !== 0)
    throw historyErrors.HISTORY_OUTPUT_INVALID({
      internal: { at: 'commit-fields', fieldCount: fields.length, perCommit: 7 },
    })
  const commits: Omit<GitCommitDetails, 'files'>[] = []
  for (let index = 0; index < fields.length; index += 7) {
    const [
      id = '',
      parentText = '',
      author = '',
      authorEmail = '',
      timestamp = '',
      subject = '',
      message = '',
    ] = fields.slice(index, index + 7)
    const parents = parentText ? parentText.split(' ') : []
    if (
      !objectId.test(id) ||
      parents.some((parent) => !objectId.test(parent)) ||
      !Number.isFinite(Number(timestamp))
    )
      throw historyErrors.HISTORY_OUTPUT_INVALID({
        internal: {
          at: 'commit-record',
          index,
          idValid: objectId.test(id),
          parentCount: parents.length,
          timestampValid: Number.isFinite(Number(timestamp)),
        },
      })
    commits.push({
      id,
      parents,
      author,
      authorEmail,
      timestamp: Number(timestamp) * 1000,
      subject,
      message: message.trimEnd(),
    })
  }
  return commits
}

export function parseHistoryRefs(output: string): GitHistoryRef[] {
  const refs: GitHistoryRef[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [name = '', type, id = '', peeledType, peeledId = ''] = line.split('\0')
    const commitId = type === 'commit' ? id : peeledId
    if (type !== 'commit' && peeledType !== 'commit') continue
    if (!objectId.test(commitId))
      throw historyErrors.HISTORY_OUTPUT_INVALID({
        internal: { at: 'ref', refName: name, type, peeledType },
      })
    refs.push({ name, kind: refKind(name), commitId })
  }
  return refs
}

function refKind(name: string): GitHistoryRef['kind'] {
  if (name.startsWith('refs/heads/')) return 'branch'
  if (name.startsWith('refs/remotes/')) return 'remote'
  return 'tag'
}

export function nestedHistoryTags(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.split('\0'))
    .filter((fields) => fields[1] === 'tag' && fields[3] === 'tag')
    .flatMap((fields) => (fields[0] ? [fields[0]] : []))
}

export function parsePeeledHistoryTags(names: readonly string[], output: string): GitHistoryRef[] {
  const lines = output.split('\n')
  return names.flatMap((name, index) => {
    const [commitId = '', type] = (lines[index] ?? '').split(' ')
    if (type !== 'commit') return []
    if (!objectId.test(commitId))
      throw historyErrors.HISTORY_OUTPUT_INVALID({
        internal: { at: 'tag', refName: name, index, type },
      })
    return [{ name, kind: 'tag', commitId }]
  })
}

export function parseHistoryFiles(output: string): GitCommitFile[] {
  const tokens = output.split('\0')
  const files: GitCommitFile[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const header = tokens[index] ?? ''
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDRT])\d*$/.exec(header)
    if (!match)
      throw historyErrors.HISTORY_OUTPUT_INVALID({
        internal: { at: 'numstat-header', index, headerLength: header.length },
      })
    const [, oldMode, newMode, oldId = '', newId = '', code] = match
    const firstPath = tokens[++index]
    const nextPath = code === 'R' ? tokens[++index] : firstPath
    if (!nextPath || !objectId.test(oldId) || !objectId.test(newId))
      throw historyErrors.HISTORY_OUTPUT_INVALID({
        internal: {
          at: 'numstat-record',
          index,
          code,
          hasPath: Boolean(nextPath),
          oldIdValid: objectId.test(oldId),
          newIdValid: objectId.test(newId),
        },
      })
    files.push({
      path: nextPath,
      oldPath: code === 'R' ? firstPath : undefined,
      oldObjectId: /^0+$/.test(oldId) ? undefined : oldId,
      newObjectId: /^0+$/.test(newId) ? undefined : newId,
      status: fileStatus(code),
      kind: oldMode === '160000' || newMode === '160000' ? 'submodule' : 'file',
    })
  }
  return files
}

function fileStatus(code: string | undefined): GitCommitFile['status'] {
  if (code === 'A') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  return 'modified'
}
