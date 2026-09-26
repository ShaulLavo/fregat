import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  effectiveEntryType,
  WORKSPACE_ADDRESS_ID_LENGTH,
  workspaceAddressIdSchema,
  type EntryTypeFilter,
  type WorkspaceAddressId,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  createMetadataDatabase,
  type MetadataDatabaseHandle,
  type PlatformDatabase,
} from '../db/client'
import { migratePlatformDatabase as migrateMetadataDatabase } from '../db/migrations'
import { fsMetadata, workspaceAddresses } from '../db/schema'

export type FsMetadataEntry = {
  path: string
  name: string
  type: EntryTypeFilter
  targetType?: EntryTypeFilter
  size: number
  mtimeMs: number
  birthtimeMs: number
}

export type FsMetadataStoreOptions = {
  createWorkspaceAddressId?: () => WorkspaceAddressId
  /** Existing database handle to use. The store will not close handles it does not own. */
  database?: MetadataDatabaseHandle
  /** Path to open a dedicated, store-owned database when no handle is provided. */
  databasePath?: string
}

export class FsMetadataStore {
  readonly databasePath: string
  private readonly db: PlatformDatabase
  private readonly ownedHandle: MetadataDatabaseHandle | null
  private readonly createWorkspaceAddressId: () => WorkspaceAddressId

  constructor(options: FsMetadataStoreOptions = {}) {
    this.createWorkspaceAddressId = options.createWorkspaceAddressId ?? createWorkspaceAddressId
    if (options.database) {
      this.ownedHandle = null
      this.db = options.database.db
      this.databasePath = options.database.databasePath
    } else {
      this.ownedHandle = createMetadataDatabase({ databasePath: options.databasePath })
      this.db = this.ownedHandle.db
      this.databasePath = this.ownedHandle.databasePath
    }

    migrateMetadataDatabase(this.db)
  }

  registerWorkspaceAddress(filesystemRoot: string, canonicalPath: string): WorkspaceAddressId {
    for (;;) {
      const existing = this.workspaceAddressForDirectory(filesystemRoot, canonicalPath)
      if (existing) return existing.id

      const inserted = this.db
        .insert(workspaceAddresses)
        .values({ id: this.createWorkspaceAddressId(), filesystemRoot, canonicalPath })
        .onConflictDoNothing()
        .returning({ id: workspaceAddresses.id })
        .get()
      if (inserted) return inserted.id
    }
  }

  workspaceAddressForDirectory(filesystemRoot: string, canonicalPath: string) {
    return this.db
      .select({ id: workspaceAddresses.id })
      .from(workspaceAddresses)
      .where(
        and(
          eq(workspaceAddresses.filesystemRoot, filesystemRoot),
          eq(workspaceAddresses.canonicalPath, canonicalPath),
        ),
      )
      .get()
  }

  findWorkspaceAddress(filesystemRoot: string, id: WorkspaceAddressId) {
    return this.db
      .select()
      .from(workspaceAddresses)
      .where(
        and(eq(workspaceAddresses.filesystemRoot, filesystemRoot), eq(workspaceAddresses.id, id)),
      )
      .get()
  }

  recordPicked(entry: FsMetadataEntry) {
    const now = Date.now()

    this.db
      .insert(fsMetadata)
      .values({
        path: entry.path,
        name: entry.name,
        entryType: effectiveEntryType(entry),
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        birthtimeMs: entry.birthtimeMs,
        lastPickedAt: now,
        pickCount: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: fsMetadata.path,
        set: {
          name: entry.name,
          entryType: effectiveEntryType(entry),
          size: entry.size,
          mtimeMs: entry.mtimeMs,
          birthtimeMs: entry.birthtimeMs,
          lastPickedAt: now,
          pickCount: sql`${fsMetadata.pickCount} + 1`,
          updatedAt: now,
        },
      })
      .run()
  }

  /** Drops recents whose paths are gone. Returns how many rows it removed. */
  forgetPicked(paths: readonly string[]) {
    if (paths.length === 0) return 0

    return this.db
      .delete(fsMetadata)
      .where(inArray(fsMetadata.path, paths))
      .returning({ path: fsMetadata.path })
      .all().length
  }

  listRecentEntryCandidates({ limit, offset }: { limit: number; offset: number }) {
    return this.db
      .select()
      .from(fsMetadata)
      .where(
        and(
          inArray(fsMetadata.entryType, ['directory', 'file']),
          isNotNull(fsMetadata.lastPickedAt),
        ),
      )
      .orderBy(desc(fsMetadata.lastPickedAt), desc(fsMetadata.updatedAt), asc(fsMetadata.path))
      .limit(limit)
      .offset(offset)
      .all()
  }

  close() {
    this.ownedHandle?.close()
  }
}

function createWorkspaceAddressId(): WorkspaceAddressId {
  return v.parse(workspaceAddressIdSchema, nanoid(WORKSPACE_ADDRESS_ID_LENGTH))
}
