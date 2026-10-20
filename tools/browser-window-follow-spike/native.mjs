import { createRequire } from 'node:module';
import { assertBinding, nwmBounds } from './core.mjs';
const require = createRequire(import.meta.url);

export function openNative() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('windows_x64_required');
  const koffi = require('koffi');
  const user = koffi.load('user32.dll');
  const kernel = koffi.load('kernel32.dll');
  koffi.struct('SpikeRect', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  koffi.struct('SpikePoint', { x: 'int32_t', y: 'int32_t' });
  const rectFn = user.func('int __stdcall GetWindowRect(uintptr_t h, _Out_ SpikeRect *r)');
  const clientFn = user.func('int __stdcall GetClientRect(uintptr_t h, _Out_ SpikeRect *r)');
  const toScreen = user.func('int __stdcall ClientToScreen(uintptr_t h, _Inout_ SpikePoint *p)');
  const position = user.func('int __stdcall SetWindowPos(uintptr_t h, uintptr_t after, int x, int y, int w, int hgt, uint32_t flags)');
  const foreground = user.func('uintptr_t __stdcall GetForegroundWindow()');
  const previous = user.func('uintptr_t __stdcall GetWindow(uintptr_t h, uint32_t command)');
  const minimized = user.func('int __stdcall IsIconic(uintptr_t h)');
  const maximized = user.func('int __stdcall IsZoomed(uintptr_t h)');
  const dpiFn = user.func('uint32_t __stdcall GetDpiForWindow(uintptr_t h)');
  const setDpi = user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)');
  const getError = kernel.func('uint32_t __stdcall GetLastError()');
  // Native calls stay synchronous on the main JS thread. No worker FFI calls.
  const oldDpi = setDpi(-4); // PER_MONITOR_AWARE_V2
  if (!oldDpi) throw Error(`dpi_awareness_failed_${getError()}`);
  let library;
  try { library = require('node-window-manager'); } catch (e) { setDpi(oldDpi); throw e; }
  const { windowManager, Window } = library;
  const check = (ok, name) => { if (!ok) throw Error(`${name}_${getError()}`); };
  const rect = id => {
    const r = {}; check(rectFn(id, r), 'get_rect_failed');
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  };
  const describe = w => ({ id: w.id, processId: w.processId, path: w.path, visible: w.isVisible() });
  const boundWindow = bound => {
    const w = new Window(bound.id);
    assertBinding(w.isWindow() ? describe(w) : null, bound);
    return w;
  };
  return {
    list: (withTitles = false) => windowManager.getWindows().filter(w => w.isVisible())
      .map(w => ({ ...describe(w), ...(withTitles ? { title: w.getTitle() } : {}), bounds: rect(w.id) })),
    bind: (id, processId, path) => {
      const bound = { id, processId, path }; boundWindow(bound); return bound;
    },
    check: boundWindow,
    rect: bound => { boundWindow(bound); return rect(bound.id); },
    state: bound => {
      const w = boundWindow(bound);
      return { visible: w.isVisible(), minimized: !!minimized(bound.id), maximized: !!maximized(bound.id),
        dpi: dpiFn(bound.id), foreground: Number(foreground()) };
    },
    client: bound => {
      boundWindow(bound); const r = {}, p = { x: 0, y: 0 };
      check(clientFn(bound.id, r), 'get_client_failed'); check(toScreen(bound.id, p), 'client_to_screen_failed');
      return { x: p.x, y: p.y, width: r.right - r.left, height: r.bottom - r.top };
    },
    previous: bound => { boundWindow(bound); return Number(previous(bound.id, 3)); },
    move: (bound, target, backend) => {
      const w = boundWindow(bound);
      if (backend === 'nwm') w.setBounds(nwmBounds(target, w.getMonitor().getScaleFactor()));
      else check(position(bound.id, 0, target.x, target.y, target.width, target.height,
        0x0004 | 0x0010 | 0x0200), 'set_position_failed'); // no z-order, activate or owner change
    },
    stack: (browser, host, active) => {
      boundWindow(browser); boundWindow(host);
      // Visible: immediately above the host. Inactive/minimized host: behind it.
      let after = active ? Number(previous(host.id, 3)) : host.id;
      if (after === browser.id) return;
      check(position(browser.id, after, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0200), 'stack_failed');
    },
    restoreStack: (bound, after) => {
      boundWindow(bound);
      if (after && !new Window(after).isWindow()) return false;
      check(position(bound.id, after, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0200), 'restore_stack_failed');
      return Number(previous(bound.id, 3)) === after;
    },
    close: () => setDpi(oldDpi)
  };
}
