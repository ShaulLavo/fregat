import type { ProviderUsageWindow } from '@workspace/contracts'
import { formatWait } from '@workspace/utils/timing'
import { useSettingValue } from '@/hooks/use-setting-value'
import { observedUsageLabel, usageWindowState } from '@/lib/provider-usage'

export function ProviderUsageWindowDetails({
  window,
  nowMs,
}: {
  readonly window: ProviderUsageWindow
  readonly nowMs: number
}) {
  const staleAfterMs = useSettingValue('providers.usageStaleAfterSeconds') * 1000
  const remaining = window.resetsAt ? Date.parse(window.resetsAt) - nowMs : null
  return (
    <li className='flex min-w-0 flex-col gap-1 text-xs' data-account-window={window.id}>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
        <span className='break-words' title={window.label}>
          {window.label}
        </span>
        <span className='font-mono tabular-nums'>
          {window.usedPercent === null
            ? 'Usage percentage unknown'
            : `${window.usedPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used`}
        </span>
      </div>
      {window.status ? (
        <p className='text-muted-foreground text-2xs'>Provider status: {window.status}</p>
      ) : null}
      <p className='text-muted-foreground text-2xs'>
        {usageWindowState(window, nowMs, staleAfterMs)}
      </p>
      <p
        className='text-muted-foreground text-2xs font-mono tabular-nums'
        title={window.observedAt ?? undefined}
      >
        {observedUsageLabel(window.observedAt, nowMs)}
        {remaining !== null && remaining > 0 ? ` · resets in ${formatWait(remaining)}` : null}
        {window.resetsAt === null ? ' · reset time unknown' : null}
      </p>
      <p className='text-muted-foreground text-2xs break-words' title={window.source}>
        Source: {window.source ?? 'Unavailable'}
      </p>
    </li>
  )
}
