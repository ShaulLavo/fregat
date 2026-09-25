import { NotificationModeWidget } from '@/features/settings/components/widgets/notification-mode-widget'
import { ThemeWidget } from '@/features/settings/components/widgets/theme-widget'
import { WallpaperWidget } from '@/features/settings/components/widgets/wallpaper-widget'
import {
  descriptorFor,
  SCALAR_SETTING_IDS,
  settingControl,
  settingRowIds,
  type SettingId,
  type ScalarSettingId,
  type SettingsValues,
  type SettingValue,
} from '@workspace/contracts'

import { KeybindingSection } from '@/features/settings/components/keybinding-section'
import { ModelSection } from '@/features/settings/components/model-section'
import { MachinesSection } from '@/features/settings/components/machines-section'
import { ProviderSection } from '@/features/settings/components/provider-section'
import { RowActions } from '@/features/settings/components/row-actions'
import { BooleanWidget } from '@/features/settings/components/widgets/boolean-widget'
import { CodeThemeWidget } from '@/features/settings/components/widgets/code-theme-widget'
import { EnumWidget } from '@/features/settings/components/widgets/enum-widget'
import { isFontSettingId } from '@/features/settings/utils/font-options'
import { FontWidget } from '@/features/settings/components/widgets/font-widget'
import { NumberWidget } from '@/features/settings/components/widgets/number-widget'
import { PaletteWidget } from '@/features/settings/components/widgets/palette-widget'
import { StringWidget } from '@/features/settings/components/widgets/string-widget'
import { settingInspection } from '@/features/settings/hooks/use-setting-inspection'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import type { SettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsScope, writableSettingsScope } from '@/features/settings/state/scope-store'
import { settingRowTitle } from '@workspace/client-core/settings/humanize'
import { cn } from '@workspace/ui/lib/utils'

export function SettingRow({ id, snapshot }: { id: SettingId; snapshot: SettingsProjection }) {
  const descriptor = descriptorFor(id)
  const scope = writableSettingsScope(useSettingsScope())
  const { setSetting } = useSettingsActions()
  const inspection = settingInspection(id, snapshot, scope)
  const { alsoModifiedIn, isModified, overriddenBy } = inspection
  // A read-only key is shown, not hidden: the answer to "why is this off" belongs
  // on the page rather than in a commit message. It outranks the scope reason —
  // no scope makes a read-only key writable.
  const disabledReason = descriptor.readOnlyReason ?? inspection.disabledReason
  const value = snapshot.values[id]
  const hasCodePreview =
    descriptor.widget === 'code-theme' ||
    descriptor.widget === 'palette' ||
    descriptor.widget === 'wallpaper'

  return (
    <div
      className={cn(
        'flex flex-col gap-(--density-control-gap) py-(--density-section-padding) @3xl/settings:items-start @3xl/settings:justify-between @3xl/settings:gap-6',
        descriptor.widget !== 'theme' && '@3xl/settings:flex-row',
      )}
    >
      <div className='flex min-w-0 flex-col gap-1 @max-3xl/settings:wrap-anywhere'>
        <div className='flex flex-wrap items-center gap-2'>
          {/* A border, not a coloured dot: it reads in both themes without a
              palette literal, which the theme tokens would otherwise forbid. */}
          {isModified ? (
            <span
              aria-label='Modified'
              className='bg-info h-3 w-0.5 shrink-0 rounded-full'
              title='Modified from the default'
            />
          ) : null}
          <label className='text-foreground text-sm font-medium' htmlFor={id}>
            {settingRowTitle(id)}
          </label>
          {/* Every key the row writes, not just the one it is named after. The
              title is free to say "Models" only because the ids underneath it
              still say which lines of settings.json this row is editing. */}
          {settingRowIds(id).map((key) => (
            <code className='text-muted-foreground font-mono text-xs' key={key}>
              {key}
            </code>
          ))}
          {descriptor.requiresRestart ? (
            <span className='bg-warning/10 text-warning text-3xs rounded-md px-1'>
              Restart required
            </span>
          ) : null}
        </div>
        <p className='text-muted-foreground text-xs'>{descriptor.description}</p>
        {alsoModifiedIn.length > 0 ? (
          // Without this a value set in another layer looks like the row is
          // simply wrong: the control shows the resolved value and nothing says
          // where it came from.
          <p className='text-info text-xs'>Also modified in {alsoModifiedIn.join(', ')} settings</p>
        ) : null}
        {overriddenBy ? (
          // Stronger than "also modified": this scope loses. Editing here writes
          // the file and the app keeps using the other layer's value, which
          // without a word on screen just reads as a control that does nothing.
          <p className='text-warning text-xs'>
            {overriddenBy} settings override this — editing here will not change the value in use
          </p>
        ) : null}
        {disabledReason ? <p className='text-warning text-xs'>{disabledReason}</p> : null}
      </div>

      <div
        className={cn(
          'flex max-w-full min-w-0 shrink-0 items-center gap-1 @max-3xl/settings:w-full',
          descriptor.widget === 'theme' && 'w-full',
          hasCodePreview && 'items-start @3xl/settings:w-1/2 @3xl/settings:max-w-xl',
        )}
      >
        <SettingControl
          disabled={disabledReason !== null}
          id={id}
          onChange={(next) => {
            if (!SCALAR_SETTING_IDS.includes(id as ScalarSettingId)) return
            setSetting(id as ScalarSettingId, next as SettingsValues[ScalarSettingId], scope)
          }}
          value={value}
        />
        <RowActions id={id} isModified={isModified} value={value} />
      </div>
    </div>
  )
}

