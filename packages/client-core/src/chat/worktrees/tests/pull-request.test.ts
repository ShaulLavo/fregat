import { describe, expect, it } from 'vitest'
import { pullRequestBadge, pullRequestRepository } from '../pull-request'

describe('pullRequestRepository', () => {
  it.each([
    ['https://github.com/fregat/fixture/pull/31', 'fregat/fixture'],
    ['https://gitlab.com/group/sub/repo/-/merge_requests/5', 'group/sub/repo'],
    ['https://bitbucket.org/team/repo/pull-requests/7', 'team/repo'],
    ['https://codeberg.org/owner/repo/pulls/5', 'owner/repo'],
    ['https://dev.azure.com/org/proj/_git/repo/pullrequest/5', 'org/proj/repo'],
    ['https://example.com/no-pull-request-here', null],
    ['not a url', null],
  ])('reads %s as %s', (url, repository) => {
    expect(pullRequestRepository(url)).toBe(repository)
  })
})

it('names the pull request repository in the badge label, which shows a fork', () => {
  const badge = pullRequestBadge({
    status: 'found',
    number: 12,
    title: 'Fix the thing',
    url: 'https://github.com/upstream/project/pull/12',
    state: 'open',
    draft: false,
    closedAt: null,
  })

  expect(badge).toMatchObject({
    label: 'Pull request upstream/project#12 · Open: Fix the thing',
    text: '#12',
  })
})
