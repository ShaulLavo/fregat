import { useSearchSummaryModel } from '@/features/search/hooks/use-summary-model'
import { cn } from '@workspace/ui/lib/utils'

export function SearchSummaryText({
  className,
  rootPath,
}: {
  className?: string
  rootPath: string
}) {
  const summary = useSearchSummaryModel(rootPath)

  return (
    <span className={cn('block min-w-0 truncate', className)} title={summary.title}>
      {summary.content}
    </span>
  )
}
