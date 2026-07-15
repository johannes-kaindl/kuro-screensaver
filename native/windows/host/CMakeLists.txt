cmake_minimum_required(VERSION 3.20)
project(KuroScreensaverHost CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT — pairs with WebView2LoaderStatic.lib for a single-file exe.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE _WIN32_WINNT=0x0A00)

add_library(host_lib STATIC src/options.cpp)
target_include_directories(host_lib PUBLIC src)
target_link_libraries(host_lib PUBLIC advapi32)

add_executable(options_test tests/options_test.cpp)
target_link_libraries(options_test PRIVATE host_lib)
