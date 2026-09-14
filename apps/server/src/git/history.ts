import path from 'node:path'
import type { GitCommitDetails, GitHistoryPage, GitHistoryRef } from '@workspace/contracts'
import { recordRequestContext } from '../observability'
import type { GitHistoryBody, GitHistoryCommitQuery } from './contracts'
import type { GitRepositoryRunner, GitService } from './service'
import { historyErrors } from './utils/history-errors'
import { searchHistoryTips } from './history-search'
import {
  historyLogFormat,
  parseHistoryCommits,
  parseHistoryFiles,
  parseHistoryRefs,
  nestedHistoryTags,
  parsePeeledHistoryTags,
} from './history-format'

const PAGE_SIZE = 100

export class GitHistory {
  private readonly git: GitService

  constructor(git: GitService) {
    this.git = git
  }

  async page(query: GitHistoryBody): Promise<GitHistoryPage> {
    recordRequestContext({
      area: 'git',
      operation: 'history',
      git: {
        operation: 'history',
        path: query.path,
        ref: query.ref,
        searching: Boolean(query.search),
        skip: query.cursor?.skip ?? 0,
      },
    })
    const runner = await this.git.repositoryRunner(query.path)
    const refs = query.cursor ? [] : await readRefs(runner)
    const tips = query.cursor?.tips ?? historyTips(refs, query.ref)
    if (tips.length === 0) return { commits: [], refs, next: null }
    const logTips = query.search ? await searchHistoryTips(runner, tips, query.search) : tips
    if (logTips.length === 0) return { commits: [], refs, next: null }

    const skip = query.cursor?.skip ?? 0
    const result = await runner.run(
      [
        'log',
        '--no-color',
        '--no-show-signature',
        '-z',
        `--format=${historyLogFormat}`,
        `--max-count=${PAGE_SIZE + 1}`,
        `--skip=${skip}`,
        // --max-count enables walking again, so --no-walk must follow it.
        query.search ? '--no-walk=sorted' : '--topo-order',
        '--stdin',
      ],
      { input: `${logTips.join('\n')}\n` },
    )
    const records = parseHistoryCommits(result.stdout)
    const commits = records.slice(0, PAGE_SIZE).map(({ message: _message, ...commit }) => commit)
    recordRequestContext({
      git: {
        commitCount: commits.length,
        tipCount: tips.length,
        hasMore: records.length > PAGE_SIZE,
      },
    })
    return {
      commits,
      refs,
      next: records.length > PAGE_SIZE ? { tips, skip: skip + commits.length } : null,
    }
  }

  async commit(query: GitHistoryCommitQuery): Promise<GitCommitDetails> {
    recordRequestContext({
      area: 'git',
      operation: 'history_commit',
      git: { operation: 'history_commit', path: query.path, commit: query.commit },
    })
    const runner = await this.git.repositoryRunner(query.path)
    const result = await runner.run([
      'log',
      '-1',
      '--no-show-signature',
      '-z',
      `--format=${historyLogFormat}`,
      `${query.commit}^{commit}`,
      '--',
    ])
    const commit = parseHistoryCommits(result.stdout)[0]
    if (!commit) throw historyErrors.HISTORY_REF_MISSING()

    const parent = commit.parents[0]
    const diff = await runner.run([
      'diff-tree',
      '--no-commit-id',
      '--raw',
      '--no-abbrev',
      '-r',
      '-z',
      '--find-renames',
      '--no-ext-diff',
      '--no-textconv',
      ...(parent ? [parent, commit.id] : ['--root', commit.id]),
      '--',
    ])
    const files = parseHistoryFiles(diff.stdout).map((file) => ({
      ...file,
      path: path.posix.join(runner.rootPath, file.path),
      oldPath: file.oldPath ? path.posix.join(runner.rootPath, file.oldPath) : undefined,
    }))
    recordRequestContext({ git: { fileCount: files.length, parentCount: commit.parents.length } })
    return { ...commit, files }
  }
}

async function readRefs(runner: GitRepositoryRunner): Promise<GitHistoryRef[]> {
  const [refs, head] = await Promise.all([
    runner.run([
      'for-each-ref',
      '--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)',
      'refs/heads/',
      'refs/remotes/',
      'refs/tags/',
    ]),
    runner.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { allowFailure: true }),
  ])
  const values = parseHistoryRefs(refs.stdout)
  const nestedTags = nestedHistoryTags(refs.stdout)
  if (nestedTags.length > 0) {
    const peeled = await runner.run(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      input: `${nestedTags.map((name) => `${name}^{commit}`).join('\n')}\n`,
    })
    values.push(...parsePeeledHistoryTags(nestedTags, peeled.stdout))
  }
  if (head.exitCode === 0)
    values.unshift({ name: 'HEAD', kind: 'head', commitId: head.stdout.trim() })
  return values
}

function historyTips(refs: readonly GitHistoryRef[], selected: string): string[] {
  const chosen = selected === 'all' ? refs : refs.filter((ref) => ref.name === selected)
  if (selected !== 'all' && selected !== 'HEAD' && chosen.length === 0)
    throw historyErrors.HISTORY_REF_MISSING()
  return [...new Set(chosen.map((ref) => ref.commitId))].sort()
}
