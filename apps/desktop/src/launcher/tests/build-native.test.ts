import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'
import { buildNative } from '../../../scripts/build-native'

const desktopDir = path.resolve(import.meta.dirname, '../../..')

test('native hosts require explicit persistent storage and parse named window options', async () => {
  for (const source of ['macos/platform-webview.m', 'linux/platform-webview.c']) {
    const text = await Bun.file(path.join(desktopDir, 'native', source)).text()
    expect(text).toContain('--data-dir')
    expect(text).toContain('--vibrancy')
    expect(text).toMatch(/for \(int i = 3; i < argc; i\+\+\)/)
    expect(text).toContain('Native window options invalid')
    expect(text).not.toContain('nonPersistentDataStore')
  }
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  expect(mac).not.toContain('_WKWebsiteDataStoreConfiguration')
  expect(mac).not.toContain('_initWithConfiguration:')
  expect(mac).toContain('if (@available(macOS 14.0, *))')
  expect(mac).toContain('WKWebsiteDataStore dataStoreForIdentifier:identifier')
  expect(mac).toContain('WKWebsiteDataStore.defaultDataStore')
  expect(mac).toContain('CC_SHA256(pathData.bytes')
  expect(mac).toContain('stringByStandardizingPath.stringByResolvingSymlinksInPath')
  expect(mac).not.toContain('@interface WKWebsiteDataStore (PlatformStorage)')
  expect(mac).toContain(
    'if (@available(macOS 12.0, *)) view.underPageBackgroundColor = NSColor.clearColor',
  )
  const linux = await Bun.file(path.join(desktopDir, 'native/linux/platform-webview.c')).text()
  expect(linux).toContain('webkit_website_data_manager_new(')
  expect(linux).toContain('"base-data-directory", data_dir')
  expect(linux).toContain('"base-cache-directory", cache_dir')
  expect(linux).toContain('webkit_web_context_new_with_website_data_manager')
  expect(linux).toContain('webkit_cookie_manager_set_persistent_storage')
})

test('macOS publishes actual fullscreen state to the app document', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  expect(mac).toContain('self.window.styleMask & NSWindowStyleMaskFullScreen')
  expect(mac).toContain("toggleAttribute('data-native-fullscreen'")
  expect(mac).toContain("new Event('platform-native-window-state')")
  expect(mac).toContain('location.origin !== new URL(')
  expect(mac).toContain(
    'initWithSource:[self windowStateSource] injectionTime:WKUserScriptInjectionTimeAtDocumentStart',
  )
  expect(mac).toMatch(
    /decidePolicyForNavigationAction:[\s\S]*?\[self refreshWindowStateScript\];\s*decisionHandler\(WKNavigationActionPolicyAllow\)/,
  )
  expect(mac).toMatch(/windowDidEnterFullScreen:[\s\S]*?\[self refreshWindowStateScript\]/)
  expect(mac).toMatch(/windowDidExitFullScreen:[\s\S]*?\[self refreshWindowStateScript\]/)
  expect(mac).toMatch(/\[host refreshWindowStateScript\];\s*\[view loadRequest:/)
  expect(mac).toMatch(/didCommitNavigation:[\s\S]*?\[self publishWindowState\]/)
  expect(mac).toMatch(/didFinishNavigation:[\s\S]*?\[self publishWindowState\]/)
  expect(mac).toContain('if (document.documentElement) { apply(); return; }')
  expect(mac).toContain('new MutationObserver(')
  expect(mac).toContain('observer.disconnect(); apply();')
  expect(mac).toContain('observer.observe(document, { childList: true })')
  expect(mac).toContain('[controller addUserScript:self.startupScript]')
  expect(mac).toMatch(/windowDidEnterFullScreen:[\s\S]*?\[self publishWindowState\]/)
  expect(mac).toMatch(/windowDidExitFullScreen:[\s\S]*?\[self publishWindowState\]/)
})

