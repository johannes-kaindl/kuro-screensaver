// Kuro Screensaver — Windows .scr host.
//
// A .scr is a normal Windows executable that the OS invokes with one of:
//   /s            run the screensaver fullscreen
//   /c  /c:<hwnd> show the configuration dialog
//   /p  <hwnd>    render a small preview into the given parent window
//
// The actual visuals are the project's web build: this host embeds a
// WebView2 (Chromium) and loads the bundled `web/screensaver.html`. Because
// Chromium refuses to load ES modules over file://, the local `web/` folder
// is exposed via a virtual host (https://kuro.local/) instead.
//
// Scene/audio options are stored in HKCU\Software\KuroScreensaver and passed
// to the page as URL query params.

using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace KuroScreensaver;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string arg = args.Length > 0 ? args[0].Trim() : "/s";
        string flag = arg.Length >= 2 ? arg.Substring(0, 2).ToLowerInvariant() : "/s";

        switch (flag)
        {
            case "/c":
                Application.Run(new ConfigForm());
                break;

            case "/p":
                IntPtr parent = ParsePreviewHandle(arg, args);
                if (parent != IntPtr.Zero)
                    Application.Run(new PreviewForm(parent));
                break;

            case "/s":
            default:
                RunFullscreen();
                break;
        }
    }

    // Handle may arrive as "/p:12345" or "/p 12345".
    private static IntPtr ParsePreviewHandle(string arg, string[] args)
    {
        int colon = arg.IndexOf(':');
        if (colon >= 0 && long.TryParse(arg[(colon + 1)..], out long h1))
            return new IntPtr(h1);
        if (args.Length > 1 && long.TryParse(args[1], out long h2))
            return new IntPtr(h2);
        return IntPtr.Zero;
    }

    private static void RunFullscreen()
    {
        var forms = new List<SaverForm>();
        foreach (var screen in Screen.AllScreens)
            forms.Add(new SaverForm(screen.Bounds));
        if (forms.Count == 0) return;

        foreach (var f in forms) f.Show();
        Application.Run(); // exits when SaverForm detects input (Application.Exit)
    }
}

/// <summary>Persisted options (HKCU) + the query string handed to the web page.
///
/// A screensaver exits on any input, so the web build's live control bar / hotkeys
/// are unreachable. Instead the user's persistent choices live here and are passed
/// to screensaver.html as query params; the web side maps them in src/screensaver/
/// params.ts (applyParamOverrides). Boolean defaults mirror the engine defaults in
/// src/engine/data/defaults.ts so an unset registry reproduces the web defaults.</summary>
internal static class Options
{
    private const string RegPath = @"Software\KuroScreensaver";

    // Opening scene + colour preset + flight speed.
    public static string Scene  { get => Read("Scene", "random");      set => Write("Scene", value); }
    public static string Preset { get => Read("Preset", "toxic-haze"); set => Write("Preset", value); }
    public static string Speed  { get => Read("Speed", "norm");        set => Write("Speed", value); }

    // Audio + FX/HUD toggles (defaults = engine defaults in defaults.ts).
    public static bool Audio     { get => Flag("Audio", false);    set => SetFlag("Audio", value); }
    public static bool Bloom     { get => Flag("Bloom", true);     set => SetFlag("Bloom", value); }
    public static bool Trails    { get => Flag("Trails", false);   set => SetFlag("Trails", value); }
    public static bool Scan      { get => Flag("Scan", true);      set => SetFlag("Scan", value); }
    public static bool Crt       { get => Flag("Crt", true);       set => SetFlag("Crt", value); }
    public static bool Matrix    { get => Flag("Matrix", false);   set => SetFlag("Matrix", value); }
    public static bool Terminal  { get => Flag("Terminal", true);  set => SetFlag("Terminal", value); }
    public static bool Radar     { get => Flag("Radar", true);     set => SetFlag("Radar", value); }
    public static bool Crosshair { get => Flag("Crosshair", true); set => SetFlag("Crosshair", value); }

    public static string QueryString()
    {
        static string On(bool b) => b ? "on" : "off";
        return $"?scene={Uri.EscapeDataString(Scene)}" +
               $"&preset={Uri.EscapeDataString(Preset)}" +
               $"&speed={Uri.EscapeDataString(Speed)}" +
               $"&audio={On(Audio)}" +
               $"&bloom={On(Bloom)}" +
               $"&trails={On(Trails)}" +
               $"&scan={On(Scan)}" +
               $"&crt={On(Crt)}" +
               $"&matrix={On(Matrix)}" +
               $"&terminal={On(Terminal)}" +
               $"&radar={On(Radar)}" +
               $"&crosshair={On(Crosshair)}";
    }

