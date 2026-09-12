import { SearchBufferSummary } from '@/features/search/components/buffer-summary'

export function SearchSummary({ rootPath }: { rootPath: string }) {
  return <SearchBufferSummary className='text-3xs mt-1 gap-1 px-0' rootPath={rootPath} />
}
