import { normalizeChatAttachmentMimeType } from '@workspace/contracts'

const CONVERTIBLE_TYPES = [
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/avif',
] as const

export function imageSourceMimeType(type: string) {
  const normalized = type.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  return (
    normalizeChatAttachmentMimeType(normalized) ??
    CONVERTIBLE_TYPES.find((type) => type === normalized)
  )
}

export async function normalizeImageSource(file: File): Promise<File> {
  const declared = imageSourceMimeType(file.type)
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const signature = new TextDecoder('latin1').decode(header)
  const detected = detectImageType(header, signature)
  const extension = file.name.split('.').pop()?.toLowerCase()
  const inferred = extension ? imageSourceMimeType(`image/${extension}`) : undefined
  const type = detected ?? declared ?? inferred
  if (!type || type === file.type) return file
  return new File([file], file.name, { type, lastModified: file.lastModified })
}

function detectImageType(bytes: Uint8Array, signature: string) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif'
  if (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') return 'image/webp'
  if (signature.slice(4, 8) !== 'ftyp') return undefined
  const brand = signature.slice(8)
  if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic'
  if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  if (['avif', 'avis'].includes(brand)) return 'image/avif'
  return undefined
}
