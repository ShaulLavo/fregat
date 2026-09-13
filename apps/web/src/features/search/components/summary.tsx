import { SearchSummaryActions } from '@/features/search/components/summary-actions'
import { SearchSummaryText } from '@/features/search/components/summary-text'
import { cn } from '@workspace/ui/lib/utils'

export function SearchSummary({ className, rootPath }: { className?: string; rootPath: string }) {
  return (
    <div
      className={cn(
        'mt-2 flex min-h-5 items-center gap-2 px-1 text-2xs text-muted-foreground',
        className,
      )}
    >
      <SearchSummaryText className='flex-1' rootPath={rootPath} />
      <div className='ml-auto flex shrink-0 items-center gap-0.5'>
        <SearchSummaryActions buttonClassName='size-5' rootPath={rootPath} />
      </div>
    </div>
  )
}
