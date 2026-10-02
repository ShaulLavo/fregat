#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include <stdlib.h>

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
    if (argc < 3) { fprintf(stderr, "usage: platform-webview <url> <init-script-file> [--vibrancy] | pick <options-json> | message <text-file>\n"); return 2; }
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
    NSURL *url = [NSURL URLWithString:mode];
    if (!url || !([url.scheme isEqual:@"http"] || [url.scheme isEqual:@"https"])) return 2;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1440, 960)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
        backing:NSBackingStoreBuffered defer:NO];
    host.window = window;
    window.delegate = host;
    window.title = @"Platform";
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    window.releasedWhenClosed = NO;
    BOOL vibrant = argc > 3 && strcmp(argv[3], "--vibrancy") == 0;
    if (vibrant) {
      window.opaque = NO;
      window.backgroundColor = NSColor.clearColor;
      NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
      effect.material = NSVisualEffectMaterialUnderWindowBackground;
      effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      effect.state = NSVisualEffectStateActive;
      effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [window.contentView addSubview:effect];
    }
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    // Native fallback browsing data is scoped to this window lifecycle.
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    [configuration.userContentController addUserScript:[[WKUserScript alloc] initWithSource:text injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [configuration.userContentController addScriptMessageHandler:host name:@"platformShell"];
    WKWebView *view = [[WKWebView alloc] initWithFrame:window.contentView.bounds configuration:configuration];
    host.view = view;
    view.navigationDelegate = host;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if (@available(macOS 13.3, *)) view.inspectable = YES;
    if (vibrant) [view setValue:@NO forKey:@"drawsBackground"];
    [window.contentView addSubview:view];
    __weak PlatformHost *weakHost = host;
    host.mouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^NSEvent *(NSEvent *event) {
      if (event.window == weakHost.window) weakHost.mouseDown = event;
      return event;
    }];
    read_commands(host);
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
