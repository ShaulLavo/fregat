/**
 * The channel the editor says things on.
 *
 * Every outcome this editor produces is drawn — a cursor appears, a run of matches lights up, a key
 * starts meaning something else — and a reader who is not looking at the drawing is told none of it.
 * A live region is the only way a browser has to speak something the user did not move to, so what
 * an action did that is worth knowing is written here.
 *
 * Two details are what make one work, and both read as superstition right up until they are the
 * reason nothing was spoken. The same string written into the same region twice is not a change, so
 * the second press of a key that lands on the same answer is silent — writing into the other half of
 * a pair makes it a change again. And several reader-and-browser pairs will not speak an alert whose
 * element they have not seen move, so each message is written behind a momentary hide.
 */

/** Assertive interrupts what is being read; polite waits for a gap in it. */
type EditorAnnouncementUrgency = 'assertive' | 'polite'

/**
 * A message is pasted into the document tree and read back out of it whole, so its length is paid
 * twice and a long one stalls the browser rather than the reader. Nothing the editor has to say
 * comes near this, which is the point: the cap is for the message that got a document in it.
 */
const MAX_ANNOUNCEMENT_LENGTH = 20_000

/**
 * Out of the way of the page without being out of the accessibility tree. `display: none` and
 * `visibility: hidden` both take a region out of what the reader walks, which for anything else is
 * how you hide something and here is how you silence it.
 */
const ANNOUNCEMENT_ROOT_STYLE =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;'

type AnnouncementRegionPair = readonly [HTMLElement, HTMLElement]

type AnnouncementRegions = {
  readonly root: HTMLElement
  readonly assertive: AnnouncementRegionPair
  readonly polite: AnnouncementRegionPair
}

export class EditorAnnouncer {
  private readonly container: HTMLElement
  private regions: AnnouncementRegions | null = null
  private disposed = false

  constructor(container: HTMLElement) {
    this.container = container
  }

  /** Interrupts: a mode the user just changed and is waiting to hear the new meaning of. */
  alert(message: string): void {
    this.write('assertive', message)
  }

  /** Takes its turn: what an action ended up doing, which the user can keep working through. */
  status(message: string): void {
    this.write('polite', message)
  }

  dispose(): void {
    this.disposed = true
    this.regions?.root.remove()
    this.regions = null
  }

  private write(urgency: EditorAnnouncementUrgency, message: string): void {
    if (this.disposed) return

    const regions = this.mountedRegions()
    const [first, second] = urgency === 'assertive' ? regions.assertive : regions.polite
    // Whichever half is not already holding this message takes it, so a repeat arrives as a change
    // rather than as a write of what is already there. The other half is emptied because both of
    // them are live: a sentence left standing in one is a sentence that can be read out again.
    const target = first.textContent === message ? second : first
    const emptied = target === first ? second : first
    emptied.textContent = ''
    insertAnnouncement(target, message)
  }

  /**
   * Built on the first thing there is to say. Most editors on a page never say anything, and four
   * nodes a host did not ask for and nothing ever writes to are four nodes it has to account for.
   */
  private mountedRegions(): AnnouncementRegions {
    const existing = this.regions
    if (existing) return existing

    const ownerDocument = this.container.ownerDocument
    const root = ownerDocument.createElement('div')
    root.className = 'editor-announcements'
    root.style.cssText = ANNOUNCEMENT_ROOT_STYLE
    const regions: AnnouncementRegions = {
      root,
      assertive: [
        createAnnouncementRegion(ownerDocument, 'assertive'),
        createAnnouncementRegion(ownerDocument, 'assertive'),
      ],
      polite: [
        createAnnouncementRegion(ownerDocument, 'polite'),
        createAnnouncementRegion(ownerDocument, 'polite'),
      ],
    }
    root.append(...regions.assertive, ...regions.polite)
    this.container.appendChild(root)
    this.regions = regions

    return regions
  }
}

function createAnnouncementRegion(
  ownerDocument: Document,
  urgency: EditorAnnouncementUrgency,
): HTMLElement {
  const element = ownerDocument.createElement('div')
  element.setAttribute('role', urgency === 'assertive' ? 'alert' : 'status')
  element.setAttribute('aria-live', urgency)
  // Spoken whole rather than by the part of it that changed: two of these messages a keystroke apart
  // differ by a digit, and the digit on its own is not a sentence.
  element.setAttribute('aria-atomic', 'true')
  return element
}

function insertAnnouncement(target: HTMLElement, message: string): void {
  target.textContent =
    message.length > MAX_ANNOUNCEMENT_LENGTH ? message.slice(0, MAX_ANNOUNCEMENT_LENGTH) : message
  target.style.visibility = 'hidden'
  target.style.visibility = 'visible'
}
