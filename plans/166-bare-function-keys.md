# Bare function keys in text fields

Owner decision, 2026-09-26, supplement to [Plan 166](166-shortcuts-editor.md).

Unmodified F1–F12 reach app commands while a text field has focus, including settings search,
the palette input, and the chat composer. Function keys insert no characters. After Escape
closes the palette and restores settings search, F1 opens the palette again.

This also applies to a command rebound to a bare function key whose default binding yields
to text entry, such as session undo. Every other key retains its existing text-field behavior,
including letters, navigation keys, modified function keys, and keys beyond F12. Editor command
targeting and availability checks still apply.

Verification: the keymap hook tests cover F1–F12 and unchanged yielding behavior; the browser
command-focus tests cover input, textarea, contenteditable, and native Editor typing and F1.
The `text-field-fkeys` scenario covers settings search, Escape focus restoration, and F1 in the
palette input. The native Editor already passes unhandled function keys to the app.
