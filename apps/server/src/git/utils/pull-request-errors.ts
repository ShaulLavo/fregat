import { defineErrorCatalog } from 'evlog'

export const gitPullRequestErrors = defineErrorCatalog('git', {
  PULL_REQUEST_LOOKUP_FAILED: {
    status: 502,
    message: 'The GitHub CLI could not read pull requests',
    why: 'The request failed before GitHub confirmed whether an open pull request exists.',
    fix: 'Check the network and `gh auth status`, resolve any GitHub rate limit, then retry.',
  },
  PULL_REQUEST_LOOKUP_TIMED_OUT: {
    status: 504,
    message: 'The GitHub pull request lookup timed out',
    why: 'The GitHub CLI exceeded the lookup time limit without a complete response.',
    fix: 'Check the network and retry the lookup before creating a pull request.',
  },
  PULL_REQUEST_RESPONSE_INVALID: {
    status: 502,
    message: 'The GitHub CLI returned an invalid pull request response',
    why: 'The response could not establish whether an open pull request exists.',
    fix: 'Check the installed GitHub CLI and retry the lookup.',
  },
  PUSH_DETACHED_HEAD: {
    status: 409,
    message: ({ path }: { path: string }) => `${path} has no checked-out branch to push`,
    why: 'HEAD is detached, so there is no branch name for the remote to publish under and no head for a pull request to point at.',
    fix: 'Check out or create a branch first, then push.',
  },
  PULL_REBASE_CONFLICT: {
    status: 409,
    message: ({ files }: { files: string }) => `Pull stopped on a conflict in ${files}`,
    why: 'The pull rebases local commits onto the upstream, and both sides changed the same lines. The repository is left mid-rebase.',
    fix: 'Resolve the conflict markers, stage the files and run `git rebase --continue`, or run `git rebase --abort` to go back to before the pull.',
  },
  PULL_MERGE_CONFLICT: {
    status: 409,
    message: ({ files }: { files: string }) => `Pull stopped on a conflict in ${files}`,
    why: 'The pull merges the upstream into the local branch, and both sides changed the same lines. The repository is left mid-merge.',
    fix: 'Resolve the conflict markers, stage the files and commit, or run `git merge --abort` to go back to before the pull.',
  },
  PULL_FAILED: {
    status: 502,
    message: ({ reason }: { reason: string }) => `git pull failed: ${reason}`,
    why: 'Git refused the pull or could not reach the remote.',
    fix: 'Act on the reason git gave, then pull again.',
  },
  PULL_REQUEST_CREATE_FAILED: {
    status: 502,
    message: ({ branch }: { branch: string }) =>
      `The GitHub CLI could not open a pull request for ${branch}`,
    why: 'gh refused the request: the branch may have no commits the base does not already have, may not be pushed yet, or the account may lack write access to the repository.',
    fix: 'Push the branch, confirm it is ahead of its base, and check that `gh auth status` reports an account with access to this repository.',
  },
})
