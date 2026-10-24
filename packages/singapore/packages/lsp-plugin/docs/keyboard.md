# keyboard

the completion list and the signature hint are driven by editor commands. the plugin listens to no keys itself

| command                                                | does                                   |
| ------------------------------------------------------ | -------------------------------------- |
| `editor.action.triggerSuggest`                         | opens the completion list (Ctrl+Space) |
| `selectNextSuggestion`, `selectPrevSuggestion`         | moves the selection one item           |
| `selectNextPageSuggestion`, `selectPrevPageSuggestion` | moves the selection one page           |
| `acceptSelectedSuggestion`                             | inserts the selected item              |
| `hideSuggestWidget`                                    | closes the list                        |
| `closeParameterHints`                                  | closes the signature hint              |
| `showNextParameterHint`, `showPrevParameterHint`       | cycles overloads                       |

the core's `suggest` keymap pack binds them under context keys this plugin registers: `suggestWidgetVisible`, `parameterHintsVisible` and `parameterHintsMultipleSignatures`

a host that turns the editor's keymap off, or drops that pack, binds these commands itself. otherwise the list cannot be driven from the keyboard

the commands are part of the adapter plugin's `commands` option, so `commands: []` registers none of them
