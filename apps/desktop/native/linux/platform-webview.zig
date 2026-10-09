const c = @import("native");

const Host = struct {
    window: ?*c.GtkWidget = null,
    view: ?*c.WebKitWebView = null,
    chooser: ?*c.GtkFileChooserNative = null,
    standalone: bool = false,
    closed: bool = false,

    fn finish(self: *Host) void {
        if (self.closed) return;
        if (self.window) |window| {
            c.gtk_widget_destroy(window);
            return;
        }
        self.closed = true;
        self.releaseChooser();
        emit("{\"event\":\"closed\"}");
        if (c.gtk_main_level() != 0) c.gtk_main_quit();
    }

    fn releaseChooser(self: *Host) void {
        const chooser = self.chooser orelse return;
        _ = c.g_signal_handlers_disconnect_matched(chooser, c.G_SIGNAL_MATCH_DATA, 0, 0, null, null, self);
        c.gtk_native_dialog_hide(@ptrCast(@alignCast(chooser)));
        c.g_object_unref(chooser);
        self.chooser = null;
    }

    fn pick(self: *Host, options: *c.JSCValue) void {
        if (self.chooser != null) return;
        const mode = c.jsc_value_object_get_property(options, "mode");
        defer c.g_object_unref(mode);
        const name = c.jsc_value_to_string(mode);
        defer c.g_free(name);
        const folder = c.g_strcmp0(name, "folder") == 0;
        const chooser = c.gtk_file_chooser_native_new(
            if (folder) "Choose folder" else "Choose file",
            @ptrCast(self.window),
            if (folder) c.GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER else c.GTK_FILE_CHOOSER_ACTION_OPEN,
            null,
            null,
        );
        self.chooser = chooser;
        const multiple = c.jsc_value_object_get_property(options, "multiple");
        defer c.g_object_unref(multiple);
        c.gtk_file_chooser_set_select_multiple(@ptrCast(@alignCast(chooser)), c.jsc_value_to_boolean(multiple));
        setStartingPath(chooser.?, options);
        if (!folder) setFilter(chooser.?, options);
        connect(chooser, "response", &onPicked, self);
        c.gtk_native_dialog_show(@ptrCast(@alignCast(chooser)));
    }

    fn command(self: *Host, value: *c.JSCValue) void {
        if (c.jsc_value_object_has_property(value, "eval") != 0) {
            const script = c.jsc_value_object_get_property(value, "eval");
            defer c.g_object_unref(script);
            if (self.view == null or c.jsc_value_is_string(script) == 0) return;
            const source = c.jsc_value_to_string(script);
            defer c.g_free(source);
            c.webkit_web_view_evaluate_javascript(self.view, source, -1, null, null, null, null, null);
            return;
        }
        if (c.jsc_value_object_has_property(value, "pick") != 0) {
            const options = c.jsc_value_object_get_property(value, "pick");
            defer c.g_object_unref(options);
            if (c.jsc_value_is_object(options) != 0) self.pick(options.?);
            return;
        }
        if (c.jsc_value_object_has_property(value, "cancelPick") != 0) {
            self.releaseChooser();
            emit("{\"event\":\"pickCancelled\"}");
            if (self.standalone) c.gtk_main_quit();
            return;
        }
        if (c.jsc_value_object_has_property(value, "close") != 0) self.finish();
    }
};

fn emit(json: [*c]const u8) void {
    _ = c.fputs(json, c.stdout);
    _ = c.fputc('\n', c.stdout);
    _ = c.fflush(c.stdout);
}

fn diagnostic(message: [*:0]const u8) void {
    _ = c.fputs(message, c.stderr);
    _ = c.fputc('\n', c.stderr);
}

fn connect(instance: anytype, signal: [*:0]const u8, callback: anytype, host: *Host) void {
    _ = c.g_signal_connect_data(instance, signal, @ptrCast(callback), host, null, 0);
}

fn fromData(data: ?*anyopaque) *Host {
    return @ptrCast(@alignCast(data.?));
}

