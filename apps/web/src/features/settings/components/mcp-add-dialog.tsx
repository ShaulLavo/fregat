import { useIsMutating } from '@tanstack/react-query'
import { useId, useState } from 'react'
import {
  providerMcpAddBodySchema,
  type ProviderMcpScope,
  type ProviderSnapshot,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import * as v from 'valibot'

import { InlineError } from '@/components/inline-error'
import { McpPairsField } from '@/features/settings/components/mcp-pairs-field'
import { useAddMcpServer } from '@/features/settings/hooks/use-add-mcp-server'
import {
  mcpPairsRecord,
  mcpScopeLabel,
  parseMcpArgs,
  type McpPair,
} from '@/features/settings/utils/mcp'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

type Draft = {
  readonly name: string
  readonly scope: ProviderMcpScope
  readonly transport: 'stdio' | 'http'
  readonly command: string
  readonly args: string
  readonly env: readonly McpPair[]
  readonly url: string
  readonly headers: readonly McpPair[]
}

const EMPTY_DRAFT: Draft = {
  name: '',
  scope: 'user',
  transport: 'stdio',
  command: '',
  args: '',
  env: [],
  url: '',
  headers: [],
}

export function McpAddDialog({
  folder,
  instance,
  onClose,
  scopes,
}: {
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly onClose: () => void
  readonly scopes: readonly ProviderMcpScope[]
}) {
  const id = useId()
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [invalid, setInvalid] = useState<string | null>(null)
  const add = useAddMcpServer(instance.providerInstanceId, instance.displayLabel)
  const pending =
    useIsMutating(
      { mutationKey: settingsMutationKeys.mcp.add(instance.providerInstanceId) },
      useSettingsOwner(),
    ) > 0
  const update = (next: Partial<Draft>) => setDraft({ ...draft, ...next })

  function submit() {
    const parsed = v.safeParse(providerMcpAddBodySchema, {
      name: draft.name,
      scope: draft.scope,
      folder,
      definition:
        draft.transport === 'http'
          ? { transport: 'http', url: draft.url, headers: mcpPairsRecord(draft.headers) }
          : {
              transport: 'stdio',
              command: draft.command,
              args: parseMcpArgs(draft.args),
              env: mcpPairsRecord(draft.env),
            },
    })
    if (!parsed.success) {
      setInvalid(parsed.issues[0].message)
      return
    }
    setInvalid(null)
    add.mutate(parsed.output, { onSuccess: onClose })
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      open
    >
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Add an MCP server to {instance.displayLabel}</DialogTitle>
          <DialogDescription>
            Written with {instance.displayLabel}’s own config tool. Values stay in its config file.
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex min-w-0 flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className='flex flex-col gap-1'>
            <label className='text-muted-foreground text-2xs font-medium' htmlFor={`${id}-name`}>
              Name
            </label>
            <Input
              autoComplete='off'
              autoFocus
              className='font-mono'
              id={`${id}-name`}
              onChange={(event) => update({ name: event.currentTarget.value })}
              placeholder='linear'
              spellCheck={false}
              value={draft.name}
            />
          </div>
          {scopes.length > 1 ? (
            <div className='flex flex-col gap-1'>
              <label className='text-muted-foreground text-2xs font-medium' htmlFor={`${id}-scope`}>
                Where
              </label>
              <Select
                onValueChange={(next) => {
                  const scope = scopes.find((entry) => entry === next)
                  if (scope) update({ scope })
                }}
                value={draft.scope}
              >
                <SelectTrigger id={`${id}-scope`}>
                  <SelectValue>{mcpScopeLabel(draft.scope)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((scope) => (
                    <SelectItem disabled={scope !== 'user' && !folder} key={scope} value={scope}>
                      {mcpScopeLabel(scope)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {folder ? null : (
                <p className='text-muted-foreground text-2xs'>
                  Local and project servers need a folder: choose one above the list.
                </p>
              )}
            </div>
          ) : null}
          <Tabs
            onValueChange={(next: string) =>
              update({ transport: next === 'http' ? 'http' : 'stdio' })
            }
            value={draft.transport}
          >
            <TabsList aria-label='How it connects' variant='segmented'>
              <TabsTab value='stdio'>Command</TabsTab>
              <TabsTab value='http'>HTTP</TabsTab>
            </TabsList>
          </Tabs>
          {draft.transport === 'stdio' ? (
            <>
              <div className='flex flex-col gap-1'>
                <label
                  className='text-muted-foreground text-2xs font-medium'
                  htmlFor={`${id}-command`}
                >
                  Command
                </label>
                <Input
                  autoComplete='off'
                  className='font-mono'
                  id={`${id}-command`}
                  onChange={(event) => update({ command: event.currentTarget.value })}
                  placeholder='npx'
                  spellCheck={false}
                  value={draft.command}
                />
              </div>
              <div className='flex flex-col gap-1'>
                <label
                  className='text-muted-foreground text-2xs font-medium'
                  htmlFor={`${id}-args`}
                >
                  Arguments
                </label>
                <Input
                  autoComplete='off'
                  className='font-mono'
                  id={`${id}-args`}
                  onChange={(event) => update({ args: event.currentTarget.value })}
                  placeholder='-y @modelcontextprotocol/server-filesystem ~/notes'
                  spellCheck={false}
                  value={draft.args}
                />
              </div>
              <McpPairsField
                addLabel='Add variable'
                keyPlaceholder='API_KEY'
                label='Environment'
                onChange={(env) => update({ env })}
                pairs={draft.env}
              />
            </>
          ) : (
            <>
              <div className='flex flex-col gap-1'>
                <label className='text-muted-foreground text-2xs font-medium' htmlFor={`${id}-url`}>
                  Server address
                </label>
                <Input
                  autoComplete='off'
                  className='font-mono'
                  id={`${id}-url`}
                  onChange={(event) => update({ url: event.currentTarget.value })}
                  placeholder='https://mcp.example.com/mcp'
                  spellCheck={false}
                  value={draft.url}
                />
              </div>
              <McpPairsField
                addLabel='Add header'
                keyPlaceholder='Authorization'
                label='Headers'
                onChange={(headers) => update({ headers })}
                pairs={draft.headers}
              />
            </>
          )}
          {invalid ? <InlineError message={invalid} title='Check the server' /> : null}
          {add.isError && !pending ? (
            <InlineError
              message={clientErrorDescription(toClientError(add.error))}
              title={`Add ${draft.name}`}
            />
          ) : null}
          <DialogFooter>
            <Button disabled={pending} onClick={onClose} type='button' variant='outline'>
              Cancel
            </Button>
            <Button disabled={pending} type='submit'>
              {pending ? <Spinner /> : null}
              Add server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
