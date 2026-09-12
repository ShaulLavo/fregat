import { SearchBufferSummary } from '@/features/search/components/buffer-summary'

export function SearchSummary({ rootPath }: { rootPath: string }) {
  return (
    <SearchBufferSummary
      buttonClassName='size-[18px]'
      className='text-3xs mt-1 min-h-4 gap-1 px-0'
      rootPath={rootPath}
    />
  )
}
