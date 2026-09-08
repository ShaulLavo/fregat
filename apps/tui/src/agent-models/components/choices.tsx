import { useRef, useState } from 'react'
import type { ModelSelection, ProviderSnapshot } from '@workspace/contracts'
import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'
import { modelChoiceRows } from '@/agent-models/utils/choices'
import type { ModelPreferences } from '@workspace/client-core/chat/providers/preferences'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { LoadingState } from '@/components/loading-state'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import type { Theme } from '@/theme/utils/theme'

export function ModelChoices({
  providers,
  loading,
  error,
  preferences,
  value,
  theme,
  onSelect,
  onAccount,
  onClose,
  onRefresh,
}: {
  readonly providers: readonly ProviderSnapshot[]
  readonly loading: boolean
  readonly error: string | null
  readonly preferences: ModelPreferences
  readonly value: ModelSelection | null
  readonly theme: Theme
  readonly onSelect: (option: ProviderModelOption) => void
  readonly onAccount: (provider: ProviderSnapshot) => void
  readonly onClose: () => void
  readonly onRefresh: () => void
}) {
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [selected, updateSelection] = useState(0)
  const latestSelection = useRef(0)
  function setSelected(index: number) {
    latestSelection.current = index
    updateSelection(index)
  }
  const [message, setMessage] = useState('')
  const options = modelChoiceRows({ providers, preferences, value, query })
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-model-filter',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  function choose(index = latestSelection.current, submittedQuery = query) {
    const submittedOptions =
      submittedQuery === query
        ? options
        : modelChoiceRows({ providers, preferences, value, query: submittedQuery })
    const option = submittedOptions[index]?.value
    if (!option) return
    if (option.kind === 'account') {
      onAccount(option.provider)
      return
    }
    if (option.kind === 'refresh') {
      onRefresh()
      return
    }
    if (option.option.disabledReason) {
      setMessage(option.option.disabledReason.message)
      return
    }
    onSelect(option.option)
  }
  return (
    <Dialog title='Choose model' theme={theme} width={82} height={24} onClose={onClose}>
      <Prompt
        id='agent-model-filter'
        value={query}
        onChange={(text) => {
          setQuery(text)
          setSelected(0)
        }}
        onSubmit={(text) => choose(latestSelection.current, text)}
        theme={theme}
        placeholder='Filter models or providers…'
      />
      <Select
        options={options}
        selectedIndex={selected}
        onChange={setSelected}
        onSelect={(index) => choose(index)}
        navigateFromInput
        flexGrow={1}
        minHeight={0}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
      {loading && <LoadingState theme={theme} label='Reading models…' />}
      {error && <text fg={theme.destructive}>{error}</text>}
      {message && <text fg={theme.warning}>{message}</text>}
    </Dialog>
  )
}
