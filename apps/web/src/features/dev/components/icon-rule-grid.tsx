import { FileTypeIcon } from '@/components/file-type-icon'
import { iconRuleSamples } from '@/features/dev/utils/icon-rule-samples'

/** Every file icon rule: its glyph at row and heading size, its hue, and what it matches. */
export function IconRuleGrid() {
  return (
    <div className='bg-background text-foreground grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-1 p-(--density-section-padding)'>
      {iconRuleSamples().map((sample) => (
        <div className='flex min-w-0 items-center gap-(--density-control-gap)' key={sample.name}>
          <FileTypeIcon className='size-(--icon-size-sm) shrink-0' icon={{ name: sample.name }} />
          <FileTypeIcon className='size-(--icon-size) shrink-0' icon={{ name: sample.name }} />
          <span className='min-w-0 truncate text-xs' title={sample.matches.join(' ')}>
            {sample.name}
          </span>
          <span className='text-muted-foreground text-2xs ml-auto shrink-0 font-mono'>
            {sample.hue} · {sample.matches.length}
          </span>
        </div>
      ))}
    </div>
  )
}
