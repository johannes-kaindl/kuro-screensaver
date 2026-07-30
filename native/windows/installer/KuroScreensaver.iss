; Inno Setup script for the Kuro Screensaver Windows .scr + the wallpaper app.
;
; Builds a single-file, no-admin installer that copies the packaged screensaver
; (KuroScreensaver.scr + KuroWallpaper.exe + web/ assets — no bundled .NET, no
; WebView2 DLLs) into a stable per-user location and registers it. Solves the
; manual-install footgun: both programs load the web/ folder from their own
; directory, so they must live somewhere they won't be moved — which is exactly
; what this installer guarantees.
;
; Compile with Inno Setup 6.3+ (the x64compatible architecture identifier needs
; 6.3 or newer; Windows, or wine + ISCC). The .scr must be packaged
; first — see scripts/package-windows-installer.sh, which runs
; scripts/package-windows.sh and then invokes ISCC. Version + source/output dirs
; can be overridden on the ISCC command line, e.g.:
;   ISCC /DMyAppVersion=0.6.0 /O"dist-native" native/windows/installer/KuroScreensaver.iss
;
; NOTE: this installer is unsigned (the project has no Windows code-signing cert),
; so SmartScreen still warns on first run — that needs a paid certificate, which a
; bundled installer cannot work around.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

; Folder holding the packaged .scr + web/ (output of scripts/package-windows.sh).
#ifndef SourceDir
  #define SourceDir "..\..\..\dist-native\windows-scr"
#endif

#define MyAppName "Kuro Screensaver"
#define MyAppPublisher "Johannes Kaindl"
#define MyAppURL "https://git.jkaindl.de/jkaindl/kuro-screensaver"
#define ScrName "KuroScreensaver.scr"
; The wallpaper app. Every wallpaper shortcut and the Run key point here and
; never at the .scr: the shell drops a .scr shortcut's arguments and applies the
; default verb instead, so "/w" never arrived and the shortcut ran the
; screensaver (v0.10.1, confirmed on-device).
#define WallpaperExe "KuroWallpaper.exe"
; The wallpaper's hidden tray window (src/instance.h) and the registered message
; it quits on (see StopRunningWallpaper below). Kept next to each other so the
; two spellings cannot drift from the C++ side unnoticed.
#define TrayWindowClass "KuroTrayWindow"
#define QuitMessageName "KuroWallpaper.Quit"

