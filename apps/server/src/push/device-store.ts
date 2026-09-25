import { and, asc, eq } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { pushDevices } from '../db/schema'

export type PushDeviceRow = typeof pushDevices.$inferSelect

export class PushDeviceStore {
  private readonly database: PlatformDatabase

  constructor(database: PlatformDatabase) {
    this.database = database
  }

  list(): PushDeviceRow[] {
    return this.database.select().from(pushDevices).orderBy(asc(pushDevices.createdAt)).all()
  }

  get(id: string): PushDeviceRow | undefined {
    return this.database.select().from(pushDevices).where(eq(pushDevices.id, id)).get()
  }

  /** A browser that registers again keeps its first `createdAt` and gets its new keys. */
  upsert(row: PushDeviceRow): PushDeviceRow {
    return this.database
      .insert(pushDevices)
      .values(row)
      .onConflictDoUpdate({
        target: pushDevices.id,
        set: {
          revision: row.revision,
          endpoint: row.endpoint,
          p256dh: row.p256dh,
          auth: row.auth,
          label: row.label,
          service: row.service,
          origin: row.origin,
          updatedAt: row.updatedAt,
        },
      })
      .returning()
      .get()
  }

  removeRevision(row: PushDeviceRow): void {
    this.database
      .delete(pushDevices)
      .where(and(eq(pushDevices.id, row.id), eq(pushDevices.revision, row.revision)))
      .run()
  }

  remove(id: string): boolean {
    return (
      this.database.delete(pushDevices).where(eq(pushDevices.id, id)).returning().all().length > 0
    )
  }
}
