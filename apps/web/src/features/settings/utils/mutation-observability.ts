import { environmentLogContext } from '@/lib/environments/state/log-context'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { modelRefKey, type SettingId, type SettingsOperation } from '@workspace/contracts'

import type { ActiveSettingsIntent } from '@workspace/client-core/settings/intent-store'

export function settingsMutationLogContext(entry: ActiveSettingsIntent) {
  const metadata = operationMetadata(entry.patch.request.operations)

  return {
    ...environmentLogContext(originForQueryClient(entry.patch.owner)),
    affectedIds: metadata.affectedIds,
    clientSequence: entry.sequence,
    initiator: entry.patch.initiator,
    mutationId: entry.intentId,
    operationKinds: entry.patch.request.operations.map((operation) => operation.kind),
    settingIds: metadata.settingIds,
    target: entry.patch.request.target,
  }
}

function operationMetadata(operations: readonly SettingsOperation[]) {
  const settingIds: SettingId[] = []
  const affectedIds: string[] = []
  for (const operation of operations) appendOperationMetadata(operation, settingIds, affectedIds)

  return { affectedIds, settingIds }
}

function appendOperationMetadata(
  operation: SettingsOperation,
  settingIds: SettingId[],
  affectedIds: string[],
) {
  if (operation.kind === 'theme.customize' || operation.kind === 'theme.reset') {
    appendUnique(affectedIds, operation.id)
    return appendUnique(settingIds, 'workbench.theme.customizations')
  }
  if (operation.kind === 'set') return appendUnique(settingIds, operation.key)
  if (operation.kind === 'reset') {
    for (const key of operation.keys) appendUnique(settingIds, key)
    return
  }
  if (operation.kind === 'machine.set' || operation.kind === 'machine.remove') {
    appendUnique(settingIds, 'environments.machines')
    appendUnique(affectedIds, operation.name)
    return
  }
  if (operation.kind === 'keybinding.set' || operation.kind === 'keybinding.remove') {
    appendUnique(settingIds, 'keybindings.overrides')
    appendUnique(affectedIds, operation.command)
    return
  }
  if (operation.kind === 'model.setHidden') {
    appendUnique(settingIds, 'models.hidden')
    appendUnique(affectedIds, modelRefKey(operation.ref))
    return
  }
  if (operation.kind === 'model.setFavorite') {
    appendUnique(settingIds, 'models.favorites')
    appendUnique(affectedIds, modelRefKey(operation.ref))
    return
  }
  if (operation.kind === 'model.setOrder') {
    appendUnique(settingIds, 'models.order')
    for (const ref of operation.order) appendUnique(affectedIds, modelRefKey(ref))
    return
  }

  appendUnique(settingIds, 'providers.instances')
  appendUnique(affectedIds, operation.providerInstanceId)
}

function appendUnique<T>(target: T[], value: T) {
  if (!target.includes(value)) target.push(value)
}
