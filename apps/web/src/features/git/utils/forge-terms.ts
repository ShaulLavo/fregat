import type { GitForge } from '@workspace/contracts'

/** What the forge calls a change request: GitLab says merge request, the rest pull request. */
export function changeRequestLabel(forge: GitForge | null | undefined) {
  return forge?.kind === 'gitlab' ? 'Merge request' : 'Pull request'
}
