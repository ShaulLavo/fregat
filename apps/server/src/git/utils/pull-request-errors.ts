import { defineErrorCatalog } from 'evlog'

export const gitPullRequestErrors = defineErrorCatalog('git', {
  FORGE_HOST_INVALID: {
    status: 400,
    message: 'The host does not match the selected service',
    why: 'Publishing needs a host that the selected service runs on.',
    fix: 'Enter a host for that service. Bitbucket Cloud uses bitbucket.org.',
  },
  PULL_REQUEST_LOOKUP_LIMIT: {
    status: 502,
    message: 'The pull request history exceeded the lookup limit',
    why: 'The Git host has more pull requests for this branch than one lookup can read.',
    fix: 'Open the pull request by its number or URL.',
  },
  PULL_REQUEST_HEAD_CHANGED: {
    status: 409,
    message: 'The pull request has new commits',
    why: 'The commit downloaded here differs from the latest commit the Git host reports.',
    fix: 'Refresh the pull request and open it again.',
  },
  PULL_REQUEST_LOOKUP_FAILED: {
    status: 502,
    message: ({ forge }: { forge: string }) => `${forge} could not list pull requests`,
    why: 'The request failed before the Git host said whether a pull request exists.',
    fix: 'Check the network and your sign-in to the Git host (`gh auth status`, `glab auth status`, `tea login list`, `az account show`), wait out any rate limit, then retry.',
  },
  PULL_REQUEST_LOOKUP_TIMED_OUT: {
    status: 504,
    message: ({ forge }: { forge: string }) => `The ${forge} pull request lookup timed out`,
    why: 'The Git host did not answer in time.',
    fix: 'Check the network and retry the lookup before creating a pull request.',
  },
  PULL_REQUEST_RESPONSE_INVALID: {
    status: 502,
    message: ({ forge }: { forge: string }) => `${forge} returned an invalid pull request response`,
    why: 'The Git host answered in a form that does not say whether a pull request exists.',
    fix: "Update the Git host's command-line tool (such as gh or glab) and retry.",
  },
  PUSH_DETACHED_HEAD: {
    status: 409,
    message: ({ path }: { path: string }) => `${path} has no checked-out branch to push`,
    why: 'No branch is checked out (detached HEAD), so there is no branch to push or to open a pull request for.',
    fix: 'Check out or create a branch first, then push.',
  },
  PULL_REBASE_CONFLICT: {
    status: 409,
    message: ({ files }: { files: string }) => `Pull stopped on a conflict in ${files}`,
    why: 'The pull replays your local commits on top of the remote ones, and both changed the same lines. The repository is left partway through the rebase.',
    fix: 'Resolve the conflict markers, stage the files and run `git rebase --continue`, or run `git rebase --abort` to go back to before the pull.',
  },
  PULL_MERGE_CONFLICT: {
    status: 409,
    message: ({ files }: { files: string }) => `Pull stopped on a conflict in ${files}`,
    why: 'The pull merges the remote branch into yours, and both changed the same lines. The repository is left partway through the merge.',
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
    why: 'The Git host refused: the branch may have no new commits compared with its base, may not be pushed yet, or your account may not be allowed to write to the repository.',
    fix: 'Push the branch, check that it has commits its base lacks, and check that your Git host sign-in can write to this repository.',
  },
  REPOSITORY_CREATE_FAILED: {
    status: 502,
    message: ({ forge, repository }: { forge: string; repository: string }) =>
      `${forge} could not create ${repository}`,
    why: 'The Git host refused: the name may be taken, the owner or group may not exist, or your account may not be allowed to create repositories there.',
    fix: 'Check the name and your sign-in to the Git host, then publish again.',
  },
  FORGE_NOT_READY: {
    status: 409,
    message: ({ forge, reason }: { forge: string; reason: string }) =>
      `${forge} is not ready: ${reason}`,
    why: "Publishing and pull requests use the Git host's command-line tool, which is not installed or not signed in on the machine that has this checkout.",
    fix: 'Install the tool and sign in on that machine (`gh auth login`, `glab auth login`, `tea login add`, `az login`), or store bitbucket.org credentials in git, then try again.',
  },
  REPOSITORY_NAME_INVALID: {
    status: 400,
    message: ({ forge, expected }: { forge: string; expected: string }) =>
      `${forge} needs the repository as ${expected}`,
    why: 'The name is missing a part this service needs, such as the owner.',
    fix: 'Enter the repository in that form and publish again.',
  },
})
