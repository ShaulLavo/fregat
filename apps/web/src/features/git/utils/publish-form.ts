import type { GitForgeKind } from '@workspace/contracts'

export const FORGE_OPTIONS: readonly {
  kind: GitForgeKind
  label: string
  host: string
  example: string
}[] = [
  { kind: 'github', label: 'GitHub', host: 'github.com', example: 'owner/name' },
  { kind: 'gitlab', label: 'GitLab', host: 'gitlab.com', example: 'group/name' },
  { kind: 'forgejo', label: 'Forgejo', host: 'codeberg.org', example: 'owner/name' },
  {
    kind: 'azure-devops',
    label: 'Azure DevOps',
    host: 'dev.azure.com',
    example: 'organization/project/name',
  },
  { kind: 'bitbucket', label: 'Bitbucket', host: 'bitbucket.org', example: 'workspace/name' },
]

export function forgeOption(kind: GitForgeKind) {
  return FORGE_OPTIONS.find((option) => option.kind === kind) ?? FORGE_OPTIONS[0]!
}
