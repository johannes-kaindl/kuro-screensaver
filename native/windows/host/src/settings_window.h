#pragma once

// Configuration dialog (/c): a small host window loading settings.html from
// the web bundle. The page posts "save:<query>" or "cancel" back; save is
// validated by ParseSaveMessage and persisted to HKCU. Replaces the WinForms
// ConfigForm of the retired .NET host.
int RunSettings();
