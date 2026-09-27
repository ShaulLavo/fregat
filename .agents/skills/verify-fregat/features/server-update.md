# Server update

The titlebar's right cell shows "Update available" with a Restart button once `deploy --server` has staged a release (`<production root>/pending`) and told the server. The item reads only the `server.update` frames the orchestration socket pushes; it never polls `/release`.

- Restart with nothing running restarts at once and the item turns to "Restarting…".
- Restart with sessions running opens the "Restart server" alertdialog, which lists each session by title with its state. Cancel changes nothing; confirming sends the listed ids, and a session that became busy meanwhile comes back as a new list in place.
- A failed deployment check newer than the page shows the actual failed check. Shared 24-hour log noise stays diagnostic and cannot fail the deployment.
- A web release different from the loaded document shows a persistent `Update available` toast with `Refresh`. It checks `/release` on return to the tab and at `developer.clientUpdateCheckSeconds` while visible, independent of the running server version. Only clicking Refresh reloads the page. This prompt stays available at the connection gate too.

`scenario server-update` stages a release into the throwaway server's `PLATFORM_PRODUCTION_ROOT` and sends SIGUSR2, starts a native turn, opens and cancels the confirmation, answers the idle Restart through `page.route` (so the unsupervised server keeps running), then points `current` at a release with a failed `live-check.json`. Steps: `update-available`, `restart-confirmation`, `restarting`, `live-check-failed`. The real exit and promotion are owner checks on the mesh.

The same `scenario server-update` then checks desktop and phone clients by changing the isolated server's served release file. It checks a matching client, a stale client with no automatic reload, and a manual refresh that clears the prompt. The Vite document receives the same release meta tag deployment stamps into built HTML.
