import { defineErrorCatalog } from 'evlog'

export const dbErrors = defineErrorCatalog('db', {
  SCHEMA_VERSION_MISMATCH: {
    status: 500,
    message: ({ databasePath, found }: { databasePath: string; found: number }) =>
      `${databasePath} holds schema version ${found}, which this server cannot open`,
    why: 'The database was written by an older or newer schema. The server opens an empty database or one at its own schema version, and repairs nothing.',
    fix: 'Stop the server, back up and delete the database file this error names together with its -wal and -shm files, then start the server to create an empty database.',
  },
})
