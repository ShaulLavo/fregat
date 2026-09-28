import { decodeFileResponse } from '@workspace/contracts/file-response'
import type { WriteBody } from '../src/fs/contracts'

export async function readTextResponse(response: Response) {
  return decodeFileResponse(await response.arrayBuffer(), response.headers)
}

export function textWriteRequest(
  url: string,
  {
    body,
    ...init
  }: Omit<RequestInit, 'body'> & { body: Omit<WriteBody, 'content'> & { content: string } },
) {
  const { content, ...metadata } = body
  const target = new URL(url)
  for (const [name, value] of Object.entries(metadata)) {
    if (value !== undefined) target.searchParams.set(name, String(value))
  }
  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/plain; charset=utf-8')
  return new Request(target, { ...init, headers, body: content })
}
