import type { FontRole } from '@workspace/contracts'
import { ComboboxItem } from '@workspace/ui/components/combobox'

import { FontSample } from '@/features/settings/components/widgets/font-sample'
import { fontSampleText, type FontOption } from '@/features/settings/utils/font-options'

/** One picker row: the family's name and a sample, both set in the family itself. */
export function FontOptionRow({ option, role }: { option: FontOption; role: FontRole }) {
  const sample = fontSampleText(role)
  // One subset holds both strings, so a row costs one small request.
  const glyphs = `${option.label}${sample}`

  return (
    <ComboboxItem title={`${option.label} · ${option.detail} (${option.ref})`} value={option}>
      <FontSample
        className='min-w-0 shrink'
        fontRef={option.ref}
        role={role}
        sampleText={glyphs}
        serverSample={option.listed}
        text={option.label}
      />
      <FontSample
        className='text-muted-foreground ml-auto min-w-0 flex-1 text-right'
        fontRef={option.ref}
        role={role}
        sampleText={glyphs}
        serverSample={option.listed}
        text={sample}
      />
      <span className='text-muted-foreground text-3xs shrink-0'>{option.source}</span>
    </ComboboxItem>
  )
}
