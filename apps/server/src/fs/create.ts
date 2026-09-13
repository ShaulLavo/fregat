import { mkdir, writeFile } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import type { MutationTarget } from './mutation-target'
import type { CreateFileBody, CreateFolderBody } from './contracts'
import { writeTextFile } from './write'

export async function createFile(
  target: MutationTarget<'content'> | MutationTarget<'entry'>,
  body: Pick<CreateFileBody, 'content'>,
  maxBytes: number,
) {
  if (target.kind === 'content') {
    return writeTextFile(target, { content: body.content ?? '' }, maxBytes)
  }
  try {
    await writeFile(target.absolutePath, body.content ?? '', {
      encoding: 'utf8',
      flag: 'wx',
    })

    return target.relativePath
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

export async function createFolder(
  target: MutationTarget<'content'>,
  body: Omit<CreateFolderBody, 'path'>,
) {
  try {
    await mkdir(target.absolutePath, { recursive: body.recursive })

    return target.relativePath
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}
