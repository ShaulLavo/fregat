#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <QuartzCore/QuartzCore.h>
#import <CommonCrypto/CommonDigest.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

static WKWebsiteDataStore *persistent_store(NSString *directory) {
  if (@available(macOS 14.0, *)) {
    NSString *canonicalPath = directory.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    NSData *pathData = [canonicalPath dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(pathData.bytes, (CC_LONG)pathData.length, digest);
    uuid_t bytes;
    memcpy(bytes, digest, sizeof(bytes));
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    NSUUID *identifier = [[NSUUID alloc] initWithUUIDBytes:bytes];
    // WebKit owns the on-disk location; the state-home path selects an isolated persistent store.
    return [WKWebsiteDataStore dataStoreForIdentifier:identifier];
  }
  // macOS 11–13 has one public persistent store per application, shared across state homes.
  return WKWebsiteDataStore.defaultDataStore;
}

static NSView *glass_effect(NSRect frame) {
  if (@available(macOS 26.0, *)) {
    Class glassClass = NSClassFromString(@"NSGlassEffectView");
    if (!glassClass) return nil;
    NSView *effect = [[glassClass alloc] initWithFrame:frame];
    // The public regular style is zero; runtime KVC keeps older SDK builds working.
    [effect setValue:@0 forKey:@"style"];
    [effect setValue:@0 forKey:@"cornerRadius"];
    effect.hidden = YES;
    effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    return effect;
  }
  return nil;
}

static void emit(NSDictionary *event) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  if (!data) return;
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

@interface PlatformHost : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property(strong) NSWindow *window;
@property(strong) WKWebView *view;
@property(strong) NSVisualEffectView *effect;
@property(strong) NSView *glassEffect;
@property(strong) NSURL *appURL;
@property(strong) WKUserScript *startupScript;
@property(strong) NSOpenPanel *picker;
@property(strong) NSEvent *mouseDown;
@property(strong) id mouseMonitor;
@property BOOL standalone;
@property BOOL cancelling;
@property BOOL closed;
@property int exitCode;
- (void)command:(NSDictionary *)command;
- (void)pick:(NSDictionary *)options;
- (void)finish;
@end

@implementation PlatformHost
- (NSString *)windowStateSource {
  BOOL fullscreen = (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  NSData *data = [NSJSONSerialization dataWithJSONObject:self.appURL.absoluteString
      options:NSJSONWritingFragmentsAllowed error:nil];
  NSString *appURL = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  NSString *script = [NSString stringWithFormat:
      @"(() => { if (location.origin !== new URL(%@).origin) return; "
      "const apply = () => { document.documentElement.toggleAttribute('data-native-fullscreen', %@); window.dispatchEvent(new Event('platform-native-window-state')); }; "
      "if (document.documentElement) { apply(); return; } "
      "const observer = new MutationObserver(() => { if (!document.documentElement) return; observer.disconnect(); apply(); }); "
      "observer.observe(document, { childList: true }); })()",
      appURL, fullscreen ? @"true" : @"false"];
  return script;
}
- (void)refreshWindowStateScript {
  if (self.closed || !self.view || !self.appURL) return;
  WKUserContentController *controller = self.view.configuration.userContentController;
  [controller removeAllUserScripts];
  [controller addUserScript:[[WKUserScript alloc] initWithSource:[self windowStateSource] injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
  [controller addUserScript:self.startupScript];
}
- (void)publishWindowState {
  if (self.closed || !self.view || !self.appURL) return;
  [self.view evaluateJavaScript:[self windowStateSource] completionHandler:nil];
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  [self refreshWindowStateScript];
  decisionHandler(WKNavigationActionPolicyAllow);
}
- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation {
  [self publishWindowState];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  [self publishWindowState];
}
- (void)windowDidEnterFullScreen:(NSNotification *)notification {
  [self refreshWindowStateScript];
  [self publishWindowState];
}
- (void)windowDidExitFullScreen:(NSNotification *)notification {
  [self refreshWindowStateScript];
  [self publishWindowState];
}
- (void)finish {
  if (self.closed) return;
  self.closed = YES;
  [self.picker cancel:nil];
  if (NSApp.modalWindow) [NSApp abortModal];
  [self.view.configuration.userContentController removeScriptMessageHandlerForName:@"platformShell"];
  if (self.mouseMonitor) [NSEvent removeMonitor:self.mouseMonitor];
  emit(@{@"event": @"closed"});
  [NSApp stop:nil];
  // stop: wakes after the current event; stdin EOF can arrive while AppKit is idle.
  [NSApp postEvent:[NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint
      modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:0 data1:0 data2:0] atStart:NO];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  [self finish];
  return NSTerminateCancel;
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
  [self finish];
  return YES;
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)view {
  fprintf(stderr, "Native web process stopped\n");
  self.exitCode = 1;
  [self finish];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  if (!message.frameInfo.isMainFrame) return;
  emit(@{@"event": @"message", @"body": message.body ?: [NSNull null]});
}
- (void)pick:(NSDictionary *)options {
  if (self.picker) return;
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  self.picker = panel;
  BOOL folder = [options[@"mode"] isEqual:@"folder"];
  panel.canChooseDirectories = folder;
  panel.canChooseFiles = !folder;
  panel.allowsMultipleSelection = [options[@"multiple"] boolValue];
  panel.title = folder ? @"Choose folder" : @"Choose file";
  NSString *starting = options[@"startingPath"];
  if ([starting isKindOfClass:NSString.class] && starting.length) {
    BOOL directory = NO;
    [[NSFileManager defaultManager] fileExistsAtPath:starting isDirectory:&directory];
    panel.directoryURL = [NSURL fileURLWithPath:directory ? starting : starting.stringByDeletingLastPathComponent];
    if (!directory) panel.nameFieldStringValue = starting.lastPathComponent;
  }
  NSMutableArray<UTType *> *types = [NSMutableArray array];
  NSArray *accept = options[@"accept"];
  if (!folder && [accept isKindOfClass:NSArray.class]) {
    for (NSString *item in accept) {
      if (![item isKindOfClass:NSString.class]) continue;
      UTType *type = [item hasPrefix:@"."] ? [UTType typeWithFilenameExtension:[item substringFromIndex:1]] : [UTType typeWithMIMEType:item];
      if (type) [types addObject:type];
    }
  }
  if (types.count) panel.allowedContentTypes = types;
  void (^completed)(NSModalResponse) = ^(NSModalResponse response) {
    NSMutableArray *paths = [NSMutableArray array];
    if (response == NSModalResponseOK) {
      for (NSURL *url in panel.URLs) if (url.isFileURL) [paths addObject:url.path];
    }
    self.picker = nil;
    if (self.closed) return;
    if (self.cancelling) emit(@{@"event": @"pickCancelled"});
    else emit(@{@"event": @"picked", @"paths": paths});
    self.cancelling = NO;
    if (self.standalone) [self finish];
  };
  [NSApp activateIgnoringOtherApps:YES];
  if (self.window) [panel beginSheetModalForWindow:self.window completionHandler:completed];
  else [panel beginWithCompletionHandler:completed];
}
- (void)command:(NSDictionary *)command {
  if (self.closed) return;
  if (command[@"windowAppearance"]) {
    id appearance = command[@"windowAppearance"];
    if (![appearance isKindOfClass:NSDictionary.class]) return;
    id opacity = appearance[@"opacity"];
    id material = appearance[@"material"];
    if (![opacity isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)opacity) == CFBooleanGetTypeID()) return;
    if (![material isKindOfClass:NSString.class] || ![@[@"none", @"frosted", @"glass"] containsObject:material]) return;
    double opacityValue = [opacity doubleValue];
    if (!isfinite(opacityValue) || opacityValue < 0 || opacityValue > 100) return;
    BOOL glass = [material isEqual:@"glass"] && self.glassEffect != nil;
    // Pane opacity is page-owned; native materials always render at full strength.
    self.effect.alphaValue = 1;
    self.effect.hidden = [material isEqual:@"none"] || glass;
    self.glassEffect.hidden = !glass;
    return;
  }
  if ([command[@"eval"] isKindOfClass:NSString.class]) {
    [self.view evaluateJavaScript:command[@"eval"] completionHandler:nil];
    return;
  }
  if ([command[@"pick"] isKindOfClass:NSDictionary.class]) {
    [self pick:command[@"pick"]];
    return;
  }
  if (command[@"cancelPick"]) {
    if (!self.picker) { emit(@{@"event": @"pickCancelled"}); return; }
    self.cancelling = YES;
    [self.picker cancel:nil];
    return;
  }
  if (command[@"drag"] && self.mouseDown) {
    [self.window performWindowDragWithEvent:self.mouseDown];
    self.mouseDown = nil;
    return;
  }
  if (command[@"close"]) [self finish];
}
@end

static void read_commands(PlatformHost *host) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    char *line = NULL;
    size_t capacity = 0;
    ssize_t length;
    while ((length = getline(&line, &capacity, stdin)) != -1) {
      @autoreleasepool {
        NSData *data = [NSData dataWithBytes:line length:(NSUInteger)length];
        id command = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![command isKindOfClass:NSDictionary.class]) continue;
        dispatch_async(dispatch_get_main_queue(), ^{ [host command:command]; });
      }
    }
    free(line);
    // The launcher owns stdin, including in picker and message helper modes.
    dispatch_async(dispatch_get_main_queue(), ^{ [host finish]; });
  });
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 3) { fprintf(stderr, "usage: platform-webview <url> <init-script-file> --data-dir <absolute-path> [--vibrancy] | pick <options-json> | message <text-file>\n"); return 2; }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    PlatformHost *host = [PlatformHost new];
    NSApp.delegate = host;
    NSMenu *menu = [NSMenu new];
    NSMenuItem *appItem = [NSMenuItem new];
    [menu addItem:appItem];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItemWithTitle:@"Quit Platform" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;
    NSMenuItem *editItem = [NSMenuItem new];
    [menu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    NSMenuItem *redo = [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"z"];
    redo.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select all" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    NSApp.mainMenu = menu;
    NSString *mode = [NSString stringWithUTF8String:argv[1]];
    NSString *input = [NSString stringWithUTF8String:argv[2]];
    if ([mode isEqual:@"pick"]) {
      id options = [NSJSONSerialization JSONObjectWithData:[input dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
      if (![options isKindOfClass:NSDictionary.class]) return 2;
      host.standalone = YES;
      [host pick:options];
      read_commands(host);
      [NSApp run];
      return host.exitCode;
    }
    NSString *text = [NSString stringWithContentsOfFile:input encoding:NSUTF8StringEncoding error:nil];
    if (!text) { fprintf(stderr, "Native input unavailable\n"); return 2; }
    if ([mode isEqual:@"message"]) {
      NSAlert *alert = [NSAlert new];
      alert.messageText = @"Platform could not open";
      alert.informativeText = text;
      [alert addButtonWithTitle:@"Close"];
      read_commands(host);
      [NSApp activateIgnoringOtherApps:YES];
      [alert runModal];
      [host finish];
      return host.exitCode;
    }
    NSString *dataDir = nil;
    BOOL vibrant = NO;
    for (int i = 3; i < argc; i++) {
      if (strcmp(argv[i], "--data-dir") == 0 && !dataDir && i + 1 < argc) {
        dataDir = [NSString stringWithUTF8String:argv[++i]];
        continue;
      }
      if (strcmp(argv[i], "--vibrancy") == 0 && !vibrant) {
        vibrant = YES;
        continue;
      }
      fprintf(stderr, "Native window options invalid\n");
      return 2;
    }
    if (!dataDir.isAbsolutePath) { fprintf(stderr, "Native window options invalid\n"); return 2; }
    WKWebsiteDataStore *dataStore = persistent_store(dataDir);
    if (!dataStore) { fprintf(stderr, "Native browser storage unavailable\n"); return 1; }
    NSURL *url = [NSURL URLWithString:mode];
    if (!url || !([url.scheme isEqual:@"http"] || [url.scheme isEqual:@"https"])) return 2;
    host.appURL = url;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1440, 960)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
        backing:NSBackingStoreBuffered defer:NO];
    host.window = window;
    window.delegate = host;
    window.title = @"Platform";
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    window.releasedWhenClosed = NO;
    if (vibrant) {
      window.opaque = NO;
      window.backgroundColor = NSColor.clearColor;
      window.contentView.wantsLayer = YES;
      window.contentView.layer.opaque = NO;
      window.contentView.layer.backgroundColor = NSColor.clearColor.CGColor;
      NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
      effect.material = NSVisualEffectMaterialUnderWindowBackground;
      effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      effect.state = NSVisualEffectStateActive;
      effect.hidden = YES;
      host.effect = effect;
      effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [window.contentView addSubview:effect];
      host.glassEffect = glass_effect(window.contentView.bounds);
      if (host.glassEffect) [window.contentView addSubview:host.glassEffect];
    }
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = dataStore;
    NSString *startupSource = [NSString stringWithFormat:@"%@\n;if (globalThis.platformBridge) globalThis.platformBridge.capabilities.windowGlass = %@;",
        text, host.glassEffect ? @"true" : @"false"];
    host.startupScript = [[WKUserScript alloc] initWithSource:startupSource injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];
    [configuration.userContentController addScriptMessageHandler:host name:@"platformShell"];
    WKWebView *view = [[WKWebView alloc] initWithFrame:window.contentView.bounds configuration:configuration];
    host.view = view;
    view.navigationDelegate = host;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if (@available(macOS 13.3, *)) view.inspectable = YES;
    if (vibrant) {
      // Clearing WebKit's background can leave its root layer's initial opaque hint.
      [view setValue:@NO forKey:@"drawsBackground"];
      if (@available(macOS 12.0, *)) view.underPageBackgroundColor = NSColor.clearColor;
      view.layer.opaque = NO;
      view.layer.backgroundColor = NSColor.clearColor.CGColor;
    }
    [window.contentView addSubview:view];
    __weak PlatformHost *weakHost = host;
    host.mouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^NSEvent *(NSEvent *event) {
      if (event.window == weakHost.window) weakHost.mouseDown = event;
      return event;
    }];
    read_commands(host);
    [host refreshWindowStateScript];
    [view loadRequest:[NSURLRequest requestWithURL:url]];
    [window center];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    emit(@{@"event": @"ready"});
    [NSApp run];
    [window orderOut:nil];
    return host.exitCode;
  }
}
