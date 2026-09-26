import { lstat, readdir, readlink, statfs } from 'node:fs/promises'
import path from 'node:path'

import { readOptionalText } from './places'
import type { WorkspacePaths } from './path'

type Drive = {
  label: string
  path: string
  freeBytes: number | null
  totalBytes: number | null
}

export type DriveSources = {
  platform: NodeJS.Platform
  /** `/proc/mounts` on Linux. */
  mountsFile: string
  /** `/Volumes` on macOS. */
  volumesDirectory: string
}

type Mount = { device: string; mountPoint: string; label: string }

/** Mounts the OS keeps for itself; a person never browses into these to open a project. */
const SYSTEM_MOUNTS = [
  '/boot',
  '/efi',
  '/var',
  '/snap',
  '/nix',
  '/usr',
  '/srv',
  '/tmp',
  '/run/user',
]

/**
 * Each mounted drive once, root first. A device mounted twice (a btrfs subvolume, a bind of
 * `/home`) shows at its first mount point; the home already has its own row.
 */
export async function readDrives(paths: WorkspacePaths, sources: DriveSources) {
  const mounts = await readMounts(sources)
  const drives: Drive[] = []
  for (const mount of mounts) {
    const relative = relativeInside(paths, mount.mountPoint)
    if (relative === null) continue
    drives.push({ label: mount.label, path: relative, ...(await space(mount.mountPoint)) })
  }
  if (drives.some((drive) => drive.path === '')) return drives

  const root = paths.workspaceRoot
  return [{ label: path.basename(root) || root, path: '', ...(await space(root)) }, ...drives]
}

async function readMounts(sources: DriveSources): Promise<Mount[]> {
  if (sources.platform === 'linux')
    return parseLinuxMounts(await readOptionalText(sources.mountsFile))
  if (sources.platform === 'darwin') return readMacVolumes(sources.volumesDirectory)
  return [{ device: '/', mountPoint: '/', label: 'System' }]
}

export function parseLinuxMounts(text: string): Mount[] {
  const seenDevices = new Set<string>()
  const mounts: Mount[] = []
  for (const line of text.split('\n')) {
    const [device, rawMountPoint] = line.split(' ')
    if (!device?.startsWith('/dev/') || device.startsWith('/dev/loop') || !rawMountPoint) continue
    const mountPoint = unescapeMountField(rawMountPoint)
    if (isSystemMount(mountPoint) || seenDevices.has(device)) continue
    seenDevices.add(device)
    mounts.push({
      device,
      mountPoint,
      label: mountPoint === '/' ? 'System' : path.basename(mountPoint),
    })
  }
  return mounts.sort((a, b) => a.mountPoint.localeCompare(b.mountPoint))
}

// The kernel writes a space in a mount point as `\040`.
function unescapeMountField(field: string) {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  )
}

function isSystemMount(mountPoint: string) {
  return SYSTEM_MOUNTS.some(
    (prefix) => mountPoint === prefix || mountPoint.startsWith(`${prefix}/`),
  )
}

/** `/Volumes` holds one entry per volume; the startup volume is a symlink to `/` under its own name. */
async function readMacVolumes(volumesDirectory: string): Promise<Mount[]> {
  const names = await readdir(volumesDirectory).catch(() => [])
  const volumes: Mount[] = []
  let rootLabel = 'System'
  for (const name of names.toSorted()) {
    if (name.startsWith('.')) continue
    const volume = path.join(volumesDirectory, name)
    const info = await lstat(volume).catch(() => null)
    if (!info) continue
    if (!info.isSymbolicLink()) {
      volumes.push({ device: volume, mountPoint: volume, label: name })
      continue
    }
    if ((await readlink(volume).catch(() => null)) === '/') rootLabel = name
  }
  return [{ device: '/', mountPoint: '/', label: rootLabel }, ...volumes]
}

function relativeInside(paths: WorkspacePaths, absolute: string) {
  try {
    return paths.toRelative(absolute)
  } catch {
    return null
  }
}

async function space(mountPoint: string) {
  const info = await statfs(mountPoint).catch(() => null)
  if (!info) return { freeBytes: null, totalBytes: null }
  return { freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize }
}
