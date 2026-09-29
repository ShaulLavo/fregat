# Plan 247: Add terminal vi selection mode

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 205, Plan 206, Plan 246. Size: L. Triage: ZT-28.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Navigate and select terminal scrollback with vi keys while keeping shell input under the terminal owner.

## Zed behavior

`terminal::ToggleViMode` switches the emulator into scrollback navigation and selection mode.
The view publishes `Terminal` plus `vi_mode` and screen context. See
`crates/terminal_view/src/terminal_view.rs:888` and `:1060`.

The engine handles h/j/k/l and arrows; w/b/e word motion; %, 0, ^, and $ boundaries;
H/M/L viewport positions; paragraph motions; g/G; and Ctrl+B/F/U/D scrolling. v starts character
selection, V starts line selection, Escape clears selection, y copies, and i returns to the
bottom and leaves the mode. See `crates/terminal/src/terminal.rs:2280` through `:2381`.
These internal keys are required behavior behind the one inventoried action.

## Existing implementation

[Terminal commands](../apps/web/src/features/terminal/utils/commands.ts) already own copy/paste
and select-all. [Terminal panel](../apps/web/src/features/terminal/components/panel.tsx) retains
the emulator across layout changes. ghostty's
`/work/projects/ghostty-webgpu/src/xterm/terminal.ts` exposes selection and viewport methods;
no vi-mode owner was found there. Editor's cursor styles and modal plans concern document
editing. Implement this engine in `ghostty-webgpu/` after Plan 207.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- ghostty owns independent per-terminal input/navigation/character-selection/line-selection
  state and a viewport cursor. Track terminal cells, wrapped logical lines, and history identity,
  including wide glyphs and combining characters. Scrolling follows that cursor while navigating.
- Add `terminal.toggleViMode` and typed motion/selection commands to the catalog/table. Route
  them through Plan 205's host node and Plan 206 preset data for `Terminal && vi_mode`.
  Hosted ghostty installs no listener. Export standalone mode bindings as data for other hosts.
- Consume navigation-mode printable keys before PTY forwarding. Escape clears an active selection;
  i restores input and the live bottom. Unrecognized mode keys cannot leak text into the shell.
  Keep ordinary app commands available through explicit context resolution.
- Copy through the existing clipboard mutation owner. Expose mode/cursor/selection changes
  through emulator lifecycle subscriptions; retain the mode with its terminal, and reset it on
  emulator reset. On screen switches clamp or clear the cursor/selection to valid screen state.
- Show mode and selection through shared Fregat status/tooltip primitives, with accessible labels.
  Emulator cursor rendering belongs to ghostty. Add settings only if a new user knob is required,
  registering it in the same pass.

## Steps

- [ ] Add failing emulator fixtures for toggle, motion, selection, copy, exit, and PTY suppression.
- [ ] Implement cell-aware mode state, viewport cursor, selection, and history-eviction handling.
- [ ] Add typed commands, published context keys, standalone binding data, and hosted preset rows.
- [ ] Integrate mode indication and clipboard mutation ownership in Fregat.
- [ ] Add `terminal-vi-selection` scenario and selectors using fixture PTY output.

## Acceptance

Run focused ghostty mode tests with wrapped lines, tabs, wide/combining glyphs, empty scrollback,
resize/reflow, and history eviction. Cover normal/alternate-screen transitions and detach/reattach.
`terminal-vi-selection` toggles vi mode, moves across an offscreen wrapped word, selects characters
and lines, copies, clears selection, and exits with i. Assert navigation sends zero PTY bytes and
ordinary input resumes once after exit. An adjacent Editor keeps its own cursor and mode.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run deploy` or `bun run deploy --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Editor Vim/Helix, shell readline vi, launching Neovim, and macro/operator editing of terminal output.
