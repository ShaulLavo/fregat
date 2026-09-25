import { use, useState } from 'react'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxList,
  ComboboxTrigger,
} from '@workspace/ui/components/combobox'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'

import { FontOptionRow } from '@/features/settings/components/widgets/font-option-row'
import { FontSample } from '@/features/settings/components/widgets/font-sample'
import { useFontCatalog } from '@/features/settings/hooks/use-font-catalog'
import { useRecentFonts } from '@/features/settings/hooks/use-recent-fonts'
import {
  FontPreviewContext,
  type FontSettingId,
} from '@/features/settings/providers/font-preview-context'
import {
  fontOption,
  fontPickerGroups,
  savedFontStyle,
  type FontOption,
  type FontOptionGroup,
} from '@/features/settings/utils/font-options'

const SKELETON_ROWS = 6

/**
 * An autocomplete, not a catalog browser: it opens on recent and curated fonts, and typing
 * searches every Nerd Font and Fontsource family. Hovering a row shows the whole app in it;
 * Escape puts the saved font back and Enter writes the setting.
 */
export function FontWidget({
  disabled,
  id,
  onChange,
  value,
}: {
  disabled?: boolean
  id: FontSettingId
  onChange: (next: string) => void
  value: string
}) {
  const role = id === 'workbench.fontFamily' ? 'ui' : 'code'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const catalog = useFontCatalog(open)
  const recent = useRecentFonts(id, value)
  const preview = use(FontPreviewContext)
  const groups = fontPickerGroups(query, role, recent, catalog.data)
  const current = fontOption(value, catalog.data)
  const searching = query.trim() !== ''
  const label = role === 'ui' ? 'Interface font' : 'Code font'

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) return

    setQuery('')
    preview?.clearFontPreview()
  }
  const choose = (option: FontOption | null) => {
    if (option && option.ref !== value) onChange(option.ref)
    preview?.clearFontPreview()
  }
  const highlight = (option: FontOption | undefined) => {
    if (!option) return

    preview?.previewFont(id, option.ref)
  }

  return (
    <Combobox<FontOption>
      disabled={disabled}
      filter={null}
      filteredItems={groups}
      inputValue={query}
      isItemEqualToValue={(item, selected) => item.ref === selected.ref}
      itemToStringLabel={(option) => option.label}
      items={groups}
      onInputValueChange={setQuery}
      onItemHighlighted={highlight}
      onOpenChange={changeOpen}
      onValueChange={choose}
      open={open}
      value={current}
    >
      <ComboboxTrigger
        aria-label={label}
        className='w-56 @max-3xl/settings:flex-1'
        id={id}
        title={`${current.label} (${value})`}
      >
        <FontSample
          fontRef={value}
          role={role}
          serverSample={current.listed}
          text={current.label}
        />
      </ComboboxTrigger>
      <ComboboxContent className='max-h-96 w-80' style={savedFontStyle(role, value)}>
        <ComboboxInput
          aria-label={`Search ${label.toLowerCase()}s`}
          placeholder={role === 'ui' ? 'Search fonts…' : 'Search code fonts…'}
        />
        {searching && catalog.isError ? (
          <p className='text-muted-foreground text-2xs px-(--density-row-padding-x)'>
            {'The font catalog is unavailable; showing bundled and installed fonts.'}
          </p>
        ) : null}
        {searching && catalog.isPending ? (
          <LoadingState label='Loading the font catalog'>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div className={listRowClassName({ interactive: false })} key={index}>
                <span className='bg-muted h-2 w-32 rounded-md' />
              </div>
            ))}
          </LoadingState>
        ) : (
          <ComboboxList>
            {(group: FontOptionGroup) => (
              <ComboboxGroup items={group.items} key={group.value || 'results'}>
                {group.value ? <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel> : null}
                <ComboboxCollection>
                  {(option: FontOption) => (
                    <FontOptionRow key={option.ref} option={option} role={role} />
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        )}
        <ComboboxEmpty>{'No font matches that name.'}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  )
}
