import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'

export type ReviewerOption = {
  readonly value: string
  readonly label: string
  readonly selection: ModelSelection
}

/** Every model a ready provider offers, as one list; the user picks the reviewer per request. */
export function reviewerOptions(providers: readonly ProviderSnapshot[]): ReviewerOption[] {
  return providers
    .filter((provider) => provider.enabled && provider.status === 'ready')
    .flatMap((provider) =>
      provider.models.map((model) => ({
        value: `${provider.providerInstanceId}/${model.slug}`,
        label: `${provider.displayLabel} · ${model.shortName ?? model.name}`,
        selection: { providerInstanceId: provider.providerInstanceId, model: model.slug },
      })),
    )
}

export type ReviewTargetKind = 'turn' | 'uncommitted' | 'branch' | 'commit'

export const REVIEW_TARGET_OPTIONS: readonly { value: ReviewTargetKind; label: string }[] = [
  { value: 'turn', label: 'Latest turn' },
  { value: 'uncommitted', label: 'Uncommitted changes' },
  { value: 'branch', label: 'Branch against its base' },
  { value: 'commit', label: 'One commit' },
]
