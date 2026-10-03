# Window keymap presets

Zed and ours start from the same translations of Zed assets/keymaps/default-linux.json and default-macos.json at commit a84689073d296dfd39987bc7dd478e43ef76d83a. Unmapped actions stay in the data with their original context and action for the Settings report. Linux rows also serve Windows. Ours began as an exact copy. Plan 206 explicitly requires Mod+[ / Mod+] to navigate between documents from an Editor, so its four conflicting Linux/macOS indent/outdent rows become Workspace navigation bindings. The rows retain their upstream action and record the authorized deviation. Zed keeps its original indent/outdent keys.

The VS Code application rows were extracted from Fregat command metadata before the window-dispatcher cutover. Named Editor packs supply its Editor layer. Terminal application defaults live separately in apps/tui/src/commands/presets/default.json.
