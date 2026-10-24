# Demo startup

Removed the screenshot preview and the CSS rule hiding the iframe until ready. The real application now renders normally while it loads. No font preload or additional startup delay was added. The existing screenshot remains only the social image.

Headed Chromium, same `scenario demo-startup` drive:

- Before: `/work/tmp/fregat-evidence/20260914T164518Z-scenario-demo-startup/`. Read `01-loading.png`. The screenshot was visible while the real iframe was hidden. Inspection: `visible: false`, `previews: 1`. Result: `failed: Startup still contains a screenshot preview.`
- After: `/work/tmp/fregat-evidence/20260914T164559Z-scenario-demo-startup/`. Read both screenshots. Inspection: `visible: true`, `previews: 0`. Result: `completed`. No browser problems.

The production site build passed: `/work/tmp/fregat-direct-demo-build.log`.
