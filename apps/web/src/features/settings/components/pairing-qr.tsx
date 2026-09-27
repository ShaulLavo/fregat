import { qrPath } from '@/features/settings/utils/qr-path'

/** The pairing link as a QR code a phone's camera opens, in the foreground colour on the panel. */
export function PairingQr({ value }: { readonly value: string }) {
  const { path, size } = qrPath(value)

  return (
    <svg
      aria-label='Pairing QR code'
      className='text-foreground size-44 shrink-0'
      role='img'
      shapeRendering='crispEdges'
      viewBox={`0 0 ${size} ${size}`}
    >
      <path d={path} fill='currentColor' />
    </svg>
  )
}
