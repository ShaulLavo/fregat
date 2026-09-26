import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import type { McpPair } from '@/features/settings/utils/mcp'

/** Name and value rows for environment variables or headers; values are masked, since most are keys. */
export function McpPairsField({
  addLabel,
  keyPlaceholder,
  label,
  onChange,
  pairs,
}: {
  readonly addLabel: string
  readonly keyPlaceholder: string
  readonly label: string
  readonly onChange: (pairs: readonly McpPair[]) => void
  readonly pairs: readonly McpPair[]
}) {
  const id = useId()
  const update = (index: number, next: Partial<McpPair>) =>
    onChange(pairs.map((pair, at) => (at === index ? { ...pair, ...next } : pair)))

  return (
    <fieldset className='flex min-w-0 flex-col gap-1'>
      <legend className='text-muted-foreground text-2xs font-medium'>{label}</legend>
      {pairs.map((pair, index) => (
        <div className='flex min-w-0 items-center gap-(--density-control-gap)' key={index}>
          <Input
            aria-label={`${label} name ${index + 1}`}
            autoComplete='off'
            className='w-2/5 font-mono'
            id={`${id}-key-${index}`}
            onChange={(event) => update(index, { key: event.currentTarget.value })}
            placeholder={keyPlaceholder}
            spellCheck={false}
            value={pair.key}
          />
          <Input
            aria-label={`${label} value ${index + 1}`}
            autoComplete='off'
            className='min-w-0 flex-1 font-mono'
            onChange={(event) => update(index, { value: event.currentTarget.value })}
            placeholder='Value'
            spellCheck={false}
            type='password'
            value={pair.value}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`Remove ${label.toLowerCase()} row ${index + 1}`}
                  onClick={() => onChange(pairs.filter((_, at) => at !== index))}
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <XIcon />
                </Button>
              }
            />
            <TooltipContent>{`Remove ${label.toLowerCase()} row ${index + 1}`}</TooltipContent>
          </Tooltip>
        </div>
      ))}
      <Button
        className='self-start'
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
        size='sm'
        type='button'
        variant='ghost'
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </fieldset>
  )
}
