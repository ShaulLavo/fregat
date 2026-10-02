import type { PlatformBridge, PlatformPickOptions } from '../shared/bridge'
import { isRecord } from '@workspace/utils/objects'

export function parsePickRequest(
  body: unknown,
  origin: string,
): { id: number; documentId: string; options: PlatformPickOptions } | undefined {
  if (
    !isRecord(body) ||
    body.origin !== origin ||
    body.method !== 'pickEntry' ||
    !Number.isSafeInteger(body.id) ||
    typeof body.documentId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(body.documentId) ||
    !isRecord(body.options)
  )
    return
  const options = body.options
  if (options.mode !== 'folder' && options.mode !== 'file') return
  if (options.multiple !== undefined && typeof options.multiple !== 'boolean') return
  if (options.startingPath !== undefined && typeof options.startingPath !== 'string') return
  if (
    options.accept !== undefined &&
    (!Array.isArray(options.accept) ||
      !options.accept.every((item: unknown) => typeof item === 'string'))
  )
    return
  return {
    id: body.id as number,
    documentId: body.documentId,
    options: {
      mode: options.mode,
      multiple: options.multiple,
      startingPath: options.startingPath,
      accept: options.accept,
    },
  }
}
export function shellBridge(
  url: string,
  engine: 'webkitgtk' | 'wkwebview',
  token?: string,
  platform: NodeJS.Platform = process.platform,
  vibrancy = false,
): string {
  const bridge: PlatformBridge = {
    backdrop:
      engine === 'wkwebview' && vibrancy
        ? 'transparent'
        : platform === 'darwin'
          ? 'app'
          : 'compositor',
    platform: platform === 'darwin' ? 'darwin' : 'linux',
    colorScheme: null,
    titlebar: engine === 'wkwebview' ? 'overlay' : 'native',
    capabilities: { displayCapture: false },
  }
  return `(() => {
    if (location.origin !== ${JSON.stringify(new URL(url).origin)} || window !== window.top || globalThis.__platformShellReply) return;
    const bridge = ${JSON.stringify(bridge)};
    const send = body => { webkit.messageHandlers.platformShell.postMessage(body); };
    const token = ${JSON.stringify(token)};
    ${engine === 'wkwebview' && vibrancy ? "bridge.setSurfaceOpacity = opacity => { send({ method: 'setSurfaceOpacity', opacity, origin: location.origin, token }); };" : ''}
    const documentId = crypto.randomUUID();
    const pending = new Map();
    let next = 0;
    globalThis.__platformShellReply = response => {
      if (response.documentId !== documentId) return;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(Object.assign(Object.assign(Object.create(Error.prototype), { message: response.error.message }), response.error));
      else request.resolve(response.paths);
    };
    bridge.pickEntry = options => new Promise((resolve, reject) => {
      if (pending.size) { reject(new DOMException('A file chooser is already open.', 'InvalidStateError')); return; }
      const id = ++next;
      pending.set(id, { resolve, reject });
      try { send({ id, documentId, method: 'pickEntry', options, origin: location.origin, token }); }
      catch (error) { pending.delete(id); reject(error); }
    });
    addEventListener('pagehide', () => { for (const request of pending.values()) request.reject(new DOMException('The window closed.', 'AbortError')); pending.clear(); }, { once: true });
    if (bridge.titlebar === 'overlay') addEventListener('mousedown', event => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest('[data-native-window-drag-region]') || event.target.closest('.electrobun-webkit-app-region-no-drag, [data-native-window-no-drag], button, input, textarea, select, a, [role=button], [contenteditable]')) return;
      send({ method: 'drag', origin: location.origin, token });
    });
    globalThis.__platformShell = bridge;
    globalThis.platformBridge = bridge;
    const measure = () => setTimeout(() => {
      let frames = 0;
      let active = true;
      const frame = () => { if (!active) return; frames++; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      setTimeout(() => {
        active = false;
        send({ rafPerSecond: frames, platformHostRaf: frames, origin: location.origin });
      }, 1000);
    }, 2000);
    if (document.readyState === 'complete') measure();
    else addEventListener('load', measure, { once: true });
  })()`
}
