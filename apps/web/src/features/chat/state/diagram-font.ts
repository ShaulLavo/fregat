type FontSnapshot = { readonly fontFamily: string; readonly generation: number }

export function createDiagramFontSource() {
  let generation = 0
  let snapshot: FontSnapshot = { fontFamily: readFont(), generation }
  const read = () => {
    const fontFamily = readFont()
    if (snapshot.fontFamily !== fontFamily || snapshot.generation !== generation)
      snapshot = { fontFamily, generation }
    return snapshot
  }
  const subscribe = (notify: () => void) => {
    const loaded = () => {
      generation += 1
      notify()
    }
    const observer = new MutationObserver(notify)
    observer.observe(document.head, { childList: true, characterData: true, subtree: true })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    document.fonts.addEventListener('loadingdone', loaded)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', loaded)
    }
  }
  return { read, subscribe }
}

function readFont() {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()
}

export type DiagramFontOutcome = 'loaded' | 'failed' | 'gave-up'

/**
 * Waits until the faces that set `text` in `fontFamily` have loaded, failed, or `waitMs` passed.
 * `document.fonts.ready` misses these: a face no text has used yet starts loading only when
 * the measurement asks for it, after the measurement has used the fallback.
 */
export async function diagramFontLoaded(
  fontFamily: string,
  text: string,
  waitMs: number,
): Promise<DiagramFontOutcome> {
  const fonts = globalThis.document?.fonts
  if (!fonts) return 'loaded'

  let timer: ReturnType<typeof setTimeout> | undefined
  const giveUp = new Promise<'gave-up'>((resolve) => {
    timer = setTimeout(() => resolve('gave-up'), waitMs)
  })
  // Labels are regular; class and entity titles are bold.
  const loads = ['400', '700'].map((weight) => fonts.load(`${weight} 1em ${fontFamily}`, text))
  const settled = Promise.allSettled(loads).then((results) =>
    results.every((result) => result.status === 'fulfilled') ? 'loaded' : 'failed',
  )
  const outcome = await Promise.race([settled, giveUp])
  clearTimeout(timer)
  return outcome
}
