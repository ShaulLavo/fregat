# How other products show their app on the landing page

Survey for [Plan 155](../../plans/155-site-demo-replica.md), 2026-09-25. Each homepage was loaded in
headless Chromium 1440×900 (Playwright 1.63) and left for 10 s. The probe recorded:

- bytes on the wire (CDP `encodedDataLength`);
- the videos, canvases, iframes and images wider than 600 px within 1.6 viewports of the top;
- DOM mutations in the 4 s after the first 6 s.

A hero counts as a **DOM replica** when its UI text is in the server HTML (`curl` plus `grep` for a
string from the screenshot). The probe is `/work/tmp/research/155/survey.mjs`, in scratch.

| Site                                                  | Hero technique                                                   | Evidence                                                                                          | Page on the wire |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| [cursor.com](cursor-demo.md)                          | **DOM replica, scripted**                                        | Full teardown in cursor-demo.md                                                                   | 6.9 MB           |
| linear.app                                            | **DOM replica**                                                  | "Faster app launch" issue in the HTML; no video or canvas; 69 mutations in 4 s                    | 2.9 MB           |
| zed.dev                                               | **DOM replica** of the editor (panes, tabs, agent thread)        | "AccessKit" and `scheduler.tsx` in the HTML; the only canvas is a 15%-opacity noise layer         | 2.5 MB           |
| devin.ai                                              | **DOM replica** of the agent app                                 | "Add enterprise SSO" ×3 in the HTML                                                               | 2.2 MB           |
| windsurf.com (now "Devin Desktop")                    | **DOM replica**: a board of agent sessions                       | Session titles in the HTML; no media                                                              | 2.1 MB           |
| ghostty.org                                           | **DOM text animation**: the ASCII ghost inside a terminal window | 9,326 mutations in 4 s (text frames swapped), no canvas, 204 elements                             | 575 KB           |
| conductor.build                                       | Still screenshot                                                 | `conductor-app-hero-light.webp` at 1366 px                                                        | 1.3 MB           |
| kiro.dev                                              | Still screenshots                                                | `session-pr.png`, `secondary-specs.png`                                                           | 3.8 MB           |
| factory.ai                                            | Looping video                                                    | `desktop-overview.mp4` autoplay loop, 1390 px                                                     | 1.1 MB           |
| opencode.ai                                           | Looping video                                                    | `opencode-min.mp4` autoplay loop, **10.4 MB**                                                     | 10.6 MB          |
| superhuman.com                                        | Two videos, autoplay, no loop                                    | two `hero-*-2x.mp4`, 1.75 MB each                                                                 | 6.1 MB           |
| augmentcode.com                                       | Micro-loop video                                                 | `…-microloop.mp4`, 192 KB                                                                         | 1.9 MB           |
| ampcode.com                                           | Click-to-play videos                                             | two MP4s, `autoplay=false`                                                                        | 3.8 MB           |
| raycast.com                                           | WebGL art (no app replica)                                       | 1200×967 canvas                                                                                   | 3.0 MB           |
| warp.dev                                              | Canvas art (no app replica)                                      | 1440×924 canvas; 13 MB of images                                                                  | 16 MB            |
| t3code (`references/t3code/apps/marketing`, 7a12aff4) | Still screenshot and CSS motion, gated                           | `app-desktop.webp`; `src/lib/homeMotion.ts` sets `animation-play-state` from IntersectionObserver | not measured     |

## What the pattern says

- **The editor and agent tools we compete with draw their app as DOM**: Cursor, Zed, Linear and
  Devin/Windsurf. None of them runs its real app in the page. Each draws a copy whose first frame
  is in the server HTML.
- **Video is the other common answer, and it is heavy.** opencode puts 10.4 MB on the wire for its
  hero loop. Augment's 192 KB micro-loop shows how small a video can get, and its text is not
  readable at that size.
- **Screenshots are the cheapest honest option** (Conductor, Kiro, t3code). They carry no motion
  and no story.
- **Nobody embeds the live app.** fregat's iframe of the full web app is the outlier. It is also
  the only hero on this list that can fail to start: see the plan's findings.

## What to take

- **Zed** is the closest product (an editor built from scratch with agents in panes). Its hero is
  nearly still DOM (35 mutations in 4 s) with a "Watch demo" button beside it. That is the
  fallback shape if the scripted replay is cut: the same replica markup, and no player.
- **Ghostty** shows that a DOM text animation can be cheap and still read as "terminal". 575 KB
  for the whole page, with the frames as text.
- **Linear and Devin** keep the replica nearly still (Linear: 69 mutations in 4 s; Devin: 3). A
  replica does not need a busy story to read as the product. A short story that settles into a
  held frame is enough.
