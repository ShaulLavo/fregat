import { join } from 'node:path'
import { FileSystemService } from '../../src/fs/service'

/** A filesystem rooted at `root`, as the attachment routes read a server's own disk. */
export function createTestMachineFiles(root: string) {
  const files = new FileSystemService({
    metadataDatabasePath: ':memory:',
    watch: false,
    workspaceEditDriveJournals: false,
    workspaceEditJournalRoot: join(root, '.journals'),
    workspaceRoot: root,
  })
  return { files, close: () => files.close() }
}
