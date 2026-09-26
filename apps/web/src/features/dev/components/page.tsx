import { BAR_TAB_STRIP_CLASS, barTabClassName } from '@workspace/ui/patterns/bar-tabs'
import { LoadersTab } from '@/features/dev/components/loaders-tab'
import { PhysicalTab } from '@/features/dev/components/physical-tab'
import { HandlesTab } from '@/features/dev/components/handles-tab'
import { DEV_TABS, devTabForPath, devTabHref } from '@/features/dev/utils/tabs'

/** The gallery at /dev. Tabs are plain links: one page load per tab is fine here. */
export function DevPage() {
  const active = devTabForPath(window.location.pathname, import.meta.env.BASE_URL)

  return (
    <div className='bg-background-solid text-foreground flex h-dvh flex-col'>
      <header className={BAR_TAB_STRIP_CLASS}>
        <span className='flex items-center px-(--bar-padding-x) text-xs font-medium'>Dev</span>
        <nav className='flex'>
          {DEV_TABS.map((tab) => (
            <a
              aria-current={tab.id === active ? 'page' : undefined}
              className={barTabClassName(tab.id === active)}
              href={devTabHref(tab.id, import.meta.env.BASE_URL)}
              key={tab.id}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>
      <main className='bg-content-well min-h-0 flex-1 overflow-auto'>
        {active === 'loaders' && <LoadersTab />}
        {active === 'physical' && <PhysicalTab />}
        {active === 'handles' && <HandlesTab />}
      </main>
    </div>
  )
}
