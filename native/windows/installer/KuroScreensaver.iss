; Inno Setup script for the Kuro Screensaver Windows .scr.
;
; Builds a single-file, no-admin installer that copies the multi-file screensaver
; (KuroScreensaver.scr + WebView2 DLLs + web/ assets) into a stable per-user
; location and registers it. Solves the manual-install footgun: the .scr loads its
; DLLs and web/ folder from its own directory, so it must live somewhere it won't
; be moved — which is exactly what this installer guarantees.
;
; Compile with Inno Setup 6.3+ (the x64compatible architecture identifier needs
; 6.3 or newer; Windows, or wine + ISCC). The .scr must be published
; first — see scripts/package-windows-installer.sh, which runs the dotnet publish
; and then invokes ISCC. Version + source/output dirs can be overridden on the
; ISCC command line, e.g.:
;   ISCC /DMyAppVersion=0.6.0 /O"dist-native" native/windows/installer/KuroScreensaver.iss
;
; NOTE: this installer is unsigned (the project has no Windows code-signing cert),
; so SmartScreen still warns on first run — that needs a paid certificate, which a
; bundled installer cannot work around.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

; Folder holding the published .scr + DLLs + web/ (the dotnet publish output).
#ifndef SourceDir
  #define SourceDir "..\bin\Release\net8.0-windows\win-x64\publish"
#endif

#define MyAppName "Kuro Screensaver"
#define MyAppPublisher "Johannes Kaindl"
#define MyAppURL "https://codeberg.org/jkaindl/kuro-screensaver"
#define ScrName "KuroScreensaver.scr"

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
UninstallDisplayIcon={app}\{#ScrName}
OutputBaseFilename=KuroScreensaver-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "setactive"; Description: "Set Kuro as my active screen saver now"; GroupDescription: "Screen saver:"

[Files]
; The whole published folder (.scr, WebView2 DLLs, runtimes\, web\) — kept together.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Registry]
; Register the .scr as the active screen saver (per-user). The conditional cleanup
; on uninstall is handled in [Code] so we never clobber a different saver the user
; may have chosen afterwards.
Root: HKCU; Subkey: "Control Panel\Desktop"; ValueType: string; ValueName: "SCRNSAVE.EXE"; ValueData: "{app}\{#ScrName}"; Tasks: setactive

[Run]
; Offer to open the Screen Saver settings so the user can set the idle wait time.
Filename: "{sys}\rundll32.exe"; Parameters: "desk.cpl,,@screensaver"; Description: "Open Screen Saver settings (set the idle time)"; Flags: postinstall skipifsilent nowait

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
    if MsgBox('The Microsoft Edge WebView2 Runtime was not detected. Kuro needs it'
      + ' to render (the screen will stay black without it). It ships with current'
      + ' Windows 11, so it may simply be undetected here.' + #13#10 + #13#10
      + 'Continue installing anyway? (You can install WebView2 from Microsoft if'
      + ' the screen stays black.)', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  active: String;
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
  end;
end;