fn onMessage(_: ?*c.WebKitUserContentManager, result: ?*c.WebKitJavascriptResult, _: ?*anyopaque) callconv(.c) void {
    const value = c.webkit_javascript_result_get_js_value(result);
    const body = c.jsc_value_to_json(value, 0);
    defer c.g_free(body);
    const line = c.g_string_new("{\"event\":\"message\",\"body\":");
    defer _ = c.g_string_free(line, 1);
    _ = c.g_string_append(line, if (body != null) body else "null");
    _ = c.g_string_append_c(line, '}');
    emit(line.*.str);
}

fn appendPaths(line: *c.GString, dialog: *c.GtkNativeDialog, context: *c.JSCContext) void {
    const paths = c.gtk_file_chooser_get_filenames(@ptrCast(dialog));
    defer c.g_slist_free_full(paths, &c.g_free);
    var current = paths;
    while (current != null) : (current = current.*.next) {
        const value = c.jsc_value_new_string(context, @ptrCast(current.*.data));
        defer c.g_object_unref(value);
        const quoted = c.jsc_value_to_json(value, 0);
        defer c.g_free(quoted);
        if (current != paths) _ = c.g_string_append_c(line, ',');
        _ = c.g_string_append(line, quoted);
    }
}

fn onPicked(dialog: ?*c.GtkNativeDialog, response: c_int, data: ?*anyopaque) callconv(.c) void {
    const host = fromData(data);
    const line = c.g_string_new("{\"event\":\"picked\",\"paths\":[");
    defer _ = c.g_string_free(line, 1);
    const context = c.jsc_context_new();
    defer c.g_object_unref(context);
    if (response == c.GTK_RESPONSE_ACCEPT) appendPaths(line.?, dialog.?, context.?);
    _ = c.g_string_append(line, "]}");
    emit(line.*.str);
    host.releaseChooser();
    if (host.standalone) c.gtk_main_quit();
}

fn setStartingPath(chooser: *c.GtkFileChooserNative, options: *c.JSCValue) void {
    const starting = c.jsc_value_object_get_property(options, "startingPath");
    defer c.g_object_unref(starting);
    if (c.jsc_value_is_string(starting) == 0) return;
    const filename = c.jsc_value_to_string(starting);
    defer c.g_free(filename);
    _ = c.gtk_file_chooser_set_filename(@ptrCast(@alignCast(chooser)), filename);
}

fn setFilter(chooser: *c.GtkFileChooserNative, options: *c.JSCValue) void {
    const accept = c.jsc_value_object_get_property(options, "accept");
    defer c.g_object_unref(accept);
    if (c.jsc_value_is_array(accept) == 0) return;
    const filter = c.gtk_file_filter_new();
    c.gtk_file_filter_set_name(filter, "Selected file types");
    const length = c.jsc_value_object_get_property(accept, "length");
    defer c.g_object_unref(length);
    const count = c.jsc_value_to_int32(length);
    var index: c_uint = 0;
    while (index < count) : (index += 1) {
        const item = c.jsc_value_object_get_property_at_index(accept, index);
        defer c.g_object_unref(item);
        const kind = c.jsc_value_to_string(item);
        defer c.g_free(kind);
        addFilterType(filter.?, kind);
    }
    c.gtk_file_chooser_add_filter(@ptrCast(@alignCast(chooser)), filter);
}

fn addFilterType(filter: *c.GtkFileFilter, kind: [*c]const u8) void {
    if (kind[0] == '.') {
        const pattern = c.g_strconcat(@as([*c]const u8, "*"), kind, @as([*c]const u8, null));
        defer c.g_free(pattern);
        c.gtk_file_filter_add_pattern(filter, pattern);
        return;
    }
    c.gtk_file_filter_add_mime_type(filter, kind);
}

fn onStdin(channel: ?*c.GIOChannel, condition: c.GIOCondition, data: ?*anyopaque) callconv(.c) c.gboolean {
    const host = fromData(data);
    if (condition & (c.G_IO_HUP | c.G_IO_ERR) != 0) {
        host.finish();
        return 0;
    }
    var text: [*c]u8 = null;
    const status = c.g_io_channel_read_line(channel, &text, null, null, null);
    defer c.g_free(text);
    if (status == c.G_IO_STATUS_EOF) {
        host.finish();
        return 0;
    }
    if (status != c.G_IO_STATUS_NORMAL or text == null) return 1;
    const context = c.jsc_context_new();
    defer c.g_object_unref(context);
    const value = c.jsc_value_new_from_json(context, text);
    if (value == null) return 1;
    defer c.g_object_unref(value);
    if (c.jsc_value_is_object(value) != 0) host.command(value.?);
    return 1;
}

