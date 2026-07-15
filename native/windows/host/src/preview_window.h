#pragma once
#include <windows.h>

// Preview mode (/p <hwnd>): renders the saver into the small preview area of
// the Windows Screen Saver settings dialog as a WS_CHILD of `parent`.
int RunPreview(HWND parent);
