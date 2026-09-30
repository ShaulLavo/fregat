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
