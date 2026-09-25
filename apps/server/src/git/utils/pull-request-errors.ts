import { defineErrorCatalog } from 'evlog'

export const gitPullRequestErrors = defineErrorCatalog('git', {
  FORGE_HOST_INVALID: {
    status: 400,
    message: 'The host does not match the selected forge',
    why: 'Publishing needs a hostname supported by the selected forge.',
    fix: 'Enter a hostname for that forge. Bitbucket Cloud uses bitbucket.org.',
  },
  PULL_REQUEST_LOOKUP_LIMIT: {
    status: 502,
    message: 'The pull request history exceeded the lookup limit',
    why: 'The forge returned more history than a branch lookup can scan.',
    fix: 'Open the pull request by its number or URL.',
  },
  PULL_REQUEST_HEAD_CHANGED: {
    status: 409,
    message: 'The pull request head changed',
    why: 'The fetched commit differs from the commit reported by the forge.',
    fix: 'Refresh the pull request and open it again.',
  },
  PULL_REQUEST_LOOKUP_FAILED: {
    status: 502,
    message: ({ forge }: { forge: string }) => `${forge} could not list pull requests`,
    why: 'The request failed before the forge confirmed whether a pull request exists.',
    fix: "Check the network and the forge CLI's sign-in (`gh auth status`, `glab auth status`, `tea login list`, `az account show`), resolve any rate limit, then retry.",
  },
  PULL_REQUEST_LOOKUP_TIMED_OUT: {
    status: 504,
    message: ({ forge }: { forge: string }) => `The ${forge} pull request lookup timed out`,
    why: 'The forge CLI exceeded the lookup time limit without a complete response.',
    fix: 'Check the network and retry the lookup before creating a pull request.',
  },
  PULL_REQUEST_RESPONSE_INVALID: {
    status: 502,
    message: ({ forge }: { forge: string }) => `${forge} returned an invalid pull request response`,
    why: 'The response could not establish whether a pull request exists.',
    fix: 'Check the installed forge CLI version and retry the lookup.',
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
    message: ({ branch, forge }: { branch: string; forge: string }) =>
      `${forge} could not open a pull request for ${branch}`,
    why: 'The forge refused the request: the branch may have no commits the base does not already have, may not be pushed yet, or the account may lack write access to the repository.',
    fix: "Push the branch, confirm it is ahead of its base, and check that the forge CLI's sign-in has access to this repository.",
  },
  REPOSITORY_CREATE_FAILED: {
    status: 502,
    message: ({ forge, repository }: { forge: string; repository: string }) =>
      `${forge} could not create ${repository}`,
    why: 'The forge refused the new repository: the name may be taken, the namespace may not exist, or the account may not be allowed to create repositories there.',
    fix: "Check the name and the forge CLI's sign-in, then publish again.",
  },
  FORGE_NOT_READY: {
    status: 409,
    message: ({ forge, reason }: { forge: string; reason: string }) =>
      `${forge} is not ready: ${reason}`,
    why: 'Forge actions go through the forge CLI or API, which is not installed or not signed in on the machine that owns this checkout.',
    fix: 'Install the forge CLI and sign in on that machine (`gh auth login`, `glab auth login`, `tea login add`, `az login`), or store bitbucket.org credentials in git, then try again.',
  },
  REPOSITORY_NAME_INVALID: {
    status: 400,
    message: ({ forge, expected }: { forge: string; expected: string }) =>
      `${forge} needs the repository as ${expected}`,
    why: 'The repository name does not have the parts this forge addresses repositories by.',
    fix: 'Enter the repository in that form and publish again.',
  },
})