[Setup]
; Keep this AppId stable across versions so upgrades replace in place.
AppId={{8F3D9E21-5C4A-4B7E-9A1F-2D6C8E0B4A77}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
; Per-user install, no administrator rights required.
PrivilegesRequired=lowest
DefaultDirName={autopf}\Kuro Screensaver
DisableProgramGroupPage=yes
DisableDirPage=auto
UninstallDisplayName={#MyAppName}
; The .exe, not the .scr: this is the icon "Apps & Features" shows, and the
; wallpaper app is the entry the user actually recognises.
UninstallDisplayIcon={app}\{#WallpaperExe}
OutputBaseFilename=KuroScreensaver-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Only ask for the language when the Windows UI language matches neither entry
; in [Languages]. The default is "yes" — every user would get a "Select Setup
; Language" dialog they never saw in v0.10 (one language = never shown).
ShowLanguageDialog=auto

[Languages]
; Inno picks by the Windows UI language and shows the language dialog only when
; nothing matches (ShowLanguageDialog=auto, set in [Setup] — the DEFAULT is yes,
; which would ask every single user to pick a language before installing, a
; regression against v0.10's one-language setup that never asked). German first
; because it is the project's own language; English is the fallback for everyone
; else.
Name: "german";  MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "setactive"; Description: "{cm:TaskSetActive}"; GroupDescription: "{cm:GroupSaver}"
Name: "startmenu"; Description: "{cm:TaskStartMenu}"; GroupDescription: "{cm:GroupWallpaper}"
Name: "desktopicon"; Description: "{cm:TaskDesktopIcon}"; GroupDescription: "{cm:GroupWallpaper}"; Flags: unchecked
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:GroupWallpaper}"; Flags: unchecked

[CustomMessages]
; Every Description: above and every [Code] MsgBox needs BOTH languages — a
; missing entry still compiles and then shows the bare message name at runtime.
german.GroupSaver=Bildschirmschoner:
german.GroupWallpaper=Animiertes Wallpaper:
german.TaskSetActive=Kuro als aktiven Bildschirmschoner setzen
german.TaskStartMenu=Startmenü-Eintrag anlegen
german.TaskDesktopIcon=Desktop-Verknüpfung anlegen
german.TaskAutostart=Wallpaper mit Windows starten
german.RunWallpaper=Animiertes Wallpaper jetzt starten
german.OpenSaverSettings=Bildschirmschoner-Einstellungen öffnen (Wartezeit einstellen)
german.WebView2Missing=Die Microsoft Edge WebView2 Runtime wurde nicht gefunden. Kuro braucht sie zum Rendern (ohne sie bleibt der Bildschirm schwarz). Sie gehört zu aktuellen Windows-11-Installationen, kann hier also auch nur unerkannt geblieben sein.
german.WebView2Continue=Trotzdem installieren? (WebView2 lässt sich bei Microsoft nachinstallieren, falls der Bildschirm schwarz bleibt.)
english.GroupSaver=Screen saver:
english.GroupWallpaper=Animated wallpaper:
english.TaskSetActive=Set Kuro as my active screen saver now
english.TaskStartMenu=Create a Start menu entry
english.TaskDesktopIcon=Create a desktop shortcut
english.TaskAutostart=Start the wallpaper with Windows
english.RunWallpaper=Start the animated wallpaper now
english.OpenSaverSettings=Open Screen Saver settings (set the idle time)
english.WebView2Missing=The Microsoft Edge WebView2 Runtime was not detected. Kuro needs it to render (the screen will stay black without it). It ships with current Windows 11, so it may simply be undetected here.
english.WebView2Continue=Continue installing anyway? (You can install WebView2 from Microsoft if the screen stays black.)

[Files]
; The whole packaged folder (.scr + KuroWallpaper.exe + web\) — kept together.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; v0.10's start-menu shortcut pointed at "KuroScreensaver.scr" with a /w
; parameter — the arguments the shell throws away, so it started the screensaver.
; It is not in this version's [Icons], and Inno only removes what the current
; install created, so an upgrade would leave the broken shortcut next to the
; working one.
Type: files; Name: "{autoprograms}\Kuro Animated Wallpaper.lnk"

[Icons]
; Both point at the .exe, never the .scr (see the WallpaperExe define).
Name: "{autoprograms}\Kuro Wallpaper"; Filename: "{app}\{#WallpaperExe}"; Comment: "{cm:RunWallpaper}"; Tasks: startmenu
Name: "{autodesktop}\Kuro Wallpaper"; Filename: "{app}\{#WallpaperExe}"; Comment: "{cm:RunWallpaper}"; Tasks: desktopicon

[Registry]
; Register the .scr as the active screen saver (per-user). The conditional cleanup
; on uninstall is handled in [Code] so we never clobber a different saver the user
; may have chosen afterwards.
Root: HKCU; Subkey: "Control Panel\Desktop"; ValueType: string; ValueName: "SCRNSAVE.EXE"; ValueData: "{app}\{#ScrName}"; Tasks: setactive
; /silent = wallpaper without the settings window; the same value the tray's own
; autostart toggle writes (src/tray.cpp), so the two agree and the checkbox in
; the wallpaper tab reflects this key.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "KuroWallpaper"; ValueData: """{app}\{#WallpaperExe}"" /silent"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; Offer to open the Screen Saver settings so the user can set the idle wait time.
; Must go through control.exe — rundll32 treats ",,@screensaver" as a (missing)
; DLL export and errors with "Fehler in desk.cpl: Eintrag fehlt: @screensaver".
Filename: "{sys}\control.exe"; Parameters: "desk.cpl,screensaver,@screensaver"; Description: "{cm:OpenSaverSettings}"; Flags: postinstall skipifsilent nowait
; Unchecked by default: the wallpaper is a long-running process, so starting it
; is the user's call, not a side effect of installing. No parameter — the .exe
; defaults to /w and opens its settings window.
Filename: "{app}\{#WallpaperExe}"; Description: "{cm:RunWallpaper}"; Flags: postinstall skipifsilent nowait unchecked

[Code]
function WebView2Installed(): Boolean;
var
  pv: String;
begin
  // Evergreen WebView2 Runtime registers its version under this client GUID, in
  // the machine (HKLM, 32/64) or per-user (HKCU) EdgeUpdate hive.
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not WebView2Installed() then
  begin
    // Two messages joined here rather than one with %n: the concatenation is
    // the same in both languages and needs no message-formatting escape.
    if MsgBox(ExpandConstant('{cm:WebView2Missing}') + #13#10 + #13#10
      + ExpandConstant('{cm:WebView2Continue}'), mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

procedure StopRunningWallpaper();
var
  tray: HWND;
  waited: Integer;
begin
  // Windows will not delete a running .exe: without this the uninstall either
  // errors out or demands a reboot. Ask the app to quit through the same
  // registered message a second instance uses (src/instance.h) — RegisterWindow-
  // Message returns the same id in every process of the session, so no shared
  // handle is needed. The tray window disappears when it is gone (RemoveTray),
  // which is what we wait for.
  tray := FindWindowByClassName('{#TrayWindowClass}');
  if tray = 0 then exit;
  PostMessage(tray, RegisterWindowMessage('{#QuitMessageName}'), 0, 0);
  waited := 0;
  // Bounded: if the app is wedged, uninstall anyway and let Windows report the
  // file it could not remove — better than hanging the uninstaller forever.
  while (waited < 5000) and (FindWindowByClassName('{#TrayWindowClass}') <> 0) do
  begin
    Sleep(200);
    waited := waited + 200;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningWallpaper();
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // Upgrading over a RUNNING wallpaper is the normal case for the autostart
  // user this feature targets — [Files] then has to overwrite a locked .exe.
  // Without this, Inno falls back to CloseApplications=yes → Restart Manager,
  // which posts WM_CLOSE to top-level windows; the tray window (src/tray.cpp)
  // quits on our registered message, not on WM_CLOSE, and the wallpaper windows
  // are WorkerW children RM never sees. RM would fail to close us and demand a
  // reboot. Called here on purpose: PrepareToInstall runs BEFORE the
  // CloseApplications scan, so by the time RM looks, the app is already gone
  // and no restart is flagged.
  //
  // Does NOT help the v0.10.1 → v0.11 jump: v0.10 has no instance.h and its
  // tray.cpp has no quit handler, so it ignores the message and we burn the
  // full 5 s timeout before installing anyway (that upgrade may still ask for a
  // reboot — accepted, it is a one-time cost on a single version step). AppMutex
  // was considered and rejected for the same reason: v0.10 holds no mutex, so it
  // would not catch that case either, while adding a "please close the app"
  // prompt to the v0.11+ path that this function is meant to make invisible.
  // From v0.11 → v0.12 on, this is a silent, reboot-free upgrade.
  StopRunningWallpaper();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  active: String;
  autostart: String;
begin
  // On uninstall, only clear the active-saver registry value if it still points
  // at our .scr (leave any other screen saver the user later picked untouched).
  if CurUninstallStep = usUninstall then
  begin
    if RegQueryStringValue(HKCU, 'Control Panel\Desktop', 'SCRNSAVE.EXE', active) then
    begin
      if CompareText(active, ExpandConstant('{app}\{#ScrName}')) = 0 then
        RegDeleteValue(HKCU, 'Control Panel\Desktop', 'SCRNSAVE.EXE');
    end;

    // Autostart writes Run\KuroWallpaper — either "<app>\KuroWallpaper.exe"
    // /silent (this version's installer task and tray toggle) or the v0.10 form
    // "<app>\KuroScreensaver.scr" /w, which survives on a machine that never ran
    // the migration. Both names are checked, or an uninstall leaves an autostart
    // entry pointing at a deleted file. Substring match: the value wraps the
    // path in quotes and appends the flag.
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run',
                           'KuroWallpaper', autostart) then
    begin
      if (Pos(Uppercase(ExpandConstant('{app}\{#ScrName}')), Uppercase(autostart)) > 0) or
         (Pos(Uppercase(ExpandConstant('{app}\{#WallpaperExe}')), Uppercase(autostart)) > 0) then
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'KuroWallpaper');
    end;
  end;
end;
