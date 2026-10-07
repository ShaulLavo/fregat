# Server update

The desktop titlebar and phone header show `Update app` when the server has a staged release. A served web release that differs from the loaded document shows `Reload app`. The control reads socket announcements and checks `/release` on tab focus, connection changes and the `developer.clientUpdateCheckSeconds` interval.

- An update with no running sessions sends the restart request immediately. Progress follows restarting, reconnecting and readiness.
- An update with running sessions opens the `Update now?` popover. It lists the affected sessions and unsaved files. `Update when done` waits for authoritative busy state to clear. `Update now` interrupts the accepted session list; newly busy sessions require another confirmation.
- Reload waits for unsaved buffers to be saved and for the exact staged release to pass its required live check. A page-only update uses the already served web release.
- The reload control paints a spinner and `Reloading…` before browser navigation starts, then stays disabled until the document is replaced. The new document clears that transient progress. On the phone, Settings and the other header actions keep their positions when the update control disappears.
- A failed deployment check shows its actual failure. Shared log history stays diagnostic and cannot fail the deployment.

`scenario server-update` stages a release into the throwaway server, starts a fixture turn, checks confirmation and waiting, intercepts the restart request, and publishes a failed live-check report. It then checks manual web reloads on desktop and phone. Real server exit and promotion are owner checks on the configured deployment target.

`scenario phone-update-reload` uses a touch phone viewport and an isolated served-release fixture. It holds the new document response, records busy feedback at navigation, captures the waiting page through CDP on Chromium, and checks Settings coordinates before and after reload. A repeated tap at the old reload position must leave the session list open. WebKit checks the same navigation feedback and coordinates. The Vite document receives the release meta tag used by built HTML.
