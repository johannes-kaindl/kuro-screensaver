cmake_minimum_required(VERSION 3.20)
project(KuroScreensaverHost CXX)
enable_language(RC)  # app.rc: preview bitmap + VERSIONINFO

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT — pairs with WebView2LoaderStatic.lib for a single-file exe.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE _WIN32_WINNT=0x0A00)
# The sources are UTF-8 without BOM. Without this MSVC decodes them as the
# system codepage and mangles every non-ASCII literal — the tray menu shipped
# "Einstellungenâ€¦" through v0.10. Guarded by TestSourceEncoding in options_test.
add_compile_options($<$<CXX_COMPILER_ID:MSVC>:/utf-8>)

# --- WebView2 SDK (headers + static loader) via NuGet ------------------------
set(WEBVIEW2_VERSION "1.0.2478.35")
set(WEBVIEW2_DIR "${CMAKE_BINARY_DIR}/webview2")
if(NOT EXISTS "${WEBVIEW2_DIR}/build/native/include/WebView2.h")
  file(DOWNLOAD
    "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}"
    "${CMAKE_BINARY_DIR}/webview2.nupkg"
    STATUS dl_status)
  list(GET dl_status 0 dl_code)
  if(NOT dl_code EQUAL 0)
    message(FATAL_ERROR "WebView2 NuGet download failed: ${dl_status}")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${CMAKE_BINARY_DIR}/webview2.nupkg" DESTINATION "${WEBVIEW2_DIR}")
endif()

add_library(host_lib STATIC
  src/options.cpp
  src/wallpaper_options.cpp
  src/instance.cpp
  src/monitors.cpp
  src/render_policy.cpp
  src/webview_host.cpp
  src/saver_window.cpp
  src/preview_window.cpp
  src/settings_window.cpp
  src/wallpaper_window.cpp
  src/tray.cpp)
target_include_directories(host_lib PUBLIC src "${WEBVIEW2_DIR}/build/native/include")
target_link_libraries(host_lib PUBLIC
  "${WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib"
  user32 gdi32 gdiplus shell32 shlwapi ole32 oleaut32 advapi32 version wtsapi32)

add_executable(KuroScreensaver WIN32 src/main.cpp app.rc)
target_link_libraries(KuroScreensaver PRIVATE host_lib)

# The wallpaper app: same host_lib, same main.cpp — only the no-argument default
# and the identity in VERSIONINFO differ. It exists because the shell will not
# pass an argument through a .scr shortcut (see wallpaper.rc).
add_executable(KuroWallpaper WIN32 src/main.cpp wallpaper.rc)
target_link_libraries(KuroWallpaper PRIVATE host_lib)
target_compile_definitions(KuroWallpaper PRIVATE KURO_WALLPAPER_APP=1)

add_executable(options_test tests/options_test.cpp)
target_link_libraries(options_test PRIVATE host_lib)
