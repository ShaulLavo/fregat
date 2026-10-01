export function isPdfFile(name: string, mimeType?: string) {
  const mediaType = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}
