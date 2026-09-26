import { describe, expect, it } from 'vitest'
import {
  parsePullRequestReference,
  pullRequestReferenceRepository,
} from '../pull-request-reference'

describe('pull request references', () => {
  it.each([
    ['https://github.com/acme/app/pull/42', 42],
    ['https://github.com/acme/app/pull/42/files#diff', 42],
    ['https://github.example.com/acme/app/pull/7', 7],
    ['https://gitlab.com/group/sub/app/-/merge_requests/9', 9],
    ['https://codeberg.org/owner/repo/pulls/3', 3],
    ['https://dev.azure.com/org/proj/_git/app/pullrequest/15', 15],
    ['https://org.visualstudio.com/proj/_git/app/pullrequest/16', 16],
    ['https://bitbucket.org/ws/app/pull-requests/5', 5],
    ['#123', 123],
    ['  88 ', 88],
    ['gh pr checkout 12', 12],
    ['glab mr checkout https://gitlab.com/g/p/-/merge_requests/4', 4],
    ['tea pr checkout 6', 6],
    ['az repos pr checkout --id 21 --remote-name origin', 21],
    ['az repos pr checkout --id=22', 22],
  ])('%s is #%i', (input, number) => {
    expect(parsePullRequestReference(input)).toBe(number)
  })

  it.each(['', 'feature/login', 'https://github.com/acme/app', 'pull 12'])(
    '%j names none',
    (input) => {
      expect(parsePullRequestReference(input)).toBeNull()
    },
  )

  it.each([
    ['https://github.com/Acme/App/pull/42/files', 'github.com', 'acme/app'],
    ['https://gitlab.com/group/sub/app/-/merge_requests/9', 'gitlab.com', 'group/sub/app'],
    ['https://codeberg.org/owner/repo/pulls/3', 'codeberg.org', 'owner/repo'],
    [
      'https://dev.azure.com/org/proj/_git/app/pullrequest/15',
      'dev.azure.com',
      'org/proj/_git/app',
    ],
    ['https://bitbucket.org/ws/app/pull-requests/5', 'bitbucket.org', 'ws/app'],
    ['glab mr checkout https://gitlab.com/g/p/-/merge_requests/4', 'gitlab.com', 'g/p'],
  ])('%s belongs to %s/%s', (input, host, path) => {
    expect(pullRequestReferenceRepository(input)).toEqual({ host, path })
  })

  it.each(['#12', '12', 'gh pr checkout 12'])('%j names no repository', (input) => {
    expect(pullRequestReferenceRepository(input)).toBeNull()
  })
})
