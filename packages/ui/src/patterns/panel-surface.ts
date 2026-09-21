/**
 * The one surface a tool panel or rail paints, wherever it is composed. It is
 * translucent, so a second surface inside a region that already carries this
 * only doubles the alpha — the darker neutral also scrims the wallpaper where a
 * lighter one veils it, and it is the tone a `bg-muted` chip still steps away
 * from.
 */
export const PANEL_SURFACE = 'bg-background backdrop-material'
