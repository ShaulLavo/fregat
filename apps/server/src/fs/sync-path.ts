import type { WorkspaceEditFileSystemDriver } from './workspace-edit-journal'

export async function syncPath(driver: WorkspaceEditFileSystemDriver, target: string) {
  const handle = await driver.open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
