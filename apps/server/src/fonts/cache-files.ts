import { readFile } from 'node:fs/promises'

import { FsError } from '../fs/errors'

export async function readJsonFile<T>(filename: string) {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

export async function readBinaryFile(filename: string) {
  try {
    return await readFile(filename)
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

export function fontOperationFailed(message: string, response: Response) {
  return new FsError('OPERATION_FAILED', message, undefined, {
    fix: 'Check the network connection; a font already used once is served from the cache.',
    internal: { status: response.status, statusText: response.statusText, url: response.url },
  })
}

function nodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  return typeof error.code === 'string' ? error.code : null
}
