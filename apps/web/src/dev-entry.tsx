import '@workspace/ui/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRenderer } from '@/state/renderer'
import { DevPage } from '@/features/dev/components/page'

const renderer = createRenderer()
const hot = import.meta.hot
if (hot) {
  hot.on('vite:beforeFullReload', renderer.dispose)
  hot.dispose(() => {
    hot.off('vite:beforeFullReload', renderer.dispose)
    renderer.dispose()
  })
}

// The boot-appearance script in dev.html has already applied the app's mode and palette.
renderer.render(
  () => createRoot(document.getElementById('root')!),
  <StrictMode>
    <DevPage />
  </StrictMode>,
)