// NVIDIA on native Wayland requires a realized paint GL context before the first frame.
fn realizeGlContext(window: *c.GtkWidget) void {
    c.gtk_widget_realize(window);
    var failure: ?*c.GError = null;
    const context = c.gdk_window_create_gl_context(c.gtk_widget_get_window(window), &failure);
    if (context == null or c.gdk_gl_context_realize(context, &failure) == 0) {
        diagnostic("Native window GL context unavailable");
        c.g_clear_error(&failure);
        if (context != null) c.g_object_unref(context);
        return;
    }
    c.g_object_set_data_full(@ptrCast(window), "platform-gl", context, &c.g_object_unref);
}

fn onDestroy(_: ?*c.GtkWidget, data: ?*anyopaque) callconv(.c) void {
    const host = fromData(data);
    if (host.closed) return;
    host.closed = true;
    host.releaseChooser();
    emit("{\"event\":\"closed\"}");
    if (c.gtk_main_level() != 0) c.gtk_main_quit();
}

fn onWebProcessTerminated(_: ?*c.WebKitWebView, reason: c.WebKitWebProcessTerminationReason, data: ?*anyopaque) callconv(.c) void {
    _ = c.fprintf(c.stderr, "Native web process stopped (%u)\n", reason);
    fromData(data).finish();
    c.exit(1);
}

fn windowOptions(argc: c_int, argv: [*c][*c]u8) ?[*c]const u8 {
    var directory: ?[*c]const u8 = null;
    var vibrant = false;
    var index: usize = 3;
    while (index < argc) : (index += 1) {
        if (c.g_strcmp0(argv[index], "--data-dir") == 0 and directory == null and index + 1 < argc) {
            index += 1;
            directory = argv[index];
            continue;
        }
        if (c.g_strcmp0(argv[index], "--vibrancy") == 0 and !vibrant) {
            vibrant = true;
            continue;
        }
        return null;
    }
    const absolute = directory orelse return null;
    if (c.g_path_is_absolute(absolute) == 0) return null;
    return absolute;
}

fn createWebContext(directory: [*c]const u8) ?*c.WebKitWebContext {
    const cache = c.g_build_filename(directory, @as([*c]const u8, "cache"), @as([*c]const u8, null));
    defer c.g_free(cache);
    if (c.g_mkdir_with_parents(directory, 0o700) != 0 or c.g_mkdir_with_parents(cache, 0o700) != 0) return null;
    const manager = c.webkit_website_data_manager_new(@as([*c]const u8, "base-data-directory"), directory, @as([*c]const u8, "base-cache-directory"), cache, @as([*c]const u8, null));
    defer c.g_object_unref(manager);
    const cookies = c.g_build_filename(directory, @as([*c]const u8, "cookies.sqlite"), @as([*c]const u8, null));
    defer c.g_free(cookies);
    c.webkit_cookie_manager_set_persistent_storage(c.webkit_website_data_manager_get_cookie_manager(manager), cookies, c.WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);
    return c.webkit_web_context_new_with_website_data_manager(manager);
}

