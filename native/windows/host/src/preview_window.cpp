#include "preview_window.h"

#include <windows.h>

#include <objidl.h>
#include <gdiplus.h>

#include "resource.h"

// The Windows control panel hosts the mini-preview in a small child window
// whose top-level owner belongs to *another* process (the control panel).
// WebView2 (Chromium/DirectComposition) does not render into such a
// cross-process child window — the preview stayed black no matter how long it
// was given to load. So `/p` deliberately does NOT spin up a WebView here; it
// paints a bundled still frame of the screensaver (embedded as RCDATA) with
// GDI+. Reliable, no GPU compositor involved. The live engine still runs at
// full size for `/s` and in the `/c` settings dialog.

namespace {

ULONG_PTR g_gdiplusToken = 0;
Gdiplus::Image* g_image = nullptr;
IStream* g_imageStream = nullptr;  // must outlive g_image (GDI+ decodes lazily)

// Load the preview PNG from the embedded RT_RCDATA resource into a GDI+ Image.
Gdiplus::Image* LoadPreviewImage() {
    HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(IDR_PREVIEW_IMAGE), RT_RCDATA);
    if (!res) return nullptr;
    HGLOBAL handle = LoadResource(nullptr, res);
    DWORD size = SizeofResource(nullptr, res);
    void* src = handle ? LockResource(handle) : nullptr;
    if (!src || size == 0) return nullptr;

    // GDI+ needs an IStream that stays alive for the Image's lifetime, so copy
    // the resource bytes into an HGLOBAL the stream owns (fDeleteOnRelease).
    HGLOBAL buffer = GlobalAlloc(GMEM_MOVEABLE, size);
    if (!buffer) return nullptr;
    void* dst = GlobalLock(buffer);
    memcpy(dst, src, size);
    GlobalUnlock(buffer);

    if (CreateStreamOnHGlobal(buffer, TRUE, &g_imageStream) != S_OK) {
        GlobalFree(buffer);
        return nullptr;
    }
    Gdiplus::Image* img = Gdiplus::Image::FromStream(g_imageStream);
    if (img && img->GetLastStatus() != Gdiplus::Ok) {
        delete img;
        img = nullptr;
    }
    return img;
}

void PaintPreview(HWND hwnd) {
    PAINTSTRUCT ps;
    HDC hdc = BeginPaint(hwnd, &ps);
    RECT rc;
    GetClientRect(hwnd, &rc);
    const int w = rc.right - rc.left;
    const int h = rc.bottom - rc.top;

    // Double-buffer to avoid flicker on resize.
    HDC mem = CreateCompatibleDC(hdc);
    HBITMAP bmp = CreateCompatibleBitmap(hdc, w, h);
    HBITMAP old = static_cast<HBITMAP>(SelectObject(mem, bmp));

    {
        Gdiplus::Graphics gfx(mem);
        gfx.Clear(Gdiplus::Color(255, 0, 0, 0));  // black letterbox base
        if (g_image) {
            gfx.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
            gfx.DrawImage(g_image, 0, 0, w, h);  // fill the pane (matches fullscreen)
        }
    }

    BitBlt(hdc, 0, 0, w, h, mem, 0, 0, SRCCOPY);
    SelectObject(mem, old);
    DeleteObject(bmp);
    DeleteDC(mem);
    EndPaint(hwnd, &ps);
}

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_PAINT:
            PaintPreview(hwnd);
            return 0;
        case WM_ERASEBKGND:
            return 1;  // handled in WM_PAINT; skip default erase to avoid flicker
        case WM_SIZE:
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int RunPreview(HWND parent) {
    Gdiplus::GdiplusStartupInput startup;
    Gdiplus::GdiplusStartup(&g_gdiplusToken, &startup, nullptr);
    g_image = LoadPreviewImage();

    RECT rc{};
    GetClientRect(parent, &rc);

    WNDCLASSW wc{};
    wc.lpfnWndProc = PreviewWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroPreviewWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, L"KuroPreviewWindow", L"", WS_CHILD | WS_VISIBLE, 0, 0,
                                max(rc.right - rc.left, 1L), max(rc.bottom - rc.top, 1L),
                                parent, nullptr, wc.hInstance, nullptr);
    if (hwnd) {
        MSG msg;
        while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    delete g_image;
    g_image = nullptr;
    if (g_imageStream) {
        g_imageStream->Release();
        g_imageStream = nullptr;
    }
    Gdiplus::GdiplusShutdown(g_gdiplusToken);
    return 0;
}
