import type { ProviderAccountUsage } from '@workspace/contracts'
import { ProviderUsageWindowDetails } from '@/components/provider-usage-window-details'
import { observedUsageLabel, usageRoutingLabel } from '@/lib/provider-usage'

export function ProviderAccountUsageDetails({
  account,
  label,
  nowMs,
}: {
  readonly account: ProviderAccountUsage
  readonly label: string
  readonly nowMs: number
}) {
  return (
    <section
      aria-label={label}
      className='bg-content-well flex min-w-0 flex-col gap-2 p-(--density-control-padding-x)'
      data-account-usage={account.accountKey}
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h4 className='text-xs font-medium'>{label}</h4>
        <span
          className='text-muted-foreground text-2xs break-words'
          title={account.planType ?? undefined}
        >
          {account.planType ?? 'Plan unknown'}
        </span>
      </div>
      <p className='text-muted-foreground text-2xs'>{usageRoutingLabel(account)}</p>
      {account.routing?.lastServedAt ? (
        <p
          className='text-muted-foreground text-2xs font-mono tabular-nums'
          title={account.routing.lastServedAt}
        >
          Last served: {observedUsageLabel(account.routing.lastServedAt, nowMs)}
        </p>
      ) : null}
      {account.state === 'cooldown' ? (
        <p className='text-muted-foreground text-2xs'>Account cooling down</p>
      ) : null}
      {account.state === 'disabled' ? (
        <p className='text-muted-foreground text-2xs'>Account disabled</p>
      ) : null}
      {account.windows.length === 0 ? (
        <p className='text-muted-foreground text-xs'>No allowance observation</p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {account.windows.map((window) => (
            <ProviderUsageWindowDetails key={window.id} nowMs={nowMs} window={window} />
          ))}
        </ul>
      )}
      {account.credits ? (
        <p className='text-muted-foreground text-2xs'>
          Provider credits:{' '}
          <span className='font-mono tabular-nums'>
            {account.credits.unlimited ? 'Unlimited' : account.credits.balance.toLocaleString()}
          </span>
        </p>
      ) : null}
      {account.resetCredits ? (
        <p className='text-muted-foreground text-2xs'>
          Usage-reset grants:{' '}
          <span className='font-mono tabular-nums'>{account.resetCredits.available}</span>
        </p>
      ) : null}
      <p className='text-muted-foreground text-2xs break-words' title={account.source}>
        Account source: {account.source ?? 'Unavailable'}
      </p>
    </section>
  )
}