    private static bool Flag(string name, bool def) => Read(name, def ? "on" : "off") == "on";
    private static void SetFlag(string name, bool value) => Write(name, value ? "on" : "off");

    private static string Read(string name, string def)
    {
        using RegistryKey? k = Registry.CurrentUser.OpenSubKey(RegPath);
        return k?.GetValue(name) as string ?? def;
    }

    private static void Write(string name, string value)
    {
        using RegistryKey k = Registry.CurrentUser.CreateSubKey(RegPath);
        k.SetValue(name, value);
    }
}

/// <summary>Fullscreen screensaver window hosting the WebView2.</summary>
internal sealed class SaverForm : Form
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT p);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private static bool _exiting;

    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private readonly System.Windows.Forms.Timer _watch = new() { Interval = 120 };
    private readonly DateTime _start = DateTime.UtcNow;
    private POINT _origin;
    private bool _haveOrigin;

    public SaverForm(Rectangle bounds)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Black;

        Controls.Add(_web);
        Load += async (_, _) => await InitWebViewAsync();

        _watch.Tick += WatchTick;
        _watch.Start();
        Cursor.Hide();
    }

    private async Task InitWebViewAsync()
    {
        string userData = Path.Combine(Path.GetTempPath(), "KuroScreensaverWV2");
        CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData);
        await _web.EnsureCoreWebView2Async(env);

        string webDir = Path.Combine(AppContext.BaseDirectory, "web");
        CoreWebView2 core = _web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("kuro.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;

        // Web → native: the engine's close button (×) posts a message → exit.
        core.WebMessageReceived += (_, _) => ExitSaver();

        _web.Source = new Uri($"https://kuro.local/screensaver.html{Options.QueryString()}");
    }

    // The WebView grabs keyboard/mouse focus, so poll global input instead of
    // relying on WinForms events. A short grace period prevents the keypress
    // that launched the saver from closing it immediately.
    private void WatchTick(object? sender, EventArgs e)
    {
        if ((DateTime.UtcNow - _start).TotalMilliseconds < 1000) return;

        if (GetCursorPos(out POINT p))
        {
            if (!_haveOrigin) { _origin = p; _haveOrigin = true; }
            else if (Math.Abs(p.X - _origin.X) > 10 || Math.Abs(p.Y - _origin.Y) > 10)
            {
                ExitSaver();
                return;
            }
        }

        for (int vk = 0x08; vk <= 0xFE; vk++)
        {
            if ((GetAsyncKeyState(vk) & 0x8000) != 0)
            {
                ExitSaver();
                return;
            }
        }
    }

    private static void ExitSaver()
    {
        if (_exiting) return;
        _exiting = true;
        Application.Exit();
    }
}

/// <summary>Renders the saver into the small preview window of the settings UI.</summary>
internal sealed class PreviewForm : Form
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr parent);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT r);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLongPtr(IntPtr hWnd, int index, long value);

    private const int GWL_STYLE = -16;
    private const long WS_CHILD = 0x40000000L;
    private const long WS_VISIBLE = 0x10000000L;

    private readonly IntPtr _parent;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };

    public PreviewForm(IntPtr parent)
    {
        _parent = parent;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.Black;
        ShowInTaskbar = false;

        GetClientRect(parent, out RECT rc);
        Size = new Size(Math.Max(rc.Right - rc.Left, 1), Math.Max(rc.Bottom - rc.Top, 1));
        Location = Point.Empty;

        Controls.Add(_web);
        Load += async (_, _) =>
        {
            SetWindowLongPtr(Handle, GWL_STYLE, WS_CHILD | WS_VISIBLE);
            SetParent(Handle, _parent);
            await InitWebViewAsync();
        };
    }

    private async Task InitWebViewAsync()
    {
        string userData = Path.Combine(Path.GetTempPath(), "KuroScreensaverWV2");
        CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData);
        await _web.EnsureCoreWebView2Async(env);

        string webDir = Path.Combine(AppContext.BaseDirectory, "web");
        CoreWebView2 core = _web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("kuro.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;

        _web.Source = new Uri($"https://kuro.local/screensaver.html{Options.QueryString()}");
    }
}

