/**
 * Every git mutation carries its repository root right after the prefix, so a
 * panel can watch only its own repository. A chat session's worktree is its own
 * root: its failures must not surface in the project's git panel.
 */
export const gitMutationScope = (rootPath: string) => ['git', 'mutation', rootPath] as const

/** A clone has no repository yet, so it sits outside every repository's scope. */
export const cloneMutationKey = ['git', 'clone'] as const

export const mutationKeys = {
  checkout: (rootPath: string) => ['git', 'mutation', rootPath, 'checkout'] as const,
  commit: (rootPath: string) => ['git', 'mutation', rootPath, 'commit'] as const,
  createBranch: (rootPath: string) => ['git', 'mutation', rootPath, 'create-branch'] as const,
  createPullRequest: (rootPath: string) =>
    ['git', 'mutation', rootPath, 'create-pull-request'] as const,
  discard: (rootPath: string, paths: readonly string[]) =>
    ['git', 'mutation', rootPath, 'discard', ...paths] as const,
  discardStaged: (rootPath: string, paths: readonly string[]) =>
    ['git', 'mutation', rootPath, 'discard-staged', ...paths] as const,
  fetch: (rootPath: string) => ['git', 'mutation', rootPath, 'fetch'] as const,
  initSubmodules: (rootPath: string) => ['git', 'mutation', rootPath, 'init-submodules'] as const,
  publish: (rootPath: string) => ['git', 'mutation', rootPath, 'publish'] as const,
  pull: (rootPath: string) => ['git', 'mutation', rootPath, 'pull'] as const,
  push: (rootPath: string) => ['git', 'mutation', rootPath, 'push'] as const,
  pushAndOpenPullRequest: (rootPath: string) =>
    ['git', 'mutation', rootPath, 'push-and-open-pull-request'] as const,
  stage: (rootPath: string, path: string) => ['git', 'mutation', rootPath, 'stage', path] as const,
  stageMany: (rootPath: string, paths: readonly string[]) =>
    ['git', 'mutation', rootPath, 'stage-many', ...paths] as const,
  sync: (rootPath: string) => ['git', 'mutation', rootPath, 'sync'] as const,
  unstage: (rootPath: string, path: string) =>
    ['git', 'mutation', rootPath, 'unstage', path] as const,
  unstageMany: (rootPath: string, paths: readonly string[]) =>
    ['git', 'mutation', rootPath, 'unstage-many', ...paths] as const,
}
