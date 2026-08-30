cmake_minimum_required(VERSION 3.20)
project(KuroScreensaverLinuxHost CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# NOTE (Task 2, built before Task 1): this file currently wires ONLY the pure
# half of the host — no GTK, no X11, no WebKit — so it configures and builds on
# any machine, including macOS and CI. Task 1/3 ADD the GTK/WebKitGTK targets
# (pkg-config gtk+-3.0, webkit2gtk-4.1, the kuro-screensaver executable); they
# do not replace this file. Keep host_lib as the shared static lib so the test
# and the eventual binary link the same objects.
add_library(host_lib STATIC
  src/options.cpp)
target_include_directories(host_lib PUBLIC src)

enable_testing()
add_executable(options_test tests/options_test.cpp)
target_link_libraries(options_test PRIVATE host_lib)
# The repo root, so the test can read native/shared/query-contract.txt. A compile
# define rather than only a ctest ENVIRONMENT entry, so a bare ./options_test works
# too — otherwise the fixture check would quietly do nothing outside ctest.
target_compile_definitions(options_test PRIVATE
  KURO_REPO_ROOT_DEFAULT="${CMAKE_CURRENT_SOURCE_DIR}/../../..")
add_test(NAME options_test COMMAND options_test)
