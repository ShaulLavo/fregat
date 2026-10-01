import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { PdfSource } from '@/lib/pdf-viewer/source'
import { PdfFile } from '@/components/pdf-viewer/file'
import { PdfViewer } from '@/components/pdf-viewer/viewer'

export type PdfPresentationProps =
  | { readonly path: FilesystemPath }
  | { readonly source: PdfSource; readonly loading?: boolean }

export function PdfPresentationContent(props: PdfPresentationProps) {
  if ('path' in props) return <PdfFile path={props.path} />
  return <PdfViewer source={props.source} loading={props.loading} />
}
