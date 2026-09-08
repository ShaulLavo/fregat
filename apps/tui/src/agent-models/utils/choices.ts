import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'
import {
  providerModelOptions,
  type ProviderModelOption,
} from '@workspace/client-core/chat/providers/models'
import type { ModelPreferences } from '@workspace/client-core/chat/providers/preferences'

type Choice =
  | { readonly kind: 'model'; readonly option: ProviderModelOption }
  | { readonly kind: 'account'; readonly provider: ProviderSnapshot }
  | { readonly kind: 'refresh' }

type Row = { readonly name: string; readonly description: string; readonly value: Choice }

export function modelChoiceRows({
  providers,
  preferences,
  value,
  query,
}: {
  readonly providers: readonly ProviderSnapshot[]
  readonly preferences: ModelPreferences
  readonly value: ModelSelection | null
  readonly query: string
}): Row[] {
  const needle = query.toLowerCase()
  const models = providerModelOptions(providers, preferences).filter((option) =>
    `${option.name} ${option.providerLabel}`.toLowerCase().includes(needle),
  )
  return [
    ...models.map((option): Row => ({
      name: `${value?.providerInstanceId === option.providerInstanceId && value.model === option.modelSelection.model ? '✓ ' : ''}${option.label}`,
      description: option.disabledReason?.message ?? option.providerLabel,
      value: { kind: 'model', option },
    })),
    ...providers
      .filter((provider) => provider.displayLabel.toLowerCase().includes(needle))
      .map((provider): Row => ({
        name: `${provider.displayLabel} account`,
        description: provider.auth.status,
        value: { kind: 'account', provider },
      })),
    {
      name: 'Refresh providers',
      description: 'Check installed models and account state',
      value: { kind: 'refresh' },
    },
  ]
}
