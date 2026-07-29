function createDesktopHost() {
  if (process.platform !== 'win32') {
    return {
      attach: () => { throw new Error('Desktop wallpaper mode is only available on Windows.'); },
      detach: () => { throw new Error('Desktop wallpaper mode is only available on Windows.'); },
      status: () => ({ attached: false, visible: false, parent: 0 })
    };
  }

  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  const HWND = koffi.alias('HWND', HANDLE);
  const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');

  const FindWindow = user32.func('HWND __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)');
  const FindWindowEx = user32.func('HWND __stdcall FindWindowExW(HWND parent, HWND childAfter, const char16_t *className, const char16_t *windowName)');
  const EnumWindows = user32.func('int __stdcall EnumWindows(EnumWindowsProc *callback, intptr_t lParam)');
  const SetParent = user32.func('HWND __stdcall SetParent(HWND child, HWND newParent)');
  const GetParent = user32.func('HWND __stdcall GetParent(HWND hwnd)');
  const IsWindow = user32.func('int __stdcall IsWindow(HWND hwnd)');
  const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(HWND hwnd)');
  const ShowWindow = user32.func('int __stdcall ShowWindow(HWND hwnd, int command)');
  const GetWindowLong = user32.func('int32_t __stdcall GetWindowLongW(HWND hwnd, int index)');
  const SetWindowLong = user32.func('int32_t __stdcall SetWindowLongW(HWND hwnd, int index, int32_t value)');
  const SetWindowPos = user32.func('int __stdcall SetWindowPos(HWND hwnd, HWND insertAfter, int x, int y, int width, int height, uint32_t flags)');
  const GetClassName = user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ uint8_t *className, int maxCount)');
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()');

  const GWL_STYLE = -16;
  const GWL_EXSTYLE = -20;
  const WS_CHILD = 0x40000000;
  const WS_POPUP = -0x80000000;
  const WS_EX_TOOLWINDOW = 0x00000080;
  const WS_EX_APPWINDOW = 0x00040000;
  const SW_SHOWNOACTIVATE = 4;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_FRAMECHANGED = 0x0020;
  const SWP_SHOWWINDOW = 0x0040;
  const HWND_BOTTOM = 1n;

  const pointerValue = (value) => value == null ? 0n : BigInt(value);

  function className(hwnd) {
    if (!pointerValue(hwnd)) return '';
    const buffer = Buffer.alloc(512);
    const length = GetClassName(hwnd, buffer, 256);
    return length > 0 ? buffer.toString('utf16le', 0, length * 2) : '';
  }

  function findWallpaperHost() {
    const progman = FindWindow('Progman', null);
    if (!progman) throw new Error('Windows Explorer desktop host was not found.');

    let worker = null;
    EnumWindows((top) => {
      const desktopView = FindWindowEx(top, null, 'SHELLDLL_DefView', null);
      if (desktopView) {
        const candidate = FindWindowEx(null, top, 'WorkerW', null);
        if (candidate && IsWindowVisible(candidate)) worker = candidate;
      }
      return 1;
    }, 0);

    return worker || progman;
  }

  function status(hwnd) {
    if (!IsWindow(hwnd)) return { attached: false, visible: false, parent: 0, parentClass: '' };
    const parent = GetParent(hwnd);
    const parentClass = className(parent);
    return {
      attached: parentClass === 'WorkerW' || parentClass === 'Progman',
      visible: Boolean(IsWindowVisible(hwnd)),
      parent: Number(pointerValue(parent)),
      parentClass
    };
  }

  function restoreNativeState(hwnd, state) {
    SetParent(hwnd, state.originalParent || null);
    SetWindowLong(hwnd, GWL_STYLE, state.originalStyle);
    SetWindowLong(hwnd, GWL_EXSTYLE, state.originalExStyle);
    SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  }

  function attach(hwnd, bounds) {
    if (!IsWindow(hwnd)) throw new Error('The Electron window handle is no longer valid.');
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('A valid target display size is required.');

    const host = findWallpaperHost();
    const nativeState = {
      originalParent: GetParent(hwnd),
      originalStyle: GetWindowLong(hwnd, GWL_STYLE),
      originalExStyle: GetWindowLong(hwnd, GWL_EXSTYLE)
    };

    SetWindowLong(hwnd, GWL_STYLE, (nativeState.originalStyle | WS_CHILD) & ~WS_POPUP);
    SetWindowLong(hwnd, GWL_EXSTYLE, (nativeState.originalExStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
    SetParent(hwnd, host);
    const attachedParent = GetParent(hwnd);
    if (pointerValue(attachedParent) !== pointerValue(host)) {
      const error = GetLastError();
      restoreNativeState(hwnd, nativeState);
      throw new Error(`Unable to attach the Electron window to the desktop host. Win32 error: ${error}`);
    }

    const positioned = SetWindowPos(
      hwnd,
      HWND_BOTTOM,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW
    );
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    const currentStatus = status(hwnd);
    if (!positioned || !currentStatus.attached || !currentStatus.visible) {
      const error = GetLastError();
      restoreNativeState(hwnd, nativeState);
      throw new Error(`Windows did not keep the wallpaper window visible. Win32 error: ${error}`);
    }

    return {
      ok: true,
      host: Number(pointerValue(host)),
      hostClass: className(host),
      originalParent: Number(pointerValue(nativeState.originalParent)),
      originalStyle: nativeState.originalStyle,
      originalExStyle: nativeState.originalExStyle,
      visible: true
    };
  }

  function detach(hwnd, state) {
    restoreNativeState(hwnd, {
      originalParent: state.originalParent ? BigInt(state.originalParent) : null,
      originalStyle: state.originalStyle,
      originalExStyle: state.originalExStyle
    });
    return { ok: true, ...status(hwnd) };
  }

  return { attach, detach, status };
}

module.exports = { createDesktopHost };
