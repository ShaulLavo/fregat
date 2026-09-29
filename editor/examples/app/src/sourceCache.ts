import type { SourceFile, SourceSnapshot } from './githubSource.ts'

const CACHE_DIR = 'editor-github-source-cache'
const OBJECTS_DIR = 'objects'
const MANIFEST_FILE = 'manifest.json'

type SourceCacheManifest = {
  readonly version: 1
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly commitSha: string
  readonly treeSha: string
  readonly fetchedAt: number
  readonly files: readonly SourceCacheManifestFile[]
}

type SourceCacheManifestFile = {
  readonly path: string
  readonly sha: string
  readonly size: number
}

export async function loadCachedSourceSnapshot(
  root: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle> = getOpfsRoot(),
): Promise<SourceSnapshot | null> {
  try {
    const cacheDir = await getCacheDirectory(await root, false)
    if (!cacheDir) return null

    const manifest = await readManifest(cacheDir)
    if (!manifest) return null

    const objectsDir = await getObjectsDirectory(cacheDir, false)
    if (!objectsDir) return null

    return await hydrateSnapshot(manifest, objectsDir)
  } catch {
    return null
  }
}

export async function saveSourceSnapshotToCache(
  snapshot: SourceSnapshot,
  root: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle> = getOpfsRoot(),
): Promise<void> {
  const cacheDir = requireDirectory(await getCacheDirectory(await root, true))
  const objectsDir = requireDirectory(await getObjectsDirectory(cacheDir, true))

  await Promise.all(snapshot.files.map((file) => writeObjectIfNeeded(objectsDir, file)))
  await writeManifest(cacheDir, createManifest(snapshot))
}

function requireDirectory(directory: FileSystemDirectoryHandle | null): FileSystemDirectoryHandle {
  if (!directory) throw new Error('Unable to open OPFS source cache')
  return directory
}

export async function clearSourceCache(
  root: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle> = getOpfsRoot(),
): Promise<void> {
  try {
    await (await root).removeEntry(CACHE_DIR, { recursive: true })
  } catch {
    return
  }
}

function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function getCacheDirectory(
  root: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(CACHE_DIR, { create })
  } catch {
    if (create) throw new Error('Unable to open OPFS source cache')
    return null
  }
}

async function getObjectsDirectory(
  cacheDir: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await cacheDir.getDirectoryHandle(OBJECTS_DIR, { create })
  } catch {
    if (create) throw new Error('Unable to open OPFS source objects cache')
    return null
  }
}

async function readManifest(
  cacheDir: FileSystemDirectoryHandle,
): Promise<SourceCacheManifest | null> {
  try {
    const fileHandle = await cacheDir.getFileHandle(MANIFEST_FILE)
    return parseManifest(await (await fileHandle.getFile()).text())
  } catch {
    return null
  }
}

function parseManifest(text: string): SourceCacheManifest | null {
  const manifest = JSON.parse(text) as Partial<SourceCacheManifest>
  if (manifest.version !== 1) return null
  if (typeof manifest.owner !== 'string') return null
  if (typeof manifest.repo !== 'string') return null
  if (typeof manifest.branch !== 'string') return null
  if (typeof manifest.commitSha !== 'string') return null
  if (typeof manifest.treeSha !== 'string') return null
  if (typeof manifest.fetchedAt !== 'number') return null
  if (!Array.isArray(manifest.files)) return null

  return {
    version: 1,
    owner: manifest.owner,
    repo: manifest.repo,
    branch: manifest.branch,
    commitSha: manifest.commitSha,
    treeSha: manifest.treeSha,
    fetchedAt: manifest.fetchedAt,
    files: manifest.files.flatMap(parseManifestFile),
  }
}

function parseManifestFile(file: unknown): SourceCacheManifestFile[] {
  const item = file as Partial<SourceCacheManifestFile>
  if (typeof item.path !== 'string') return []
  if (typeof item.sha !== 'string') return []
  if (typeof item.size !== 'number') return []
  return [{ path: item.path, sha: item.sha, size: item.size }]
}

async function hydrateSnapshot(
  manifest: SourceCacheManifest,
  objectsDir: FileSystemDirectoryHandle,
): Promise<SourceSnapshot | null> {
  const files: SourceFile[] = []

  for (const file of manifest.files) {
    const text = await readObject(objectsDir, file.sha)
    if (text === null) return null
    files.push({ ...file, text })
  }

  return {
    owner: manifest.owner,
    repo: manifest.repo,
    branch: manifest.branch,
    commitSha: manifest.commitSha,
    treeSha: manifest.treeSha,
    fetchedAt: manifest.fetchedAt,
    files,
  }
}

async function readObject(
  objectsDir: FileSystemDirectoryHandle,
  sha: string,
): Promise<string | null> {
  try {
    const fileHandle = await objectsDir.getFileHandle(sha)
    return await (await fileHandle.getFile()).text()
  } catch {
    return null
  }
}

async function writeObjectIfNeeded(
  objectsDir: FileSystemDirectoryHandle,
  file: SourceFile,
): Promise<void> {
  if (await hasObject(objectsDir, file.sha)) return
  await writeTextFile(objectsDir, file.sha, file.text)
}

async function hasObject(objectsDir: FileSystemDirectoryHandle, sha: string): Promise<boolean> {
  try {
    await objectsDir.getFileHandle(sha)
    return true
  } catch {
    return false
  }
}

async function writeManifest(
  cacheDir: FileSystemDirectoryHandle,
  manifest: SourceCacheManifest,
): Promise<void> {
  await writeTextFile(cacheDir, MANIFEST_FILE, JSON.stringify(manifest))
}

async function writeTextFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(text)
  await writable.close()
}

function createManifest(snapshot: SourceSnapshot): SourceCacheManifest {
  return {
    version: 1,
    owner: snapshot.owner,
    repo: snapshot.repo,
    branch: snapshot.branch,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.treeSha,
    fetchedAt: snapshot.fetchedAt,
    files: snapshot.files.map(stripFileText),
  }
}

function stripFileText(file: SourceFile): SourceCacheManifestFile {
  return {
    path: file.path,
    sha: file.sha,
    size: file.size,
  }
}
