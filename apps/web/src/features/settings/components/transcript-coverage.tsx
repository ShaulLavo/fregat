import type { ProviderUsageHistory } from '@workspace/contracts'
import { useCoarseNow } from '@/hooks/use-coarse-now'
import { observedUsageLabel } from '@/lib/provider-usage'
import { usageSourceLabel } from '@/features/settings/utils/usage-source-label'

export function TranscriptCoverage({
  coverage,
  receivedAtMs = 0,
}: {
  readonly coverage: ProviderUsageHistory['coverage']
  readonly receivedAtMs?: number
}) {
  const nowMs = Math.max(useCoarseNow(), receivedAtMs)
  if (!coverage)
    return (
      <p className='text-muted-foreground text-xs' data-transcript-coverage>
        Local source coverage unavailable. This report contains recorded Fregat usage.
      </p>
    )
  return (
    <section
      aria-label='Local transcript coverage'
      className='bg-content-well flex flex-col gap-2 p-(--density-control-padding-x)'
      data-transcript-coverage
    >
      <p className='text-xs'>
        Local transcript stores and recorded Fregat activity on this host. Native transcript
        coverage includes work outside Fregat projects.
      </p>
      <p className='text-muted-foreground text-2xs'>
        Account attribution is unverified. Coverage is limited to this host.
      </p>
      <p className='text-muted-foreground text-2xs'>
        Scan status: {coverage.status} ·{' '}
        <span title={coverage.scannedAt ?? undefined}>
          {observedUsageLabel(coverage.scannedAt, nowMs)}
        </span>
      </p>
      <ul className='flex flex-col gap-2'>
        {coverage.sources.map((source) => (
          <li className='text-2xs flex flex-col gap-1' key={source.id}>
            <div className='flex flex-wrap justify-between gap-x-3 gap-y-1'>
              <span>
                {usageSourceLabel(source.sourceKind, source.driverKind)} · {source.status}
              </span>
              <span className='font-mono tabular-nums'>
                {source.sourceKind === 'native-transcript' ? `${source.files} files · ` : null}
                {source.records} records
              </span>
            </div>
            <span
              className='text-muted-foreground font-mono tabular-nums'
              title={source.scannedAt ?? undefined}
            >
              {observedUsageLabel(source.scannedAt, nowMs)}
            </span>
            {source.latestEventAt ? (
              <span
                className='text-muted-foreground font-mono tabular-nums'
                title={source.latestEventAt}
              >
                Latest event: {observedUsageLabel(source.latestEventAt, nowMs)}
              </span>
            ) : null}
            {source.unidentifiedRecords > 0 ? (
              <span className='text-muted-foreground'>
                {source.unidentifiedRecords} source-scoped records with unknown billing identity
              </span>
            ) : null}
            {source.malformedLines + source.oversizedLines > 0 ? (
              <span className='text-muted-foreground'>
                {source.malformedLines + source.oversizedLines} unreadable or oversized lines
                skipped
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
