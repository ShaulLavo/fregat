import { ensureTrailingNewline } from './path-utils'

export function commitMessageTemplate(statusOutput: string) {
  const records = statusOutput.split(/\r?\n/).filter(Boolean)
  const branch = records[0]?.startsWith('## ') ? records.shift() : undefined
  const sections = commitStatusSections(records)
  const lines = [
    '',
    '# Please enter the commit message for your changes. Lines starting',
    "# with '#' will be ignored, and an empty message aborts the commit.",
    '#',
    ...commitBranchLines(branch),
    '#',
    ...commitSectionLines('Changes to be committed:', sections.staged),
    ...commitSectionLines('Changes not staged for commit:', sections.unstaged),
    ...commitSectionLines('Untracked files:', sections.untracked),
  ]

  return ensureTrailingNewline(lines.join('\n'))
}

function commitBranchLines(branchRecord: string | undefined) {
  const branch = parseShortBranchRecord(branchRecord)
  if (!branch) return ['# On branch HEAD']

  const lines = [`# On branch ${branch.name}`]
  const upstreamLines = commitUpstreamLines(branch)
  if (upstreamLines.length > 0) lines.push(...upstreamLines)
  return lines
}

function commitUpstreamLines(branch: ShortBranch) {
  if (!branch.upstream) return []
  if (branch.ahead > 0 && branch.behind > 0) {
    return [
      `# Your branch and '${branch.upstream}' have diverged,`,
      `# and have ${commitCount(branch.ahead)} and ${commitCount(branch.behind)} different commits each, respectively.`,
    ]
  }
  if (branch.ahead > 0) {
    return [
      `# Your branch is ahead of '${branch.upstream}' by ${commitCount(branch.ahead)}.`,
      '#   (use "git push" to publish your local commits)',
    ]
  }
  if (branch.behind > 0) {
    return [
      `# Your branch is behind '${branch.upstream}' by ${commitCount(branch.behind)}.`,
      '#   (use "git pull" to update your local branch)',
    ]
  }

  return []
}

type ShortBranch = {
  ahead: number
  behind: number
  name: string
  upstream: string | null
}

function parseShortBranchRecord(record: string | undefined): ShortBranch | null {
  if (!record) return null

  const text = record.slice(3)
  const statusMatch = /\[(?<status>[^\]]+)\]$/.exec(text)
  const withoutStatus = text.replace(/\s+\[[^\]]+\]$/, '')
  const [namePart = withoutStatus, upstream = null] = withoutStatus.split('...')
  const noCommitsPrefix = 'No commits yet on '
  const name = namePart.startsWith(noCommitsPrefix)
    ? namePart.slice(noCommitsPrefix.length)
    : namePart

  return {
    ahead: statusCount(statusMatch?.groups?.status, 'ahead'),
    behind: statusCount(statusMatch?.groups?.status, 'behind'),
    name,
    upstream,
  }
}

function statusCount(status: string | undefined, key: 'ahead' | 'behind') {
  const match = new RegExp(`${key} (\\d+)`).exec(status ?? '')
  return Number(match?.[1] ?? 0)
}

function commitStatusSections(records: readonly string[]) {
  const sections = {
    staged: [] as string[],
    unstaged: [] as string[],
    untracked: [] as string[],
  }
  for (const record of records) appendCommitStatusRecord(sections, record)
  return sections
}

function appendCommitStatusRecord(
  sections: {
    staged: string[]
    unstaged: string[]
    untracked: string[]
  },
  record: string,
) {
  const indexStatus = record[0] ?? ' '
  const worktreeStatus = record[1] ?? ' '
  const file = record.slice(3)
  if (indexStatus === '?' && worktreeStatus === '?') {
    sections.untracked.push(file)
    return
  }
  if (indexStatus !== ' ') {
    sections.staged.push(commitStatusLine(indexStatus, file))
  }
  if (worktreeStatus !== ' ') {
    sections.unstaged.push(commitStatusLine(worktreeStatus, file))
  }
}

function commitStatusLine(status: string, file: string) {
  return `${commitStatusLabel(status)}:   ${file}`
}

function commitStatusLabel(status: string) {
  if (status === 'A') return 'new file'
  if (status === 'D') return 'deleted'
  if (status === 'R') return 'renamed'
  if (status === 'C') return 'copied'
  if (status === 'U') return 'unmerged'

  return 'modified'
}

function commitSectionLines(title: string, files: readonly string[]) {
  if (files.length === 0) return []

  return ['#', `# ${title}`].concat(
    files.map((file) => `#\t${file}`),
    '#',
  )
}

function commitCount(count: number) {
  return `${count} ${count === 1 ? 'commit' : 'commits'}`
}

/** Whether anything survives git's `strip` cleanup: a line that is neither blank nor a comment. */
export function hasCommitMessageText(contents: string) {
  return contents.split(/\r?\n/).some((line) => line.trim().length > 0 && !line.startsWith('#'))
}
