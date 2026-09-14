export function alignEmbeddedDemoWallpaper(): void {
  if (window.parent === window) return
  const toolbar = document.querySelector<HTMLElement>('[aria-label="Window toolbar"]')
  if (!toolbar) return

  const style = document.createElement('style')
  const align = () => {
    // The landing frame occupies 85% × 84% of the shared garden scene.
    const width = window.innerWidth / 0.85
    const height = window.innerHeight / 0.84
    const left = (window.innerWidth - width) / 2
    const top = (window.innerHeight - height) / 2 - toolbar.getBoundingClientRect().bottom
    style.textContent = `[data-workbench] img[data-workbench-wallpaper-layer] {
      width: ${width}px !important; height: ${height}px !important;
      max-width: none !important; left: ${left}px !important; top: ${top}px !important;
      right: auto !important; bottom: auto !important; object-fit: cover !important;
    }`
  }
  document.head.append(style)
  const observer = new ResizeObserver(align)
  observer.observe(toolbar)
  addEventListener('pagehide', () => observer.disconnect(), { once: true })
  align()
}
