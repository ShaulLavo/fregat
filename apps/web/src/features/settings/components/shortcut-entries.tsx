import { useState } from 'react'
import * as v from 'valibot'
import { keybindingOverrideSchema, type KeybindingOverrides } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { ListRow } from '@workspace/ui/patterns/list-row'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import type { BindingResolutionEntry } from '@/keymap/active-bindings'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

export function ShortcutEntries({
  overrides,
  report,
}: {
  readonly overrides: KeybindingOverrides
  readonly report: readonly BindingResolutionEntry[]
}) {
  const { appendKeybinding, deleteKeybinding } = useSettingsActions()
  const [mode, setMode] = useState<'reservation' | 'unbind'>('reservation')
  const [keys, setKeys] = useState('')
  const [command, setCommand] = useState('')
  const [context, setContext] = useState('')
  const predicate = context.trim() ? { context: context.trim() } : {}
  const entry =
    mode === 'reservation'
      ? { keys, command: null, ...predicate }
      : { keys, unbind: command, ...predicate }
  const parsed = v.safeParse(keybindingOverrideSchema, entry)

  return (
    <Collapsible className='flex flex-col gap-2 py-2'>
      <CollapsibleTrigger className='text-muted-foreground focus-ring self-start rounded-md text-xs'>
        Authored bindings and reservations{' '}
        <span className='font-mono tabular-nums'>{overrides.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className='flex flex-col gap-2'>
        <p className='text-muted-foreground text-xs'>
          A reservation clears inherited bindings for keys in its context. An unbind removes one key
          and command pair. Delete an entry to restore the preset for that entry.
        </p>
        <div aria-label='Authored binding entries' role='list'>
          {overrides.map((binding, index) => {
            const command = 'unbind' in binding ? binding.unbind : binding.command
            const unknown = report.some(
              (entry) => entry.reason === 'unknown-command' && entry.command === command,
            )
            return (
              <ListRow className='min-w-0 gap-2' interactive={false} key={index} role='listitem'>
                <span
                  className='min-w-0 flex-1 truncate font-mono text-xs'
                  title={JSON.stringify(binding)}
                >
                  {JSON.stringify(binding)}
                </span>
                {unknown ? <span className='text-warning text-xs'>Unknown command</span> : null}
                <Button
                  aria-label={`Delete authored binding ${index + 1}`}
                  onClick={() => deleteKeybinding(index, overrides)}
                  size='sm'
                  variant='ghost'
                >
                  Delete
                </Button>
              </ListRow>
            )
          })}
        </div>
        <form
          className='flex flex-col gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            if (!parsed.success) return
            appendKeybinding(parsed.output)
            setKeys('')
            setCommand('')
          }}
        >
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value === 'reservation' || value === 'unbind') setMode(value)
            }}
          >
            <SelectTrigger aria-label='Binding entry kind' className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='reservation'>Reserve keys</SelectItem>
              <SelectItem value='unbind'>Unbind command</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label='Authored binding keys'
            autoComplete='off'
            placeholder='Keys, e.g. Mod+B'
            value={keys}
            onChange={(event) => setKeys(event.currentTarget.value)}
          />
          {mode === 'unbind' ? (
            <Input
              aria-label='Command to unbind'
              autoComplete='off'
              placeholder='Command ID'
              value={command}
              onChange={(event) => setCommand(event.currentTarget.value)}
            />
          ) : null}
          <Input
            aria-label='Authored binding context'
            autoComplete='off'
            placeholder='Context, e.g. Editor. Empty uses Workspace.'
            value={context}
            onChange={(event) => setContext(event.currentTarget.value)}
          />
          <Button className='self-start' disabled={!parsed.success} size='sm' type='submit'>
            Add entry
          </Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  )
}
