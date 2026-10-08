import { defineErrorCatalog } from 'evlog'

export const gitWorktreeErrors = defineErrorCatalog('git', {
  WORKTREE_IDENTITY_MISMATCH: {
    status: 409,
    message: 'The worktree folder or branch is not the one expected',
    why: 'Its folder or branch changed since the worktree was set up, so it is left untouched.',
    fix: 'Check the folder and branch by hand, then try again.',
  },
  WORKTREE_BRANCH_EXISTS: {
    status: 409,
    message: "A branch with this worktree's name already exists",
    why: 'A new worktree needs a new branch, and this name is taken.',
    fix: 'Create another worktree, which gets a new branch name, or delete the old branch.',
  },
  WORKTREE_NEEDS_RECONFIRMATION: {
    status: 409,
    message: 'The worktree changed after you confirmed removing it',
    why: 'Its files, staged changes, or current commit changed since the removal preview.',
    fix: 'Check the new preview, then confirm again to delete the current changes.',
  },
  WORKTREE_UNSAFE_ENTRY: {
    status: 409,
    message: 'The worktree holds a file that cannot be read or keeps changing',
    why: 'Removal checks every file it would delete first, and one of them could not be checked.',
    fix: "Check that file's type and permissions by hand, then try removing the worktree again.",
  },
  WORKTREE_ADMIN_STALE: {
    status: 409,
    message: 'The worktree folder is gone, but Git still lists it',
    why: 'A missing folder cannot be checked, so Fregat leaves the entry for you to remove.',
    fix: 'Remove this one entry by hand with `git worktree remove`.',
  },
  WORKTREE_BASE_BRANCH_MISSING: {
    status: 404,
    message: ({ branch }: { branch: string }) => `The branch ${branch} does not exist`,
    why: 'A new worktree was asked to start from a local branch the repository does not have.',
    fix: 'Pick another branch for the new worktree, or create this branch first.',
  },
  WORKTREE_BASE_UNRESOLVED: {
    status: 404,
    message: ({ headBranch }: { headBranch: string }) =>
      `No base branch could be resolved for ${headBranch}`,
    why: 'No base branch was given, and the repository has no default branch to use.',
    fix: 'Pick a base branch, or fetch the branch this one started from.',
  },
  WORKTREE_BASE_NOT_FOUND: {
    status: 404,
    message: ({ base }: { base: string }) => `Base branch not found: ${base}`,
    why: 'The repository has no branch or commit by that name, often because a remote branch was never fetched.',
    fix: 'Fetch from the remote, or pick a base from the list.',
  },
  WORKTREE_DIRTY: {
    status: 409,
    message: ({ fileCount, path }: { fileCount: number; path: string }) =>
      `Worktree ${path} has ${fileCount} uncommitted change(s)`,
    why: 'Removing the worktree would delete changes that were never committed and exist nowhere else.',
    fix: 'Commit or discard the changes first, or force the removal to delete them.',
  },
  WORKTREE_MAIN_PROTECTED: {
    status: 400,
    message: ({ path }: { path: string }) => `${path} is the repository's main worktree`,
    why: "This is the repository's original checkout. Every other worktree reads its data from it, so Git refuses to remove it.",
    fix: 'Pick a worktree that Fregat created.',
  },
  WORKTREE_NOT_FOUND: {
    status: 404,
    message: ({ path }: { path: string }) =>
      `No worktree of this repository is checked out at ${path}`,
    why: 'Git does not list this folder as a worktree, so it is left on disk.',
    fix: 'List the worktrees and remove one of the paths it reports.',
  },
  WORKTREE_OUTSIDE_REPOSITORY: {
    status: 400,
    message: ({ path }: { path: string }) =>
      `${path} is outside the folder where Fregat keeps worktrees`,
    why: 'Fregat only removes worktrees it created, and those live in that folder.',
    fix: 'Remove worktrees created elsewhere by hand.',
  },
})
