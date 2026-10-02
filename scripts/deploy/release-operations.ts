import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'

export type Release = {
  name: string
  directory: string
  web: string
  server: string
  previous: string | null
}

export function releaseAt(directory: string, previous: string | null = null): Release {
  return {
    name: path.basename(directory),
    directory,
    web: path.join(directory, 'web'),
    server: path.join(directory, 'server'),
    previous,
  }
}

export function createRelease(root: string, commit: string, slug: string): Release {
  const stamp = new Date().toISOString().replaceAll(/[-:]|\.\d+/g, '')
  const name = `${stamp}-${commit.slice(0, 8)}-${slug}-${randomUUID().slice(0, 8)}`
  const directory = path.join(root, 'releases', name)
  mkdirSync(directory, { recursive: true })
  return releaseAt(directory, currentRelease(root))
}

export function currentRelease(root: string) {
  return linkedRelease(path.join(root, 'current'))
}

export function pendingRelease(root: string) {
  return linkedRelease(path.join(root, 'pending'))
}

function linkedRelease(link: string): string | null {
  if (!existsSync(link)) return null
  return realpathSync(link)
}

export function stagePending(root: string, release: Release) {
  replaceLink(path.join(root, 'pending'), release.directory)
}

export function removePending(root: string) {
  const link = path.join(root, 'pending')
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) return null
  const name = path.basename(readlinkSync(link))
  rmSync(link, { force: true })
  return name
}

export function swapCurrent(root: string, release: Release) {
  pointCurrentAt(root, release.directory)
}

export function pointCurrentAt(root: string, directory: string) {
  replaceLink(path.join(root, 'current'), directory)
}

/** Written beside the destination and renamed over it; each writer owns its staging link. */
export function replaceLink(link: string, target: string) {
  const staging = `${link}.next-${process.pid}-${randomUUID()}`
  symlinkSync(target, staging)
  try {
    renameSync(staging, link)
  } finally {
    rmSync(staging, { force: true })
  }
}
