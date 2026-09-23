import path from 'node:path'
import { WorkspaceEditJournal, type WorkspaceEditFileSystemDriver } from './workspace-edit-journal'

/** Where an operation's journal lives, and whether moves into it can be a rename. */
export type WorkspaceEditJournalPlacement = {
  readonly device: number
  readonly journal: WorkspaceEditJournal
  readonly kind: 'drive' | 'home'
}

export type WorkspaceEditJournalsOptions = {
  readonly driveJournals: boolean
  readonly driver: WorkspaceEditFileSystemDriver
  readonly homeRoot: string
  /** The highest directory above `absolutePath` still on `device`. Injected by tests. */
  readonly mountTop?: (absolutePath: string, device: number) => Promise<string>
  readonly uid: number
}

/** The hidden per-drive journal, after the freedesktop trash spec's `$topdir/.Trash-$uid`. */
export function driveJournalName(uid: number) {
  return `.platform-journal-${uid}`
}

/**
 * One journal per drive: staging a deleted folder is then a rename, not a copy. A drive whose top
 * is not writable (the root filesystem, `/home`) falls back to the home journal, where resources
 * from another drive are staged by copy-then-remove.
 */
export class WorkspaceEditJournals {
  readonly home: WorkspaceEditJournal
  private homePlacement?: Promise<WorkspaceEditJournalPlacement>
  private readonly placements = new Map<number, Promise<WorkspaceEditJournalPlacement>>()
  private readonly journals = new Map<string, WorkspaceEditJournal>()
  private readonly options: WorkspaceEditJournalsOptions

  constructor(options: WorkspaceEditJournalsOptions) {
    this.options = options
    this.home = new WorkspaceEditJournal(options.homeRoot, options.driver)
    this.journals.set(this.home.root, this.home)
  }

  get internalNames() {
    return [driveJournalName(this.options.uid)]
  }

  known(): readonly WorkspaceEditJournal[] {
    return Array.from(this.journals.values())
  }

  homeJournal() {
    this.homePlacement ??= this.placeHome()
    return this.homePlacement
  }

  async forPath(absolutePath: string): Promise<WorkspaceEditJournalPlacement> {
    const device = (await this.options.driver.stat(absolutePath)).dev
    let placement = this.placements.get(device)
    if (!placement) {
      placement = this.place(absolutePath, device)
      this.placements.set(device, placement)
    }

    return placement
  }

  private async placeHome(): Promise<WorkspaceEditJournalPlacement> {
    await this.home.initialize()
    const device = (await this.options.driver.stat(this.home.root)).dev
    return { device, journal: this.home, kind: 'home' }
  }

  private async place(absolutePath: string, device: number) {
    const home = await this.homeJournal()
    if (!this.options.driveJournals || home.device === device) return home

    const mountTop = this.options.mountTop ?? ((input) => this.mountTop(input, device))
    const root = path.join(await mountTop(absolutePath, device), driveJournalName(this.options.uid))
    const journal = this.journals.get(root) ?? new WorkspaceEditJournal(root, this.options.driver)
    try {
      await journal.initialize()
    } catch {
      return home
    }
    if ((await this.options.driver.stat(journal.root)).dev !== device) return home

    this.journals.set(journal.root, journal)
    return { device, journal, kind: 'drive' as const }
  }

  private async mountTop(absolutePath: string, device: number) {
    let candidate = absolutePath
    while (true) {
      const parent = path.dirname(candidate)
      if (parent === candidate) return candidate
      if ((await this.options.driver.stat(parent)).dev !== device) return candidate
      candidate = parent
    }
  }
}