test('macOS publishes fullscreen targets at animation start and reconciles completion or failure', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  expect(mac).toContain('@property(strong) NSNumber *fullscreenTarget;')
  expect(mac).toMatch(
    /BOOL fullscreen = self\.fullscreenTarget \? self\.fullscreenTarget\.boolValue\s*:\s*\(self\.window\.styleMask & NSWindowStyleMaskFullScreen\) != 0;/,
  )
  for (const [callback, target] of [
    ['windowWillEnterFullScreen', '@YES'],
    ['windowWillExitFullScreen', '@NO'],
    ['windowDidEnterFullScreen', 'nil'],
    ['windowDidExitFullScreen', 'nil'],
    ['windowDidFailToEnterFullScreen', 'nil'],
    ['windowDidFailToExitFullScreen', 'nil'],
  ]) {
    const body = mac.match(new RegExp(`- \\(void\\)${callback}:\\([^)]*\\)[^{]*\\{([^}]+)\\}`))?.[1]
    expect(body, callback).toBeDefined()
    expect(body).toMatch(
      new RegExp(
        `self\\.fullscreenTarget = ${target};\\s*\\[self refreshWindowStateScript\\];\\s*\\[self publishWindowState\\];`,
      ),
    )
  }
  for (const callback of ['windowDidFailToEnterFullScreen', 'windowDidFailToExitFullScreen']) {
    expect(mac).toContain(`- (void)${callback}:(NSWindow *)window`)
  }
})

test('macOS fills content bounds and outsets the glass rim beyond their clip', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  const mount = mac.match(/- \(void\)mountContentView:\(NSView \*\)view \{([\s\S]*?)\n\}/)?.[1]
  expect(mount).toBeDefined()
  expect(mount).toContain('NSView *content = self.window.contentView;')
  expect(mount).toContain('view.translatesAutoresizingMaskIntoConstraints = NO;')
  expect(mount).toContain('[content addSubview:view];')
  expect(mount).toContain('[NSLayoutConstraint activateConstraints:@[')
  expect(mount).toContain('CGFloat outset = view == self.glassEffect ? 4 : 0;')
  for (const [edge, constant] of [
    ['leading', '-outset'],
    ['trailing', 'outset'],
    ['top', '-outset'],
    ['bottom', 'outset'],
  ]) {
    expect(mount).toContain(
      `[view.${edge}Anchor constraintEqualToAnchor:content.${edge}Anchor constant:${constant}]`,
    )
  }
  expect(mac).toContain('window.contentView.layer.masksToBounds = YES;')
  expect(mac).toContain('[effect setValue:@0 forKey:@"cornerRadius"];')
  for (const view of ['effect', 'host.glassEffect', 'view']) {
    expect(mac).toContain(`[host mountContentView:${view}];`)
  }
  expect(mac).not.toContain('autoresizingMask')
  expect(mac).not.toContain('contentLayoutGuide')
  expect(mac).not.toContain('safeAreaLayoutGuide')
})

test('macOS clears content and WebKit root layer opacity only in vibrant mode', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  expect(mac).toContain('#import <QuartzCore/QuartzCore.h>')
  const vibrantBlocks = [...mac.matchAll(/if \(vibrant\) \{([\s\S]*?)\n    \}/g)]
  expect(vibrantBlocks).toHaveLength(2)
  expect(vibrantBlocks[0]?.[1]).toMatch(
    /window\.opaque = NO;[\s\S]*?window\.contentView\.wantsLayer = YES;\s*window\.contentView\.layer\.opaque = NO;\s*window\.contentView\.layer\.backgroundColor = NSColor\.clearColor\.CGColor;/,
  )
  expect(vibrantBlocks[1]?.[1]).toMatch(
    /\[view setValue:@NO forKey:@"drawsBackground"\];\s*if \(@available\(macOS 12\.0, \*\)\) view\.underPageBackgroundColor = NSColor\.clearColor;\s*view\.layer\.opaque = NO;\s*view\.layer\.backgroundColor = NSColor\.clearColor\.CGColor;/,
  )
  for (const statement of [
    'window.contentView.wantsLayer = YES;',
    'window.contentView.layer.opaque = NO;',
    'window.contentView.layer.backgroundColor = NSColor.clearColor.CGColor;',
    'view.layer.opaque = NO;',
    'view.layer.backgroundColor = NSColor.clearColor.CGColor;',
  ]) {
    expect(mac.split(statement)).toHaveLength(2)
  }
})

