import { WarningCircleIcon } from '@phosphor-icons/react'
import type { LogEventDetail, LogEventSummary } from '@workspace/contracts'

import { formatDuration, formatLogDateTime } from '@/features/logs/utils/formatters'
import { formatLogPrimary } from '@workspace/client-core/logs/formatters'
import { LogsDetailField } from '@/features/logs/components/detail-field'

type LogsEventInlineDetailProps = {
  detail: LogEventDetail | null
  event: LogEventSummary
}

export function LogsEventInlineDetail({ detail, event }: LogsEventInlineDetailProps) {
  const visibleEvent = detail?.event ?? event

  return (
    <div className='select-text'>
      <div className='text-3xs grid grid-cols-2 gap-x-3 gap-y-1'>
        <LogsDetailField label='event' value={formatLogPrimary(visibleEvent)} />
        <LogsDetailField label='time' value={formatLogDateTime(visibleEvent.timestamp)} />
        <LogsDetailField label='duration' value={formatDuration(visibleEvent.durationMs)} />
        <LogsDetailField label='request' value={visibleEvent.requestId ?? 'none'} />
        <LogsDetailField label='session' value={visibleEvent.sessionId ?? 'none'} />
        <LogsDetailField label='path' value={visibleEvent.path ?? 'none'} />
      </div>
      {detail ? (
        <pre className='bg-background/70 text-3xs mt-2 max-h-52 overflow-auto overscroll-contain p-2 font-mono leading-4 break-words whitespace-pre-wrap'>
          {JSON.stringify(detail.rawJson, null, 2)}
        </pre>
      ) : (
        <div className='text-destructive mt-2 flex items-center gap-2 text-xs'>
          <WarningCircleIcon className='size-(--icon-size) shrink-0' />
          Raw JSON is unavailable for this live row until history refreshes.
        </div>
      )}
    </div>
  )
}