/// <summary>Configuration dialog: scene / colour preset / speed plus audio and the
/// FX & HUD toggles, persisted to the registry and bridged to the web build via the
/// query string. Mirrors the persistent (non-live) settings of the web control bar —
/// the live bar/hotkeys themselves can't exist in a screensaver (any input exits).</summary>
internal sealed class ConfigForm : Form
{
    private static readonly string[] Scenes  = { "random", "terrain", "city", "rift", "tunnel", "void", "wreckage", "matrix" };
    private static readonly string[] Presets = { "kuro", "neural-bleed", "rust-signal", "toxic-haze", "biolink", "ghost-protocol", "voidwitch", "circuit", "crimson", "phosphor", "ember", "spectre", "pearl" };
    private static readonly string[] Speeds  = { "slow", "norm", "fast" };

    public ConfigForm()
    {
        Text = "Kuro Screensaver";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(340, 320);
        StartPosition = FormStartPosition.CenterScreen;

        ComboBox sceneCombo  = MakeCombo(Scenes,  Options.Scene,  96, 16);
        ComboBox presetCombo = MakeCombo(Presets, Options.Preset, 96, 48);
        ComboBox speedCombo  = MakeCombo(Speeds,  Options.Speed,  96, 80);

        Label sceneLabel  = MakeLabel("Scene:", 16, 20);
        Label presetLabel = MakeLabel("Color:", 16, 52);
        Label speedLabel  = MakeLabel("Speed:", 16, 84);

        // FX / HUD toggles, two columns. Defaults follow the engine (defaults.ts).
        CheckBox audio     = MakeCheck("Audio",          Options.Audio,     20, 124);
        CheckBox bloom     = MakeCheck("Bloom",          Options.Bloom,     20, 150);
        CheckBox scan      = MakeCheck("Scanlines",      Options.Scan,      20, 176);
        CheckBox crt       = MakeCheck("CRT simulation", Options.Crt,       20, 202);
        CheckBox crosshair = MakeCheck("Crosshair",      Options.Crosshair, 20, 228);

        CheckBox matrix   = MakeCheck("Matrix rain",    Options.Matrix,   180, 124);
        CheckBox trails   = MakeCheck("Afterburn",      Options.Trails,   180, 150);
        CheckBox terminal = MakeCheck("Story terminal", Options.Terminal, 180, 176);
        CheckBox radar    = MakeCheck("Radar",          Options.Radar,    180, 202);

        var ok     = new Button { Text = "OK",     Left = 110, Top = 272, Width = 100, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Left = 220, Top = 272, Width = 100, DialogResult = DialogResult.Cancel };

        ok.Click += (_, _) =>
        {
            Options.Scene     = (string)sceneCombo.SelectedItem!;
            Options.Preset    = (string)presetCombo.SelectedItem!;
            Options.Speed     = (string)speedCombo.SelectedItem!;
            Options.Audio     = audio.Checked;
            Options.Bloom     = bloom.Checked;
            Options.Scan      = scan.Checked;
            Options.Crt       = crt.Checked;
            Options.Crosshair = crosshair.Checked;
            Options.Matrix    = matrix.Checked;
            Options.Trails    = trails.Checked;
            Options.Terminal  = terminal.Checked;
            Options.Radar     = radar.Checked;
            Close();
        };
        cancel.Click += (_, _) => Close();

        Controls.AddRange(new Control[]
        {
            sceneLabel, sceneCombo, presetLabel, presetCombo, speedLabel, speedCombo,
            audio, bloom, scan, crt, crosshair, matrix, trails, terminal, radar,
            ok, cancel,
        });
        AcceptButton = ok;
        CancelButton = cancel;
    }

    private static Label MakeLabel(string text, int left, int top)
        => new() { Text = text, Left = left, Top = top, Width = 72 };

    private static ComboBox MakeCombo(string[] items, string current, int left, int top)
    {
        var combo = new ComboBox { Left = left, Top = top, Width = 220, DropDownStyle = ComboBoxStyle.DropDownList };
        combo.Items.AddRange(items);
        combo.SelectedItem = current;
        if (combo.SelectedIndex < 0) combo.SelectedIndex = 0;
        return combo;
    }

    private static CheckBox MakeCheck(string text, bool isChecked, int left, int top)
        => new() { Text = text, Left = left, Top = top, Width = 150, Checked = isChecked };
}
