// The wallpaper's helper: a small windowed program (no console), so running it can never open a terminal window.
// Praxis starts it with an action and reads one line back:
//   ping | status | set <file> <position> | slideshow <folder> <options> <tick> <position> | attach <hwnd> <w> <h> | watch [parent pid]
//   front | minimize <hwnd> | frontwatch [parent pid]   (4.7: the focus lock asks which window is in front)
//   raise <hwnd>   (5.0.1: brings the block gate back in front when something else took the screen)
using System;
using System.Runtime.InteropServices;
namespace PraxisWall {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("b63ea76d-1f85-456f-a19c-48159efa858b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemArray {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
    void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
    void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
    void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
    void GetCount(out uint pdwNumItems);
    void GetItemAt(uint dwIndex, out IShellItem ppsi);
    void EnumItems(out IntPtr ppenumShellItems);
  }
  [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDesktopWallpaper {
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
    RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    void SetBackgroundColor(uint color);
    uint GetBackgroundColor();
    void SetPosition(int position);
    int GetPosition();
    void SetSlideshow(IShellItemArray items);
    IShellItemArray GetSlideshow();
    void SetSlideshowOptions(int options, uint slideshowTick);
    void GetSlideshowOptions(out int options, out uint slideshowTick);
    void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, int direction);
    int GetStatus();
    void Enable([MarshalAs(UnmanagedType.Bool)] bool enable);
  }
  [ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")] public class DesktopWallpaperClass {}
  public static class W {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);
    [DllImport("shell32.dll", PreserveSig = false)]
    static extern void SHCreateShellItemArrayFromShellItem(IShellItem psi, ref Guid riid, out IShellItemArray ppv);
    static IDesktopWallpaper D() { return (IDesktopWallpaper)new DesktopWallpaperClass(); }
    public static string[] Status() {
      var d = D();
      string status = "0", wall = "", folder = "", opts = "0", tick = "0", pos = "4";
      try { status = d.GetStatus().ToString(); } catch {}
      try { wall = d.GetWallpaper(null) ?? ""; } catch {}
      try { var a = d.GetSlideshow(); uint n; a.GetCount(out n); if (n > 0) { IShellItem it; a.GetItemAt(0, out it); string s; it.GetDisplayName(0x80058000, out s); folder = s ?? ""; } } catch {}
      try { int o; uint t; d.GetSlideshowOptions(out o, out t); opts = o.ToString(); tick = t.ToString(); } catch {}
      try { pos = d.GetPosition().ToString(); } catch {}
      return new string[] { status, wall, folder, opts, tick, pos };
    }
    public static void Set(string path, int position) { var d = D(); d.SetPosition(position); d.SetWallpaper(null, path); }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int n);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);

    /** Puts a window behind the desktop icons, over the wallpaper, covering the main screen. */
    public static string Attach(long hwnd, int w, int h) {
      // Real pixels on every screen (per-monitor DPI aware), so positions aren't scaled behind our back.
      try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero) SetProcessDPIAware(); } catch { SetProcessDPIAware(); }
      IntPtr me = new IntPtr(hwnd), r;
      IntPtr progman = FindWindow("Progman", null);
      if (progman == IntPtr.Zero) return "no-desktop";
      SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
      SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
      IntPtr target = IntPtr.Zero; string how = "";
      // Before Windows 11 24H2: a WorkerW next to the one that holds the icons.
      EnumWindows(delegate (IntPtr top, IntPtr l) {
        if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { IntPtr ww = FindWindowEx(IntPtr.Zero, top, "WorkerW", null); if (ww != IntPtr.Zero) target = ww; }
        return true;
      }, IntPtr.Zero);
      if (target != IntPtr.Zero) how = "workerw";
      // Windows 11 24H2 and later: the WorkerW lives inside Progman, under the icons.
      if (target == IntPtr.Zero) { target = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null); if (target != IntPtr.Zero) how = "progman-workerw"; }
      if (target == IntPtr.Zero) { target = progman; how = "progman"; }
      SetParent(me, target);
      // Cover the main screen exactly: take its rectangle on the desktop and convert it into the parent's own coordinates
      // (the parent isn't always at the desktop's corner, so offsetting by the virtual screen alone can land it off to one side).
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      POINT o = new POINT(); o.X = 0; o.Y = 0;
      int x, y;
      if (GetMonitorInfo(MonitorFromPoint(o, 1), ref mi)) {
        POINT p = new POINT(); p.X = mi.rcMonitor.Left; p.Y = mi.rcMonitor.Top;
        ScreenToClient(target, ref p);
        x = p.X; y = p.Y; w = mi.rcMonitor.Right - mi.rcMonitor.Left; h = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
      } else { x = -GetSystemMetrics(76); y = -GetSystemMetrics(77); }
      SetWindowPos(me, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010 | 0x0040);
      // Measure where it actually landed on screen and nudge it until it matches the main screen
      // (the parent's coordinates can be offset or DPI-scaled in ways a single conversion gets wrong).
      int tl = mi.rcMonitor.Left, tt = mi.rcMonitor.Top, tw = mi.rcMonitor.Right - mi.rcMonitor.Left, th = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
      if (tw > 0 && th > 0) for (int i = 0; i < 4; i++) {
        RECT got; if (!GetWindowRect(me, out got)) break;
        int gw = got.Right - got.Left, gh = got.Bottom - got.Top;
        if (got.Left == tl && got.Top == tt && gw == tw && gh == th) break;
        if (gw > 0 && gh > 0) { w = (int)Math.Round((double)w * tw / gw); h = (int)Math.Round((double)h * th / gh); }
        x += tl - got.Left; y += tt - got.Top;
        SetWindowPos(me, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010 | 0x0040);
      }
      if (how == "progman") { IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null); if (dv != IntPtr.Zero) SetWindowPos(me, dv, x, y, w, h, 0x0010 | 0x0040); }
      return how + " " + x + "," + y + " " + w + "x" + h;
    }
    /** "full" when the window in front covers its whole screen (a game, a full-screen video), else "normal". */
    public static string Foreground() {
      IntPtr f = GetForegroundWindow();
      if (f == IntPtr.Zero) return "normal";
      var sb = new System.Text.StringBuilder(256); GetClassName(f, sb, 256);
      string c = sb.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return "normal";
      RECT wr; if (!GetWindowRect(f, out wr)) return "normal";
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(f, 2), ref mi)) return "normal";
      return (wr.Left <= mi.rcMonitor.Left && wr.Top <= mi.rcMonitor.Top && wr.Right >= mi.rcMonitor.Right && wr.Bottom >= mi.rcMonitor.Bottom) ? "full" : "normal";
    }
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder sb, int n);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p, uint flags, System.Text.StringBuilder sb, ref uint n);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    /** The window in front as one line: hwnd, process id, program path, title (tab-separated; tabs in the title become spaces). */
    public static string Front() {
      IntPtr f = GetForegroundWindow();
      if (f == IntPtr.Zero) return "0\t0\t\t";
      uint pid; GetWindowThreadProcessId(f, out pid);
      string exe = "";
      IntPtr p = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION: works for most programs, even elevated ones
      if (p != IntPtr.Zero) { var b = new System.Text.StringBuilder(1024); uint n = 1024; if (QueryFullProcessImageName(p, 0, b, ref n)) exe = b.ToString(); CloseHandle(p); }
      var t = new System.Text.StringBuilder(512); GetWindowText(f, t, 512);
      return f.ToInt64() + "\t" + pid + "\t" + exe.Replace('\t', ' ') + "\t" + t.ToString().Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ');
    }
    /** Minimises a window (the focus lock moving a locked app out of the way). */
    public static string Minimize(long hwnd) {
      IntPtr h = new IntPtr(hwnd);
      if (hwnd == 0 || !IsWindow(h)) return "no-window";
      ShowWindow(h, 6);   // SW_MINIMIZE
      return "ok";
    }
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    /** Puts a window back in front and gives it the keyboard, even when Windows would rather not hand the foreground over. */
    public static string Raise(long hwnd) {
      IntPtr h = new IntPtr(hwnd);
      if (hwnd == 0 || !IsWindow(h)) return "no-window";
      if (IsIconic(h)) ShowWindow(h, 9);   // SW_RESTORE
      SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);   // HWND_TOPMOST, no move or size, shown
      IntPtr fg = GetForegroundWindow();
      if (fg == h) return "ok";
      uint other; uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out other), me = GetCurrentThreadId();
      bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
      BringWindowToTop(h);
      bool ok = SetForegroundWindow(h);
      if (!ok && (GetAsyncKeyState(0x12) & 0x8000) == 0) {
        // Windows hands the foreground to whoever sent the last key: a tap of Alt (only when Alt isn't already held).
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        ok = SetForegroundWindow(h);
      }
      if (attached) AttachThreadInput(me, fgThread, false);
      return ok ? "ok" : "denied";
    }
    public static void Slideshow(string folder, int options, uint tick, int position) {
      Guid iidItem = typeof(IShellItem).GUID, iidArr = typeof(IShellItemArray).GUID;
      IShellItem item; SHCreateItemFromParsingName(folder, IntPtr.Zero, ref iidItem, out item);
      IShellItemArray arr; SHCreateShellItemArrayFromShellItem(item, ref iidArr, out arr);
      var d = D(); d.SetPosition(position); d.SetSlideshow(arr); d.SetSlideshowOptions(options, tick);
    }
  }

  public static class Program {
    static string Json(string s) {
      var sb = new System.Text.StringBuilder("\"");
      foreach (char c in s ?? "") {
        if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
        else if (c < ' ') sb.Append("\\u" + ((int)c).ToString("x4"));
        else sb.Append(c);
      }
      return sb.Append('"').ToString();
    }
    static string Num(string s) { long n; return long.TryParse(s, out n) ? n.ToString() : "0"; }
    static bool Alive(int pid) {
      try { return !System.Diagnostics.Process.GetProcessById(pid).HasExited; } catch { return false; }
    }
    [STAThread]
    public static int Main(string[] a) {
      try {
        string act = a.Length > 0 ? a[0] : "";
        if (act == "ping") Console.Out.WriteLine("PraxisWall.W");
        else if (act == "status") {
          string[] s = W.Status();
          Console.Out.WriteLine("{\"status\":" + Num(s[0]) + ",\"wallpaper\":" + Json(s[1]) + ",\"folder\":" + Json(s[2]) + ",\"options\":" + Num(s[3]) + ",\"tick\":" + Num(s[4]) + ",\"position\":" + Num(s[5]) + "}");
        }
        else if (act == "set" && a.Length >= 3) { W.Set(a[1], int.Parse(a[2])); Console.Out.WriteLine("ok"); }
        else if (act == "slideshow" && a.Length >= 5) { W.Slideshow(a[1], int.Parse(a[2]), uint.Parse(a[3]), int.Parse(a[4])); Console.Out.WriteLine("ok"); }
        else if (act == "attach" && a.Length >= 4) Console.Out.WriteLine(W.Attach(long.Parse(a[1]), int.Parse(a[2]), int.Parse(a[3])));
        else if (act == "watch") {
          // Says every two seconds whether a full-screen app is in front; stops when Praxis is gone.
          int parent = 0; if (a.Length >= 2) int.TryParse(a[1], out parent);
          while (parent == 0 || Alive(parent)) { Console.Out.WriteLine(W.Foreground()); Console.Out.Flush(); System.Threading.Thread.Sleep(2000); }
        }
        else if (act == "front") Console.Out.WriteLine(W.Front());
        else if (act == "minimize" && a.Length >= 2) Console.Out.WriteLine(W.Minimize(long.Parse(a[1])));
        else if (act == "raise" && a.Length >= 2) Console.Out.WriteLine(W.Raise(long.Parse(a[1])));
        else if (act == "frontwatch") {
          // The focus lock: says which window is in front whenever it changes (and every few seconds anyway); stops with Praxis.
          int parent = 0; if (a.Length >= 2) int.TryParse(a[1], out parent);
          string last = null; int quiet = 0;
          while (parent == 0 || Alive(parent)) {
            string now = W.Front();
            if (now != last || ++quiet >= 8) { Console.Out.WriteLine(now); Console.Out.Flush(); last = now; quiet = 0; }
            System.Threading.Thread.Sleep(400);
          }
        }
        else { Console.Error.WriteLine("Unknown action: " + act); return 2; }
        Console.Out.Flush();
        return 0;
      } catch (Exception e) {
        try { Console.Error.WriteLine(e.Message); Console.Error.Flush(); } catch {}
        return 1;
      }
    }
  }
}
