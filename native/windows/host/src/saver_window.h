#pragma once

// Fullscreen screensaver mode (/s): one borderless topmost window per monitor,
// each hosting its own WebView2. Returns when input is detected (message loop
// ends). Ports SaverForm from the retired C# host 1:1.
int RunSaver();