test('macOS host getters and methods avoid implicit ARC ownership families', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  const properties = mac.matchAll(/@property\([^)]*\)[^;]*?\b([A-Za-z_]\w*)\s*;/g)
  const methods = mac.matchAll(/^[+-]\s*\([^)]*\)\s*([A-Za-z_]\w*)/gm)
  const ownershipFamily = /^_*(?:init|alloc|new|copy|mutableCopy)(?:$|[^a-z])/
  // Property names declare getter selectors, including ARC's initializer return-type rules.
  for (const declaration of [...properties, ...methods]) {
    expect(declaration[1]).not.toMatch(ownershipFamily)
  }
})

const supported = process.platform === 'linux'
const webkit =
  supported &&
  Bun.which('pkg-config') !== null &&
  Bun.spawnSync(['pkg-config', '--exists', 'webkit2gtk-4.1']).exitCode === 0
const compiler = Bun.which('cc') !== null
function skipReason() {
  if (!supported) return 'Linux host build requires Linux'
  if (!webkit) return 'webkit2gtk-4.1 development files are absent'
  return 'cc is absent'
}

test.skipIf(!webkit || !compiler)(
  `builds the Linux host (${webkit && compiler ? 'native dependencies present' : `skip reason: ${skipReason()}`})`,
  () => {
    const desktopDir = path.resolve(import.meta.dirname, '../../..')
    const output = buildNative(desktopDir, 'installed')
    expect(output).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(output!)).toBe(true)
    for (const options of [
      [],
      ['--data-dir'],
      ['--data-dir', 'relative'],
      ['--unknown'],
      [
        '--data-dir',
        path.join(tmpdir(), 'unused-native-options'),
        '--data-dir',
        path.join(tmpdir(), 'unused-native-options'),
      ],
      ['--data-dir', path.join(tmpdir(), 'unused-native-options'), '--vibrancy', '--vibrancy'],
      ['--vibrancy', '--data-dir', 'relative'],
    ]) {
      const result = Bun.spawnSync([output!, 'http://127.0.0.1', 'unused-script', ...options], {
        env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' },
      })
      expect(result.exitCode).toBe(2)
      expect(result.stderr.toString()).toContain('Native window options invalid')
    }
  },
)

test.skipIf(!supported)(
  'default Electrobun native build needs no optional WebKit/compiler dependencies',
  () => {
    const script = path.resolve(import.meta.dirname, '../../../scripts/build-native.ts')
    const env = { ...process.env, PATH: '/nonexistent-native-build-tools' }
    const result = Bun.spawnSync([process.execPath, script], { env })
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe('')
    const installed = Bun.spawnSync([process.execPath, script, '--shell=installed'], { env })
    expect(installed.exitCode).not.toBe(0)
    expect(installed.stderr.toString()).toContain('desktop.native.BUILD_FAILED')
  },
)

test('default Electrobun and explicit installed-app entrypoints select their own native build', async () => {
  const desktop = path.resolve(import.meta.dirname, '../../..')
  const manifest = await Bun.file(path.join(desktop, 'package.json')).json()
  expect(manifest.scripts.dev).toBe(
    'bun run build:native && bun ../../scripts/run-with-env.ts electrobun dev',
  )
  expect(manifest.scripts.build).toBe('bun run build:native && electrobun build')
  expect(manifest.scripts['build:native']).toBe('bun scripts/build-native.ts')
  const dev = await Bun.file(path.resolve(desktop, '../../scripts/desktop-dev.ts')).text()
  expect(dev).toMatch(/'build:native',\s*'--shell=installed'/)
})

// NOT-PORTABLE: macOS case assumes Xcode clang and SDK without a prerequisite check.
test.skipIf(process.platform !== 'darwin')(
  'builds the macOS native host executable beside the retained Electrobun library',
  () => {
    const desktopDir = path.resolve(import.meta.dirname, '../../..')
    const host = buildNative(desktopDir, 'installed')
    expect(host).toBe(path.join(desktopDir, 'native/build/platform-webview'))
    expect(existsSync(host!)).toBe(true)
    const library = buildNative(desktopDir, 'electrobun')
    expect(library).toBe(path.join(desktopDir, 'native/build/libVibrancy.dylib'))
    expect(existsSync(library!)).toBe(true)
  },
)