function SettingControl({
  disabled,
  id,
  onChange,
  value,
}: {
  disabled: boolean
  id: SettingId
  // Every registered value type, not `never`. A handler that accepts nothing is
  // assignable to no widget — which is what forced a cast at every branch —
  // where one that accepts all of them is assignable to each in turn.
  onChange: (next: SettingValue<SettingId>) => void
  value: SettingValue<SettingId>
}) {
  const control = settingControl(id, value)

  if (control.widget === 'theme') return <ThemeWidget disabled={disabled} />
  if (control.widget === 'boolean') {
    return <BooleanWidget checked={control.value} disabled={disabled} id={id} onChange={onChange} />
  }

  if (control.widget === 'number') {
    return <NumberWidget disabled={disabled} id={id} onCommit={onChange} value={control.value} />
  }

  // The two keys whose value is a whole domain object rather than a scalar. They
  // render the editors that already know how to source their rows — providers
  // from the running snapshots, models from the provider catalogue — because
  // neither list lives in the settings document.
  if (control.widget === 'providers') {
    return <ProviderSection saved={control.value} />
  }

  if (control.widget === 'models') {
    return <ModelSection />
  }

  if (control.widget === 'machines') {
    return <MachinesSection disabled={disabled} />
  }

  // Every bindable command by name. The generic record editor this replaces
  // required the user to type a raw command id before it would show a recorder.
  if (control.widget === 'keybindings') {
    return <KeybindingSection />
  }

  if (control.widget === 'font' && isFontSettingId(id)) {
    return <FontWidget disabled={disabled} id={id} onChange={onChange} value={control.value} />
  }

  if (control.widget === 'code-theme') {
    return <CodeThemeWidget disabled={disabled} id={id} onChange={onChange} value={control.value} />
  }

  if (control.widget === 'wallpaper')
    return <WallpaperWidget disabled={disabled} value={control.value} onChange={onChange} />

  if (control.widget === 'palette') {
    return <PaletteWidget disabled={disabled} id={id} value={control.value} />
  }

  if (control.widget === 'string' || control.widget === 'multiline') {
    return (
      <StringWidget
        disabled={disabled}
        id={id}
        onCommit={onChange}
        value={control.value}
        verbatim={id === 'editor.unicodeHighlight.allowedCharacters'}
      />
    )
  }

  if (control.widget === 'enum' && id === 'chat.notificationMode')
    return (
      <NotificationModeWidget
        disabled={disabled}
        onChange={onChange}
        options={control.options}
        value={control.value}
      />
    )

  if (control.widget === 'enum') {
    return (
      <EnumWidget
        disabled={disabled}
        id={id}
        onChange={onChange}
        options={control.options}
        value={control.value}
      />
    )
  }

  // `list`, `complex`, and any value whose shape does not match its widget.
  // Saying so beats rendering a control that cannot represent the value.
  return <span className='text-muted-foreground text-xs'>Edit in settings.json</span>
}
