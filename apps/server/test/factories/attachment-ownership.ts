import { createMetadataDatabase } from '../../src/db/client'
import { migratePlatformDatabase } from '../../src/db/migrations'
import { createAttachmentOwnership } from '../../src/attachments/ownership'

export function createAttachmentTestOwnership() {
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  migratePlatformDatabase(database.db)
  return { ownership: createAttachmentOwnership(database.db), close: database.close }
}
