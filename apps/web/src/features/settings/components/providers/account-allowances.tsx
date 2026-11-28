import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { ProviderAccountUsageDetails } from '@/components/provider-account-usage-details'
import { useCoarseNow } from '@/hooks/use-coarse-now'
import {
  providerUsageQueryOptions,
  usageAccountLabel,
  usageProviderLabel,
} from '@/lib/provider-usage'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

export function AccountAllowances() {
  const usage = useQuery(providerUsageQueryOptions(), useSettingsOwner())
  const nowMs = Math.max(useCoarseNow(), usage.dataUpdatedAt)
  const providers = [...new Set(usage.data?.accounts.map((account) => account.driverKind) ?? [])]
  return (
    <section
      aria-label='Account allowances'
      className='flex min-w-0 flex-col gap-3'
      data-account-allowances
    >
      <div className='flex flex-col gap-1'>
        <h3 className='text-sm font-semibold'>Account allowances</h3>
        <p className='text-muted-foreground text-xs'>
          Provider-reported account-wide limits across tools and devices. Each account has its own
          allowance.
        </p>
        <p className='text-muted-foreground text-2xs'>
          Reads use Fregat’s cached observations. Collection runs at the configured cadence.
        </p>
      </div>
      {usage.isPending ? (
        <LoadingState className='flex flex-col gap-2' label='Loading account allowances'>
          <div
            aria-hidden
            className='bg-content-well flex flex-col gap-2 p-(--density-control-padding-x)'
          >
            <div className='skeleton-sweep h-3 w-24 rounded-md' />
            <div className='skeleton-sweep h-2.5 w-40 rounded-md' />
            <div className='skeleton-sweep h-3 w-full rounded-md' />
            <div className='skeleton-sweep h-2.5 w-32 rounded-md' />
          </div>
        </LoadingState>
      ) : null}
      {!usage.isPending && usage.isError ? (
        <EmptyState
          align='start'
          title='Account allowances could not be loaded'
          tone='error'
          action={
            <Button size='sm' variant='outline' onClick={() => void usage.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {usage.data?.accounts.length === 0 ? (
        <EmptyState
          align='start'
          title='No account observations'
          description='Configured accounts appear here when the cache service discovers their identities.'
        />
      ) : null}
      {providers.map((driverKind) => (
        <section
          aria-label={usageProviderLabel(driverKind)}
          className='flex min-w-0 flex-col gap-2'
          key={driverKind}
        >
          <h4 className='section-label'>{usageProviderLabel(driverKind)}</h4>
          {usage.data?.accounts
            .filter((account) => account.driverKind === driverKind)
            .map((account, index) => (
              <ProviderAccountUsageDetails
                key={account.accountKey}
                account={account}
                label={usageAccountLabel(account, index)}
                nowMs={nowMs}
              />
            ))}
        </section>
      ))}
    </section>
  )
}
