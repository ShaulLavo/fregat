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

// A face that never arrives costs this long, then the diagram measures with what is there.
const FONT_WAIT_MS = 3_000

/**
 * Waits until the faces that set `text` in `fontFamily` have loaded, or gives up.
 * `document.fonts.ready` misses these: a face no text has used yet starts loading only when
 * the measurement asks for it, after the measurement has used the fallback.
 */
export async function diagramFontLoaded(
  fontFamily: string,
  text: string,
): Promise<'loaded' | 'gave-up'> {
  const fonts = globalThis.document?.fonts
  if (!fonts) return 'loaded'

  let timer: ReturnType<typeof setTimeout> | undefined
  const giveUp = new Promise<'gave-up'>((resolve) => {
    timer = setTimeout(() => resolve('gave-up'), FONT_WAIT_MS)
  })
  // Labels are regular; class and entity titles are bold.
  const loads = ['400', '700'].map((weight) => fonts.load(`${weight} 1em ${fontFamily}`, text))
  const loaded = Promise.allSettled(loads).then(() => 'loaded' as const)
  const outcome = await Promise.race([loaded, giveUp])
  clearTimeout(timer)
  return outcome
}
