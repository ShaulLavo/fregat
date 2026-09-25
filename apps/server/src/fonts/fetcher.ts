import { createRequire } from 'node:module'

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type FontSubsetter = (
  buffer: Buffer,
  text: string,
  options?: { targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype' },
) => Promise<Buffer>

const require = createRequire(import.meta.url)

export const subsetFont = require('subset-font') as FontSubsetter
