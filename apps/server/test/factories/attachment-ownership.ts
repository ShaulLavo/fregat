import { createMetadataDatabase } from '../../src/db/client'
import { initializePlatformDatabase } from '../../src/db/initialize'
import { createAttachmentOwnership } from '../../src/attachments/ownership'

export function createAttachmentTestOwnership() {
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  initializePlatformDatabase(database.db)
  return { ownership: createAttachmentOwnership(database.db), close: database.close }
}
