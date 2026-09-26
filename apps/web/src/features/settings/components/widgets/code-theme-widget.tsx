import { cn } from '@workspace/ui/lib/utils'

import { CodeThemePicker } from '@/lib/appearance/components/code-theme-picker'

export function CodeThemeWidget({
  disabled,
  id,
  value,
  onChange,
}: {
  disabled: boolean
  id: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className={cn('h-64 w-full min-w-0', disabled && 'opacity-50')} inert={disabled}>
      <CodeThemePicker
        mode={id === 'editor.codeTheme.light' ? 'light' : 'dark'}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
