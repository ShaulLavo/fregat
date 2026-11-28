import { useIsMutating } from '@tanstack/react-query'
import type { ProviderMcpScope, ProviderSnapshot } from '@workspace/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { DeleteDialogFooter } from '@workspace/ui/patterns/delete-dialog-footer'

import { InlineError } from '@/components/inline-error'
import { useRemoveMcpServer } from '@/features/settings/hooks/use-remove-mcp-server'
import { mcpScopePlace } from '@/features/settings/utils/mcp'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'

export function McpRemoveDialog({
  folder,
  instance,
  onClose,
  scope,
  serverName,
}: {
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly onClose: () => void
  readonly scope: ProviderMcpScope
  readonly serverName: string
}) {
  const remove = useRemoveMcpServer(instance.providerInstanceId, serverName)
  const pending =
    useIsMutating(
      { mutationKey: settingsMutationKeys.mcp.remove(instance.providerInstanceId, serverName) },
      useSettingsOwner(),
    ) > 0

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      open
    >
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Delete {serverName}?</DialogTitle>
          <DialogDescription>
            Deletes its definition, with any keys typed into it, from {instance.displayLabel}’s{' '}
            {mcpScopePlace(scope)}.
          </DialogDescription>
        </DialogHeader>
        {remove.isError && !pending ? (
          <InlineError
            message={clientErrorDescription(toClientError(remove.error))}
            title={`Delete ${serverName}`}
          />
        ) : null}
        <DeleteDialogFooter
          cancelDisabled={pending}
          confirmDisabled={pending}
          onCancel={onClose}
          onConfirm={() => remove.mutate({ folder, scope }, { onSuccess: onClose })}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  )
}
