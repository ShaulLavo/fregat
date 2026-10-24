import { copyTextRange } from './textSpans'

type TextBacking = { text: string }

// Logical text stays immutable while maintenance moves its physical backing.
export class TextPage {
  readonly length: number
  private backing: TextBacking

  constructor(
    text: string | TextBacking,
    private start = 0,
    end?: number,
  ) {
    this.backing = typeof text === 'string' ? { text } : text
    this.length = (end ?? this.backing.text.length) - start
  }

  get storageLength(): number {
    return this.backing.text.length
  }

  charCodeAt(offset: number): number {
    if (offset < 0 || offset >= this.length) return Number.NaN
    return this.backing.text.charCodeAt(this.start + offset)
  }

  slice(start: number, end: number): string {
    return this.backing.text.slice(this.start + start, this.start + end)
  }

  detach(): void {
    this.backing = { text: copyTextRange(this.backing.text, this.start, this.start + this.length) }
    this.start = 0
  }
}

type BorrowedPage = {
  readonly owner: WeakRef<TextPageOwner>
  readonly page: WeakRef<TextPage>
  readonly ranges: Map<string, BorrowedPage>
  readonly key: string
}

function forgetPage(entries: Set<BorrowedPage>, entry: BorrowedPage): void {
  entries.delete(entry)
  if (entry.ranges.get(entry.key) === entry) entry.ranges.delete(entry.key)
}

const releasedPages = new FinalizationRegistry<{
  entries: Set<BorrowedPage>
  entry: BorrowedPage
}>(({ entries, entry }) => forgetPage(entries, entry))

// Branches share this registry so readers of discarded predecessor logs are still found.
export class TextPageRegistry {
  private readonly entries = new Set<BorrowedPage>()
  private readonly owners = new WeakMap<
    TextPageOwner,
    { backing: TextBacking; ranges: Map<string, BorrowedPage> }
  >()

  borrow(owner: TextPageOwner, text: string, start: number, end: number): TextPage {
    let source = this.owners.get(owner)
    if (!source) {
      source = { backing: { text }, ranges: new Map() }
      this.owners.set(owner, source)
    }
    // One owner exposes immutable prefixes; old views cannot move its backing backwards.
    if (text.length > source.backing.text.length) source.backing.text = text
    const { ranges, backing } = source
    const key = `${start}:${end}`
    const previous = ranges.get(key)
    const cached = previous?.page.deref()
    if (cached) return cached
    if (previous) this.forget(previous)
    const page = new TextPage(backing, start, end)
    const entry = { owner: new WeakRef(owner), page: new WeakRef(page), ranges, key }
    ranges.set(key, entry)
    this.entries.add(entry)
    releasedPages.register(page, { entries: this.entries, entry }, entry)
    return page
  }

  *detachRetired(retained: ReadonlySet<TextPageOwner>): Generator<void> {
    let visited = 0
    for (const entry of this.entries) {
      if (++visited % 256 === 0) yield
      const page = entry.page.deref()
      const owner = entry.owner.deref()
      if (page && owner && retained.has(owner)) continue
      page?.detach()
      this.forget(entry)
      yield
    }
  }

  private forget(entry: BorrowedPage): void {
    forgetPage(this.entries, entry)
    releasedPages.unregister(entry)
  }
}

export class TextPageOwner {
  constructor(
    private readonly registry: TextPageRegistry,
    private readonly independent = false,
  ) {}

  page(text: string, start: number, end: number): TextPage {
    if (this.independent) return new TextPage(text, start, end)
    return this.registry.borrow(this, text, start, end)
  }
}
