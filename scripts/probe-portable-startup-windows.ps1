param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [switch]$CheckOnly,
  [int]$TimeoutSeconds = 150,
  [int]$CleanupPid = 0,
  [string]$ExpectedPath = '',
  [long]$StartedAt = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$source = @'
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

public static class PortableStartupWindows {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessEntry {
    public uint Size, Usage, Id; public IntPtr Heap; public uint ModuleId, Threads, Parent; public int Priority; public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
  }
  delegate bool WindowCallback(IntPtr window, IntPtr data);
  delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly DateTime Epoch = new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc);
  static long Now() { return (long)(DateTime.UtcNow-Epoch).TotalMilliseconds; }
  static string WindowText(IntPtr window, bool isClass) {
    var buffer = new StringBuilder(512);
    if (isClass) GetClassName(window, buffer, buffer.Capacity); else GetWindowText(window, buffer, buffer.Capacity);
    return buffer.ToString();
  }
  static List<ProcessEntry> Processes() {
    var result = new List<ProcessEntry>();
    var handle = CreateToolhelp32Snapshot(2, 0);
    if (handle == new IntPtr(-1)) return result;
    try {
      var entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
      if (Process32First(handle, ref entry)) do { result.Add(entry); } while (Process32Next(handle, ref entry));
    } finally { CloseHandle(handle); }
    return result;
  }
  static long Identity(uint pid) {
    try { using (var process=Process.GetProcessById((int)pid)) { return process.HasExited ? 0 : process.StartTime.ToUniversalTime().Ticks; } }
    catch (ArgumentException) { return 0; } catch (InvalidOperationException) { return 0; } catch (System.ComponentModel.Win32Exception) { return 0; }
  }
  public static int Cleanup(int pid, string expected, long startedAt) {
    var opened=new List<Process>();
    try {
      Process root;
      try { root=Process.GetProcessById(pid); } catch (ArgumentException) { return 0; }
      opened.Add(root);
      IntPtr rootHandle=root.Handle;
      if (root.HasExited) return 0;
      if (!String.Equals(Path.GetFullPath(root.MainModule.FileName),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase)) throw new Exception("Cleanup root path differs from this test");
      long birth=root.StartTime.ToUniversalTime().Ticks;
      if (birth<Epoch.AddMilliseconds(startedAt-5000).Ticks) throw new Exception("Cleanup root predates this test");
      var owned=new Dictionary<uint,long>(); owned.Add((uint)pid,birth);
      var handles=new List<IntPtr>(); handles.Add(rootHandle);
      var all=Processes();
      bool added;
      do {
        added=false;
        foreach(var item in all) if(owned.ContainsKey(item.Parent) && !owned.ContainsKey(item.Id)) {
          Process child=null;
          try {
            child=Process.GetProcessById((int)item.Id);
            IntPtr handle=child.Handle;
            long childBirth=child.StartTime.ToUniversalTime().Ticks;
            if(!child.HasExited && childBirth>=owned[item.Parent]) {
              owned.Add(item.Id,childBirth); opened.Add(child); handles.Add(handle); child=null; added=true;
            }
          } catch(ArgumentException) {} catch(InvalidOperationException) {} catch(System.ComponentModel.Win32Exception) {}
          finally { if(child!=null) child.Dispose(); }
        }
      } while(added);
      int terminated=0;
      for(int i=handles.Count-1;i>=0;i--) if(TerminateProcess(handles[i],1)) terminated++;
      return terminated;
    } finally { foreach(var process in opened) process.Dispose(); }
  }
  static void Log(StreamWriter writer, object value) { writer.WriteLine(Json.Serialize(value)); writer.Flush(); }
  static string Capture(IntPtr window, string destination, int width, int height) {
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        var dc = graphics.GetHdc();
        bool success;
        try { success = PrintWindow(window, dc, 2); }
        finally { graphics.ReleaseHdc(dc); }
        if (!success) return "PrintWindow returned false";
      }
      bitmap.Save(destination, ImageFormat.Png);
    }
    return null;
  }
  public static void Run(string folder, int timeoutSeconds) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
    Directory.CreateDirectory(folder);
    string control = Path.Combine(folder, "launch.json"), stop = Path.Combine(folder, "stop");
    string ready = Path.Combine(folder, "ready");
    var monitors = new List<Rect>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data) { monitors.Add(rect); return true; }, IntPtr.Zero);
    Rect preferred = monitors.Find(rect => rect.Right-rect.Left == 1920 && rect.Bottom-rect.Top == 1080);
    File.WriteAllText(ready, Now().ToString());
    long deadline = Now()+timeoutSeconds*1000L;
    while (!File.Exists(control) && !File.Exists(stop) && Now()<deadline) Thread.Sleep(5);
    if (!File.Exists(control)) return;
    Dictionary<string, object> input = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(control));
    uint root = Convert.ToUInt32(input["pid"]);
    string expected = Path.GetFullPath(Convert.ToString(input["path"]));
    long launched = Convert.ToInt64(input["startedAt"]);
    using (var process = Process.GetProcessById((int)root)) {
      if (!String.Equals(Path.GetFullPath(process.MainModule.FileName), expected, StringComparison.OrdinalIgnoreCase)) throw new Exception("Launcher PID path differs from the isolated executable");
      if (process.StartTime.ToUniversalTime() < Epoch.AddMilliseconds(launched-5000)) throw new Exception("Launcher PID predates this test");
    }
    var owned = new Dictionary<uint,long>(); owned.Add(root,Identity(root));
    var seenProcesses = new HashSet<uint>();
    var windows = new Dictionary<long, long>();
    var captures = new Dictionary<long, int>();
    var moved = new HashSet<long>();
    long lastCapture = 0;
    using (var writer = new StreamWriter(Path.Combine(folder, "windows.jsonl"), false, new UTF8Encoding(false))) {
      Log(writer, new { kind="monitor", at=Now(), rootPid=root, executable=expected, launchedAt=launched });
      while (!File.Exists(stop) && Now()<deadline) {
        var all = Processes();
        foreach(var known in new List<uint>(owned.Keys)) if(Identity(known)!=owned[known]) owned.Remove(known);
        bool added;
        do {
          added=false;
          foreach (var item in all) if (owned.ContainsKey(item.Parent) && !owned.ContainsKey(item.Id)) {
            long birth=Identity(item.Id);
            if(birth>0 && birth>=owned[item.Parent]) { owned.Add(item.Id,birth); added=true; }
          }
        } while (added);
        foreach (var item in all) if (owned.ContainsKey(item.Id) && seenProcesses.Add(item.Id))
          Log(writer, new { kind="process", at=Now(), pid=item.Id, parent=item.Parent, name=item.Name });
        long current=Now();
        bool take=current-lastCapture>=70;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
          uint pid; GetWindowThreadProcessId(window, out pid);
          if (!owned.ContainsKey(pid) || Identity(pid)!=owned[pid] || !IsWindowVisible(window)) return true;
          int cloaked=0; DwmGetWindowAttribute(window, 14, out cloaked, 4);
          if (cloaked!=0) return true;
          Rect rect; if (!GetWindowRect(window, out rect)) return true;
          int width=rect.Right-rect.Left, height=rect.Bottom-rect.Top;
          if (width<100 || height<80 || width>4096 || height>4096) return true;
          long handle=window.ToInt64();
          string title=WindowText(window,false), className=WindowText(window,true);
          if (!windows.ContainsKey(handle)) {
            windows.Add(handle,current); captures.Add(handle,0);
            Log(writer,new { kind="visible", at=current, pid=pid, hwnd=handle, title=title, className=className, x=rect.Left, y=rect.Top, width=width, height=height });
          }
          // Only the test launcher's native splash is moved off the TV display.
          if (pid==root && preferred.Right>preferred.Left && moved.Add(handle)) {
            int x=preferred.Left+((preferred.Right-preferred.Left)-width)/2;
            int y=preferred.Top+((preferred.Bottom-preferred.Top)-height)/2;
            SetWindowPos(window,IntPtr.Zero,x,y,0,0,0x0001|0x0004|0x0010);
            GetWindowRect(window,out rect);
            Log(writer,new { kind="test-window-position", at=Now(), pid=pid, hwnd=handle, x=rect.Left,y=rect.Top });
          }
          int count=captures[handle];
          bool early=current-windows[handle]<12000;
          if (take && early && count<80 && IsWindow(window) && IsWindowVisible(window)) {
            string file=String.Format("native-{0}-{1:D3}.png",handle,count);
            string error=Capture(window,Path.Combine(folder,file),width,height);
            captures[handle]=count+1;
            Log(writer,new { kind="capture", at=Now(), observedAt=current, pid=pid, hwnd=handle, title=title, className=className, file=file, width=width, height=height, error=error, method="PrintWindow" });
          }
          return true;
        },IntPtr.Zero);
        if (take) lastCapture=current;
        Thread.Sleep(10);
      }
      Log(writer,new { kind="stopped", at=Now(), ownedPids=new List<uint>(owned.Keys) });
    }
  }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing,System.Web.Extensions
if ($CheckOnly) {
  Write-Output 'Native monitor compiles; PID path ownership, visibility, PrintWindow and timestamp bindings ready. No EXE launched.'
  exit 0
}
if ($CleanupPid -gt 0) {
  $count = [PortableStartupWindows]::Cleanup($CleanupPid, $ExpectedPath, $StartedAt)
  Write-Output "Stopped $count verified test process handles."
  exit 0
}
[PortableStartupWindows]::Run([IO.Path]::GetFullPath($OutDir), $TimeoutSeconds)
