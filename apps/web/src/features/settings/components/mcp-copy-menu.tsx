import { CopySimpleIcon } from '@phosphor-icons/react'
import type { ProviderMcpScope, ProviderSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { useCopyMcpServer } from '@/features/settings/hooks/use-copy-mcp-server'

/** "Also add to …": the same definition written through the other agent’s own config tool. */
export function McpCopyMenu({
  busy,
  folder,
  instance,
  scope,
  serverName,
  targets,
}: {
  readonly busy: boolean
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly scope: ProviderMcpScope
  readonly serverName: string
  readonly targets: readonly ProviderSnapshot[]
}) {
  const copy = useCopyMcpServer(instance.providerInstanceId, serverName)
  const label = `Also add ${serverName} to…`

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  aria-label={label}
                  disabled={busy}
                  focusableWhenDisabled
                  size='icon-sm'
                  variant='ghost'
                >
                  {busy ? <Spinner /> : <CopySimpleIcon />}
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className='w-56'>
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.providerInstanceId}
            onClick={() =>
              copy.mutate({
                body: {
                  folder,
                  scope,
                  target: { providerInstanceId: target.providerInstanceId },
                },
                targetLabel: target.displayLabel,
              })
            }
          >
            Also add to {target.displayLabel}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
