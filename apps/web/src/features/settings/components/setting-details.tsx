import { InfoIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

/** Why a setting's default is what it is, behind an info icon after the row title. */
export function SettingDetails({ details, title }: { details: string; title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={`About ${title}`} className='-my-1' size='icon-xs' variant='ghost'>
            <InfoIcon aria-hidden className='size-(--icon-size-sm)' />
          </Button>
        }
      />
      <TooltipContent>
        <div className='flex flex-col gap-(--density-copy-paragraph-gap)'>
          {details.split('\n\n').map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
