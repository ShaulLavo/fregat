/**
 * The one surface a tool panel or rail paints, wherever it is composed. It is
 * translucent, so a second surface inside a region that already carries this
 * only doubles the alpha — the darker neutral also scrims the wallpaper where a
 * lighter one veils it, and it is the tone a `bg-muted` chip still steps away
 * from.
 */
export const PANEL_SURFACE = 'bg-background'

/**
 * The glass behind every panel surface, set once on the region that holds them.
 * A backdrop blur reads only the pixels inside its own box, so two blurred
 * neighbours sample the wallpaper apart and a seam shows where they meet.
 */
export const PANEL_GLASS = 'backdrop-material'
