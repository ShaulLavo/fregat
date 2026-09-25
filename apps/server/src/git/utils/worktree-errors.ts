import { defineErrorCatalog } from 'evlog'

export const gitWorktreeErrors = defineErrorCatalog('git', {
  WORKTREE_IDENTITY_MISMATCH: {
    status: 409,
    message: 'The checkout, branch, or Git administration does not match the requested worktree',
    why: 'The recorded provisioning or cleanup target cannot be proved against the current repository.',
    fix: 'Inspect the checkout and branch manually; retry only after their identity is verified.',
  },
  WORKTREE_BRANCH_EXISTS: {
    status: 409,
    message: 'The requested worktree branch already exists',
    why: 'New worktree preparation requires an absent branch; recovery only adopts the persisted commit.',
    fix: 'Create a new worktree with a new identifier, or inspect the failed provisioning operation.',
  },
  WORKTREE_NEEDS_RECONFIRMATION: {
    status: 409,
    message: 'The worktree changed after cleanup was confirmed',
    why: 'The current HEAD, index, or checkout fingerprint differs from the authorized preview.',
    fix: 'Review a fresh cleanup preview and confirm discarding the current changes.',
  },
  WORKTREE_UNSAFE_ENTRY: {
    status: 409,
    message: 'The worktree contains an unreadable, changing, or unsupported filesystem entry',
    why: 'Cleanup cannot fingerprint every byte and entry that removal would destroy.',
    fix: 'Inspect special files and permissions manually, then request a new cleanup preview.',
  },
  WORKTREE_ADMIN_STALE: {
    status: 409,
    message: 'The worktree checkout is missing but Git administration remains',
    why: 'The missing checkout cannot be verified for an exact safe removal.',
    fix: 'Inspect this exact Git worktree manually; do not run a broad worktree prune.',
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
    why: 'No projected base was supplied and the repository has no suitable default branch.',
    fix: 'Pass an explicit base ref, or create/fetch the branch this one forked from.',
  },
  WORKTREE_BASE_NOT_FOUND: {
    status: 404,
    message: ({ base }: { base: string }) => `Base ref does not resolve to a commit: ${base}`,
    why: 'The caller named a base explicitly, but the repository has no such ref — usually a remote branch that was never fetched.',
    fix: 'Fetch the remote, or pick a base from the base-refs listing.',
  },
  WORKTREE_DIRTY: {
    status: 409,
    message: ({ fileCount, path }: { fileCount: number; path: string }) =>
      `Worktree ${path} has ${fileCount} uncommitted change(s)`,
    why: 'Removing the worktree would delete work that exists nowhere else: the files are modified or untracked and were never committed.',
    fix: 'Commit or discard the changes, or repeat the removal with force once the loss is intended.',
  },
  WORKTREE_MAIN_PROTECTED: {
    status: 400,
    message: ({ path }: { path: string }) => `${path} is the repository's main worktree`,
    why: 'The main worktree owns the object store every linked worktree reads from, so git itself refuses to remove it.',
    fix: 'Select a removable Platform worktree instead.',
  },
  WORKTREE_NOT_FOUND: {
    status: 404,
    message: ({ path }: { path: string }) =>
      `No worktree of this repository is checked out at ${path}`,
    why: 'Removal only ever targets a path git already reports as a worktree, so an unregistered path is refused rather than deleted from disk.',
    fix: 'List the worktrees and remove one of the paths it reports.',
  },
  WORKTREE_OUTSIDE_REPOSITORY: {
    status: 400,
    message: ({ path }: { path: string }) => `${path} is outside the managed worktree directory`,
    why: 'Managed worktrees must be direct children of the canonical Git common directory worktree root.',
    fix: 'Use a validated worktree identifier and inspect externally created worktrees manually.',
  },
})
