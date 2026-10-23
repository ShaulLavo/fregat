import type { TestContext } from 'vitest'

type MarkdownInputSite =
  | 'chat-open-file/server-root'
  | 'chat-open-file/outside-root'
  | 'chat-observation/source'
  | 'chat-observation/changed-id'
  | 'production-warmup/image'

type MarkdownInput = Pick<TestContext, 'annotate'> & {
  readonly site: MarkdownInputSite
  readonly source: string
}

// UTF16 counts source code units; UTF8 counts the exact TextEncoder bytes hashed.
// TextEncoder replaces lone surrogates. No line-ending or Unicode normalization occurs.
export async function recordMarkdownInputReceipt({ annotate, site, source }: MarkdownInput) {
  const bytes = new TextEncoder().encode(source)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sourceSha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const receipt = { site, sourceSha256, utf8Bytes: bytes.byteLength, utf16Units: source.length }
  await annotate(JSON.stringify(receipt), 'markdown-development-input')
  return receipt
}
