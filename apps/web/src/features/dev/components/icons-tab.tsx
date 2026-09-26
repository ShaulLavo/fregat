import { IconRuleGrid } from '@/features/dev/components/icon-rule-grid'
import { Section } from '@/features/dev/components/section'

/** Every file icon rule, to review glyphs and hues; switch the colour mode to see the other side. */
export function IconsTab() {
  return (
    <div className='flex flex-col gap-6 p-(--density-section-padding)'>
      <Section
        detail='Glyph at row and heading size, hue, and how many file names and extensions reach it.'
        title='File icons'
      >
        <IconRuleGrid />
      </Section>
    </div>
  )
}