test('macOS keeps a negligible behind-window material visible to the compositor for None', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  const alpha = mac.match(/static const CGFloat liveDesktopAlpha = ([\d.]+);/)
  expect(alpha).not.toBeNull()
  expect(Number(alpha?.[1])).toBeGreaterThan(0)
  expect(Number(alpha?.[1])).toBeLessThanOrEqual(0.0001)
  expect(mac).toMatch(
    /effect\.blendingMode = NSVisualEffectBlendingModeBehindWindow;\s*effect\.state = NSVisualEffectStateActive;\s*effect\.alphaValue = liveDesktopAlpha;\s*effect\.hidden = NO;\s*host\.effect = effect;/,
  )
  expect(mac).toContain(
    'self.effect.alphaValue = [material isEqual:@"none"] ? liveDesktopAlpha : 1;',
  )
  expect(mac).toContain('self.effect.hidden = glass;')
  expect(mac).toContain('self.glassEffect.hidden = !glass;')
  expect(mac).not.toMatch(/(?:self|host)\.effect\s*=\s*nil|removeFromSuperview/)
  expect(mac).not.toMatch(/(?:self\.)?effect\.hidden = .*none/)
  expect(mac).toMatch(/\[host mountContentView:effect\];[\s\S]*?\[host mountContentView:view\];/)
})

test('macOS leaves translucent opacity to the page and starts with a clear backdrop', async () => {
  const mac = await Bun.file(path.join(desktopDir, 'native/macos/platform-webview.m')).text()
  expect(mac).toContain('@property(strong) NSVisualEffectView *effect;')
  expect(mac).toMatch(
    /effect.alphaValue = liveDesktopAlpha;\s*effect.hidden = NO;\s*host.effect = effect;/,
  )
  expect(mac).toContain('command[@"windowAppearance"]')
  expect(mac).toContain('CFGetTypeID((__bridge CFTypeRef)opacity) == CFBooleanGetTypeID()')
  expect(mac).toContain('!isfinite(opacityValue) || opacityValue < 0 || opacityValue > 100')
  expect(mac).toContain('appearance[@"material"]')
  expect(mac).not.toContain('appearance[@"frost"]')
  expect(mac).toContain(
    'self.effect.alphaValue = [material isEqual:@"none"] ? liveDesktopAlpha : 1;',
  )
  expect(mac).toContain('@available(macOS 26.0, *)')
  expect(mac).toContain('NSClassFromString(@"NSGlassEffectView")')
  expect(mac).toContain('[effect setValue:@0 forKey:@"style"]')
  expect(mac).toContain('[effect setValue:@0 forKey:@"cornerRadius"]')
  expect(mac).toContain('![@[@"none", @"frosted", @"glass"] containsObject:material]')
  expect(mac).toContain('BOOL glass = [material isEqual:@"glass"] && self.glassEffect != nil;')
  expect(mac).toContain('self.effect.hidden = glass;')
  expect(mac).toContain('self.glassEffect.hidden = !glass;')
  expect(mac).toContain('text, host.glassEffect ? @"true" : @"false"')
  expect(mac).toMatch(
    /\[host mountContentView:effect\];[\s\S]*?\[host mountContentView:host\.glassEffect\];[\s\S]*?\[host mountContentView:view\];/,
  )
  expect(mac).not.toMatch(/\bNSGlassEffectView\s*\*/)
  expect(mac).toContain('platformBridge.capabilities.windowGlass')
  expect(mac).not.toContain('__platformWindowGlass')
  expect(mac).not.toMatch(/self\.(?:effect|glassEffect)\.hidden = .*opacity/)
  expect(mac).not.toMatch(/@property[^;]*\b(?:new|init|copy)\w*\s*;/)
  expect(mac).toContain('dispatch_async(dispatch_get_main_queue(), ^{ [host command:command]; });')
})
