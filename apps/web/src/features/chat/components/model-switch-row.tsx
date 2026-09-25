import type { ModelSelection } from '@workspace/contracts'

import { useProvider } from '@/features/chat/hooks/use-provider'
import { modelSwitchLabel, type ModelSwitchKind } from '@/features/chat/utils/model-switch'

export function ModelSwitchRow({
  kind,
  selection,
}: {
  kind: ModelSwitchKind
  selection: ModelSelection
}) {
  const provider = useProvider(selection.providerInstanceId)
  const label = modelSwitchLabel(kind, provider, selection)

  return (
    <p
      className='text-muted-foreground text-2xs flex h-5 items-center px-1'
      data-model-switch={kind}
      title={label}
    >
      <span className='truncate'>{label}</span>
    </p>
  )
}
