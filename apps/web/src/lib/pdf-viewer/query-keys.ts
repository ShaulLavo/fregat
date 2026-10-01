export const pdfQueryKeys = {
  engine: ['pdf', 'engine'],
  presentation: ['pdf', 'presentation'],
  bytes: (origin: string, kind: string, url: string) => ['pdf', 'bytes', origin, kind, url],
  asset: (url: string) => ['pdf', 'asset', url],
} as const
