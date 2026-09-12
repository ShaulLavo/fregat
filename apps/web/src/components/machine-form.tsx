import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { CaretRightIcon, PlugsConnectedIcon } from '@phosphor-icons/react'
import { MachineConnectionOption } from '@/components/machine-connection-option'
import { SshHostPicker } from '@/features/environments/components/ssh-host-picker'
import { useId } from 'react'

import { useMachineForm, type MachineFormOptions } from '@/hooks/use-machine-form'

export function MachineForm(props: MachineFormOptions) {
  const id = useId()
  const { name } = props
  const { draft, error, saving, optionsOpen, setOptionsOpen, update, save, cancel, submitLabel } =
    useMachineForm(props)

  return (
    <form className='flex flex-col gap-5' onSubmit={(event) => void save(event)}>
      <fieldset className='grid min-w-0 gap-4 sm:grid-cols-2' disabled={saving}>
        <div
          role='group'
          aria-label='Connection method'
          className='grid gap-3 sm:col-span-2 sm:grid-cols-2'
        >
          <MachineConnectionOption
            kind='origin'
            selected={draft.kind === 'origin'}
            onSelect={() => update('kind', 'origin')}
          />
          <MachineConnectionOption
            kind='ssh'
            selected={draft.kind === 'ssh'}
            onSelect={() => update('kind', 'ssh')}
          />
        </div>
        {draft.kind === 'ssh' ? (
          <>
            <SshHostPicker
              id={`${id}-target`}
              value={draft.target}
              onChange={(target) => update('target', target)}
            />
            <p className='text-muted-foreground text-xs sm:col-span-2'>
              Platform finds its server automatically. Add projects after connecting.
            </p>
          </>
        ) : (
          <div className='flex flex-col gap-1 sm:col-span-2'>
            <label className='text-xs font-medium' htmlFor={`${id}-url`}>
              Server URL
            </label>
            <Input
              id={`${id}-url`}
              value={draft.url}
              onChange={(event) => update('url', event.currentTarget.value)}
              placeholder='https://machine.example.com'
              spellCheck={false}
            />
          </div>
        )}
        <Collapsible open={optionsOpen} onOpenChange={setOptionsOpen} className='sm:col-span-2'>
          <CollapsibleTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='text-muted-foreground group -ml-2'
              />
            }
          >
            <CaretRightIcon className='size-3 group-data-panel-open:rotate-90' />
            Options
          </CollapsibleTrigger>
          <CollapsibleContent className='grid gap-4 pt-3 sm:grid-cols-2'>
            {draft.kind === 'ssh' ? (
              <div className='flex flex-col gap-1'>
                <label className='text-xs font-medium' htmlFor={`${id}-port`}>
                  Remote server port
                </label>
                <Input
                  id={`${id}-port`}
                  className='tabular-nums'
                  type='number'
                  min={1}
                  max={65535}
                  value={draft.remotePort}
                  onChange={(event) => update('remotePort', event.currentTarget.value)}
                  placeholder='Automatic'
                />
              </div>
            ) : null}
            <div className='flex flex-col gap-1'>
              <label className='text-xs font-medium' htmlFor={`${id}-name`}>
                Machine name
              </label>
              <Input
                id={`${id}-name`}
                disabled={name !== undefined}
                value={draft.name}
                onChange={(event) => update('name', event.currentTarget.value)}
                placeholder='Automatic from server address'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs font-medium' htmlFor={`${id}-label`}>
                Display label <span className='text-muted-foreground font-normal'>optional</span>
              </label>
              <Input
                id={`${id}-label`}
                value={draft.label}
                onChange={(event) => update('label', event.currentTarget.value)}
                placeholder='Optional label'
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </fieldset>
      {error ? (
        <p role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      ) : null}
      <div className='flex flex-col gap-2'>
        <Button type='submit' variant='outline' className='w-full' disabled={saving}>
          {saving ? <Spinner /> : <PlugsConnectedIcon className='size-3.5' />}
          {submitLabel}
        </Button>
        <Button type='button' variant='ghost' onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
