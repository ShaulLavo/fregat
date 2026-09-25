import '@workspace/ui/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DevPage } from '@/features/dev/components/page'

// The boot-appearance script in dev.html has already applied the app's mode and palette.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
)
