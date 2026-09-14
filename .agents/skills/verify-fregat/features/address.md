# Address URL

The URL is the app state: environment, workspace, mode, document, tabs, selection, side panel, search, log filters, settings category.

## Sub-features

Workspace token `~<name>.<id>`, `workbench` and `chat` modes, document token, tabs with the selected one marked, `#L` focus, search and log parameters.

## How to get to it (user POV)

Copy the URL from the browser. Paste it to an agent to put it in the same state.

## Driving it with agent:browser

`look --url <address>` or `scenario <name> --url <address>`. The CLI registers a workspace address itself when the URL names none: `POST /fs/workspace-address` with a root-relative path.

## Gotchas

Workspace ids are server-assigned; a path is not an address. Requests to the API need an `Origin` of the web app or they are refused as untrusted.
