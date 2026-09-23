import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'
import {
  providerModelOptions,
  type ProviderModelOption,
} from '@workspace/client-core/chat/providers/models'
import { createProviderCatalog } from '@/agent-models/state/catalog'
import { modelSelectionEffort } from '@workspace/client-core/chat/providers/options'
import { ModelChoices } from '@/agent-models/components/choices'
import { ModelEffort } from '@/agent-models/components/effort'
import { ProviderAccount } from '@/agent-models/components/account'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { OrbitLoader } from '@/components/orbit-loader'
import { useCommands } from '@/commands/hooks/use-commands'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import type { SettingsSession, SessionState } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'

type Modal =
  | { kind: 'closed' }
  | { kind: 'models' }
  | { kind: 'effort'; option: ProviderModelOption }
  | { kind: 'account'; provider: ProviderSnapshot }

export function ModelPicker({
  session,
  ready,
  value,
  onSelect,
  onCatalog,
  theme,
  enabled,
}: {
  readonly session: SettingsSession
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly value: ModelSelection | null
  readonly onSelect: (value: ModelSelection) => void
  readonly onCatalog?: (providers: readonly ProviderSnapshot[]) => void
  readonly theme: Theme
  readonly enabled: boolean
}) {
  const commands = useCommands()
  const [store] = useState(() => createProviderCatalog(session.client))
  const catalog = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [modal, setModal] = useState<Modal>({ kind: 'closed' })
  const hidden = useSettingValue(ready.owner, 'models.hidden')
  const order = useSettingValue(ready.owner, 'models.order')
  useEffect(() => {
    void store.refresh()
    return () => store.dispose()
  }, [store])
  useEffect(() => {
    if (value !== null || catalog.kind !== 'ready') return
    const fallback = providerModelOptions(catalog.providers, { hidden, order }).find(
      (option) => !option.disabledReason,
    )
    if (fallback) onSelect(fallback.modelSelection)
  }, [catalog, value, hidden, order, onSelect])
  useEffect(() => {
    if (catalog.kind === 'ready') onCatalog?.(catalog.providers)
  }, [catalog, onCatalog])
  function close() {
    setModal({ kind: 'closed' })
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'agent-composer',
    })
  }
  function select(selection: ModelSelection) {
    onSelect(selection)
    close()
  }
  function pick(option: ProviderModelOption) {
    if (option.effortLevels.length) {
      setModal({ kind: 'effort', option })
      return
    }
    select(option.modelSelection)
  }
  useCommandHandlers(
    {
      'chat.openModelPicker': { run: () => setModal({ kind: 'models' }) },
    },
    enabled && modal.kind === 'closed',
  )
  const provider = catalog.providers.find(
    (item) => item.providerInstanceId === value?.providerInstanceId,
  )
  const label =
    provider?.models.find((model) => model.slug === value?.model)?.shortName ??
    value?.model ??
    'Choose model'
  const effort = modelSelectionEffort(value)
  return (
    <box flexDirection='column' flexShrink={1} minWidth={0}>
      <box flexDirection='row' gap={1} height={1}>
        {catalog.kind === 'loading' && <OrbitLoader theme={theme} />}
        <text
          fg={theme.primary}
          onMouseDown={() => {
            if (enabled) setModal({ kind: 'models' })
          }}
        >
          {label}
          {effort ? ` · ${effort}` : ''}
          {' ▾'}
        </text>
      </box>
      {catalog.error && <text fg={theme.destructive}>{catalog.error}</text>}
      {modal.kind === 'models' && (
        <ModelChoices
          providers={catalog.providers}
          loading={catalog.kind === 'loading'}
          error={catalog.error}
          preferences={{ hidden, order }}
          value={value}
          theme={theme}
          onSelect={pick}
          onAccount={(item) => setModal({ kind: 'account', provider: item })}
          onClose={close}
          onRefresh={() => {
            void store.refresh()
          }}
        />
      )}
      {modal.kind === 'effort' && (
        <ModelEffort
          option={modal.option}
          theme={theme}
          onSelect={select}
          onClose={() => setModal({ kind: 'models' })}
        />
      )}
      {modal.kind === 'account' && (
        <ProviderAccount
          client={session.client}
          provider={modal.provider}
          theme={theme}
          record={session.record}
          onClose={() => {
            void store.refresh()
            setModal({ kind: 'models' })
          }}
        />
      )}
    </box>
  )
}
