import path from 'node:path'
import { scriptErrors } from '../structured-errors'
import { scratchRoot } from './paths'

export function outerWaylandDisplay(env: NodeJS.ProcessEnv): string {
  const display = env.WAYLAND_DISPLAY
  if (!display)
    throw scriptErrors.INVALID_INPUT({
      message: 'An outer Wayland display is required for the private native proof.',
      internal: { stage: 'outer-display' },
    })
  if (path.isAbsolute(display)) return display
  if (!env.XDG_RUNTIME_DIR)
    throw scriptErrors.INVALID_INPUT({
      message: 'The outer Wayland runtime directory is required for a relative display socket.',
      internal: { stage: 'outer-runtime' },
    })
  return path.resolve(env.XDG_RUNTIME_DIR, display)
}

export function isPrivateDisplayRuntime(directory: string, root = scratchRoot): boolean {
  return (
    // Native proof processes use an isolated TMPDIR inside their owning runtime.
    (path.dirname(path.resolve(directory)) === path.resolve(root) ||
      path.resolve(root) === path.resolve(directory, 'home/tmp')) &&
    /^g2d-[a-zA-Z0-9]+$/.test(path.basename(directory))
  )
}