fn openWindow(host: *Host, uri: [*c]const u8, text: [*c]const u8, directory: [*c]const u8) bool {
    const context = createWebContext(directory) orelse {
        diagnostic("Native browser storage directories unavailable");
        return false;
    };
    defer c.g_object_unref(context);
    const window = c.gtk_window_new(c.GTK_WINDOW_TOPLEVEL);
    host.window = window;
    c.gtk_window_set_title(@ptrCast(window), "Fregat");
    c.gtk_window_set_default_size(@ptrCast(window), 1440, 960);
    connect(window, "destroy", &onDestroy, host);
    realizeGlContext(window.?);
    const manager = c.webkit_user_content_manager_new();
    defer c.g_object_unref(manager);
    const script = c.webkit_user_script_new(text, c.WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, c.WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, null, null);
    defer c.webkit_user_script_unref(script);
    c.webkit_user_content_manager_add_script(manager, script);
    connect(manager, "script-message-received::platformShell", &onMessage, host);
    _ = c.webkit_user_content_manager_register_script_message_handler(manager, "platformShell");
    const view: *c.WebKitWebView = @ptrCast(@alignCast(c.g_object_new(c.webkit_web_view_get_type(), @as([*c]const u8, "web-context"), context, @as([*c]const u8, "user-content-manager"), manager, @as([*c]const u8, null))));
    host.view = view;
    const settings = c.webkit_web_view_get_settings(view);
    c.webkit_settings_set_enable_developer_extras(settings, 1);
    c.webkit_settings_set_hardware_acceleration_policy(settings, c.WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
    connect(view, "web-process-terminated", &onWebProcessTerminated, host);
    c.gtk_container_add(@ptrCast(window), @ptrCast(view));
    c.webkit_web_view_load_uri(view, uri);
    c.gtk_widget_show_all(window);
    emit("{\"event\":\"ready\"}");
    return true;
}

pub export fn main(argument_count: c_int, argument_values: [*c][*c]u8) c_int {
    // The kernel releases the host even when the launcher cannot run cleanup handlers.
    const parent = c.getppid();
    if (parent <= 1) return 1;
    if (c.prctl(c.PR_SET_PDEATHSIG, @as(c_ulong, c.SIGTERM), @as(c_ulong, 0), @as(c_ulong, 0), @as(c_ulong, 0)) != 0 or c.getppid() != parent) return 1;
    if (argument_count < 3) {
        diagnostic("usage: platform-webview <url> <init-script-file> --data-dir <absolute-path> [--vibrancy] | pick <options-json> | message <text-file>");
        return 2;
    }
    const picker = c.g_strcmp0(argument_values[1], "pick") == 0;
    const message = c.g_strcmp0(argument_values[1], "message") == 0;
    const directory = if (picker or message) null else windowOptions(argument_count, argument_values) orelse {
        diagnostic("Native window options invalid");
        return 2;
    };
    _ = c.g_setenv("GTK_USE_PORTAL", "1", 1);
    var argc = argument_count;
    var argv = argument_values;
    if (c.gtk_init_check(&argc, &argv) == 0) {
        diagnostic("Native display unavailable");
        return 1;
    }
    var host: Host = .{};
    if (picker) return runPicker(&host, argv[2]);
    var text: [*c]u8 = null;
    if (c.g_file_get_contents(argv[2], &text, null, null) == 0) {
        diagnostic("Native input unavailable");
        return 2;
    }
    defer c.g_free(text);
    if (message) {
        const dialog = c.gtk_message_dialog_new(null, c.GTK_DIALOG_MODAL, c.GTK_MESSAGE_ERROR, c.GTK_BUTTONS_CLOSE, @as([*c]const u8, "%s"), text);
        host.window = dialog;
        connect(dialog, "destroy", &onDestroy, &host);
        c.gtk_window_set_title(@ptrCast(dialog), "Fregat could not open");
        const input = Input.init(&host);
        defer input.deinit();
        _ = c.gtk_dialog_run(@ptrCast(dialog));
        host.finish();
        return 0;
    }
    if (!openWindow(&host, argv[1], text, directory.?)) return 1;
    run(&host);
    return 0;
}

fn runPicker(host: *Host, json: [*c]const u8) c_int {
    const context = c.jsc_context_new();
    defer c.g_object_unref(context);
    const options = c.jsc_value_new_from_json(context, json);
    if (options == null) return 2;
    defer c.g_object_unref(options);
    if (c.jsc_value_is_object(options) == 0) return 2;
    host.standalone = true;
    host.pick(options.?);
    run(host);
    return 0;
}

const Input = struct {
    channel: *c.GIOChannel,
    watch: c_uint,

    fn init(host: *Host) Input {
        const channel = c.g_io_channel_unix_new(0);
        _ = c.g_io_channel_set_flags(channel, c.G_IO_FLAG_NONBLOCK, null);
        return .{ .channel = channel.?, .watch = c.g_io_add_watch(channel, c.G_IO_IN | c.G_IO_HUP | c.G_IO_ERR, &onStdin, host) };
    }

    fn deinit(self: Input) void {
        if (c.g_main_context_find_source_by_id(null, self.watch) != null) _ = c.g_source_remove(self.watch);
        c.g_io_channel_unref(self.channel);
    }
};

fn run(host: *Host) void {
    const input = Input.init(host);
    defer input.deinit();
    c.gtk_main();
}
