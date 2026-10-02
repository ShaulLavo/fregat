#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/prctl.h>
#include <unistd.h>

static GtkWidget *window;
static WebKitWebView *view;
static GtkFileChooserNative *chooser;
static gboolean standalone;

static void emit(const char *json) {
  fputs(json, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static void on_message(WebKitUserContentManager *manager, WebKitJavascriptResult *result, gpointer data) {
  JSCValue *value = webkit_javascript_result_get_js_value(result);
  char *body = jsc_value_to_json(value, 0);
  GString *line = g_string_new("{\"event\":\"message\",\"body\":");
  g_string_append(line, body ? body : "null");
  g_string_append_c(line, '}');
  emit(line->str);
  g_string_free(line, TRUE);
  g_free(body);
}

static void on_picked(GtkNativeDialog *dialog, gint response, gpointer data) {
  GString *line = g_string_new("{\"event\":\"picked\",\"paths\":[");
  JSCContext *context = jsc_context_new();
  if (response == GTK_RESPONSE_ACCEPT) {
    GSList *paths = gtk_file_chooser_get_filenames(GTK_FILE_CHOOSER(dialog));
    for (GSList *item = paths; item; item = item->next) {
      JSCValue *value = jsc_value_new_string(context, item->data);
      char *quoted = jsc_value_to_json(value, 0);
      if (item != paths) g_string_append_c(line, ',');
      g_string_append(line, quoted);
      g_object_unref(value);
      g_free(quoted);
    }
    g_slist_free_full(paths, g_free);
  }
  g_string_append(line, "]}");
  emit(line->str);
  g_string_free(line, TRUE);
  g_object_unref(context);
  g_clear_object(&chooser);
  if (standalone) gtk_main_quit();
}

static void pick(JSCValue *options) {
  if (chooser) return;
  JSCValue *mode_value = jsc_value_object_get_property(options, "mode");
  char *mode = jsc_value_to_string(mode_value);
  gboolean folder = g_strcmp0(mode, "folder") == 0;
  g_free(mode);
  g_object_unref(mode_value);
  chooser = gtk_file_chooser_native_new(folder ? "Choose folder" : "Choose file", window ? GTK_WINDOW(window) : NULL,
      folder ? GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER : GTK_FILE_CHOOSER_ACTION_OPEN, NULL, NULL);
  JSCValue *multiple = jsc_value_object_get_property(options, "multiple");
  gtk_file_chooser_set_select_multiple(GTK_FILE_CHOOSER(chooser), jsc_value_to_boolean(multiple));
  g_object_unref(multiple);
  JSCValue *starting = jsc_value_object_get_property(options, "startingPath");
  if (jsc_value_is_string(starting)) {
    char *path = jsc_value_to_string(starting);
    gtk_file_chooser_set_filename(GTK_FILE_CHOOSER(chooser), path);
    g_free(path);
  }
  g_object_unref(starting);
  JSCValue *accept = jsc_value_object_get_property(options, "accept");
  if (!folder && jsc_value_is_array(accept)) {
    GtkFileFilter *filter = gtk_file_filter_new();
    gtk_file_filter_set_name(filter, "Selected file types");
    JSCValue *length = jsc_value_object_get_property(accept, "length");
    gint count = jsc_value_to_int32(length);
    g_object_unref(length);
    for (gint i = 0; i < count; i++) {
      JSCValue *item = jsc_value_object_get_property_at_index(accept, i);
      char *type = jsc_value_to_string(item);
      if (type[0] == '.') {
        char *pattern = g_strconcat("*", type, NULL);
        gtk_file_filter_add_pattern(filter, pattern);
        g_free(pattern);
      } else gtk_file_filter_add_mime_type(filter, type);
      g_free(type);
      g_object_unref(item);
    }
    gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(chooser), filter);
  }
  g_object_unref(accept);
  g_signal_connect(chooser, "response", G_CALLBACK(on_picked), NULL);
  gtk_native_dialog_show(GTK_NATIVE_DIALOG(chooser));
}

static gboolean on_stdin(GIOChannel *channel, GIOCondition condition, gpointer data) {
  if (condition & (G_IO_HUP | G_IO_ERR)) { gtk_widget_destroy(window); return FALSE; }
  char *text = NULL;
  GIOStatus status = g_io_channel_read_line(channel, &text, NULL, NULL, NULL);
  if (status == G_IO_STATUS_EOF) { gtk_widget_destroy(window); return FALSE; }
  if (status != G_IO_STATUS_NORMAL || !text) return TRUE;
  JSCContext *context = jsc_context_new();
  JSCValue *command = jsc_value_new_from_json(context, text);
  g_free(text);
  if (!command || !jsc_value_is_object(command)) goto done;
  if (jsc_value_object_has_property(command, "eval")) {
    JSCValue *value = jsc_value_object_get_property(command, "eval");
    if (view && jsc_value_is_string(value)) {
      char *script = jsc_value_to_string(value);
      webkit_web_view_evaluate_javascript(view, script, -1, NULL, NULL, NULL, NULL, NULL);
      g_free(script);
    }
    g_object_unref(value);
  } else if (jsc_value_object_has_property(command, "pick")) {
    JSCValue *value = jsc_value_object_get_property(command, "pick");
    if (jsc_value_is_object(value)) pick(value);
    g_object_unref(value);
  } else if (jsc_value_object_has_property(command, "close")) gtk_widget_destroy(window);
done:
  g_clear_object(&command);
  g_object_unref(context);
  return TRUE;
}

// NVIDIA on native Wayland requires a realized paint GL context before the first frame.
static void realize_gl_context(void) {
  gtk_widget_realize(window);
  GError *error = NULL;
  GdkGLContext *context = gdk_window_create_gl_context(gtk_widget_get_window(window), &error);
  if (!context || !gdk_gl_context_realize(context, &error)) {
    fprintf(stderr, "Native window GL context unavailable\n");
    g_clear_error(&error);
    g_clear_object(&context);
    return;
  }
  g_object_set_data_full(G_OBJECT(window), "platform-gl", context, g_object_unref);
}

static void on_destroy(GtkWidget *widget, gpointer data) {
  if (chooser) { gtk_native_dialog_hide(GTK_NATIVE_DIALOG(chooser)); g_clear_object(&chooser); }
  emit("{\"event\":\"closed\"}");
  gtk_main_quit();
}

static void on_web_process_terminated(WebKitWebView *webview, WebKitWebProcessTerminationReason reason, gpointer data) {
  fprintf(stderr, "Native web process stopped (%d)\n", reason);
  gtk_widget_destroy(window);
  exit(1);
}

int main(int argc, char **argv) {
  // A killed launcher cannot run its cleanup handlers; the kernel owns this final release.
  pid_t parent = getppid();
  if (parent <= 1) return 1;
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 || getppid() != parent) return 1;
  if (argc < 3) { fprintf(stderr, "usage: platform-webview <url> <init-script-file> | pick <options-json> | message <text-file>\n"); return 2; }
  g_setenv("GTK_USE_PORTAL", "1", TRUE);
  if (!gtk_init_check(&argc, &argv)) { fprintf(stderr, "Native display unavailable\n"); return 1; }
  if (strcmp(argv[1], "pick") == 0) {
    JSCContext *context = jsc_context_new();
    JSCValue *options = jsc_value_new_from_json(context, argv[2]);
    if (!options || !jsc_value_is_object(options)) return 2;
    standalone = TRUE;
    pick(options);
    gtk_main();
    g_object_unref(options);
    g_object_unref(context);
    return 0;
  }
  char *text = NULL;
  if (!g_file_get_contents(argv[2], &text, NULL, NULL)) { fprintf(stderr, "Native input unavailable\n"); return 2; }
  if (strcmp(argv[1], "message") == 0) {
    GtkWidget *dialog = gtk_message_dialog_new(NULL, GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE, "%s", text);
    gtk_window_set_title(GTK_WINDOW(dialog), "Platform could not open");
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
    emit("{\"event\":\"closed\"}");
    g_free(text);
    return 0;
  }
  window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Platform");
  gtk_window_set_default_size(GTK_WINDOW(window), 1440, 960);
  g_signal_connect(window, "destroy", G_CALLBACK(on_destroy), NULL);
  realize_gl_context();
  WebKitUserContentManager *manager = webkit_user_content_manager_new();
  WebKitUserScript *script = webkit_user_script_new(text, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
  webkit_user_content_manager_add_script(manager, script);
  webkit_user_script_unref(script);
  g_signal_connect(manager, "script-message-received::platformShell", G_CALLBACK(on_message), NULL);
  webkit_user_content_manager_register_script_message_handler(manager, "platformShell");
  view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(manager));
  WebKitSettings *settings = webkit_web_view_get_settings(view);
  webkit_settings_set_enable_developer_extras(settings, TRUE);
  webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
  g_signal_connect(view, "web-process-terminated", G_CALLBACK(on_web_process_terminated), NULL);
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
  g_object_unref(manager);
  GIOChannel *input = g_io_channel_unix_new(0);
  g_io_channel_set_flags(input, G_IO_FLAG_NONBLOCK, NULL);
  guint watch = g_io_add_watch(input, G_IO_IN | G_IO_HUP | G_IO_ERR, on_stdin, NULL);
  webkit_web_view_load_uri(view, argv[1]);
  gtk_widget_show_all(window);
  emit("{\"event\":\"ready\"}");
  gtk_main();
  if (g_main_context_find_source_by_id(NULL, watch)) g_source_remove(watch);
  g_io_channel_unref(input);
  g_free(text);
  return 0;
}
