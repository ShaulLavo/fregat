import { dlopen, FFIType } from 'bun:ffi'

/**
 * Electrobun opens its Linux file chooser with no parent window, so the
 * compositor has nothing to centre it on and Hyprland leaves it at the origin.
 * With GTK_USE_PORTAL set, GtkFileChooserNative hands the dialog to the desktop
 * portal instead: a native Wayland window, centred, in the desktop's own theme.
 *
 * GTK reads the variable from the C environment, which `Bun.env` does not
 * write to, so this goes through libc. It only has to land before the first
 * dialog; the wrapper's own gtk_init has already run by the time this loads.
 */
export function preferPortalDialogs(platform: string) {
  if (platform !== 'linux') return

  const libc = dlopen('libc.so.6', {
    setenv: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  libc.symbols.setenv(Buffer.from('GTK_USE_PORTAL\0'), Buffer.from('1\0'), 0)
  libc.close()
}
