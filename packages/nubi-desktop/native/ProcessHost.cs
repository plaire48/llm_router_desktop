using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// This process owns one command tree. Closing its non-inherited Job handle
// terminates only that tree, including MSYS children retaining output pipes.
internal static class ProcessHost
{
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long PerProcess, PerJob; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved, Desktop, Title; public uint X, Y, Width, Height, CharsX, CharsY, Fill, Flags; public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Base; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    // Windows CommandLineToArgv/CRT quoting; no cmd.exe or shell interpolation.
    static string Quote(string value)
    {
        var text = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') text.Append('\\', slashes * 2 + 1);
            else text.Append('\\', slashes);
            text.Append(c); slashes = 0;
        }
        return text.Append('\\', slashes * 2).Append('"').ToString();
    }
    static int Main(string[] args)
    {
        if (args.Length < 1) return 120;
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobs = IntPtr.Zero, handles = IntPtr.Zero; ProcessInfo child = new ProcessInfo(); bool initialized = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return 121;
            var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) return 122;
            var start = new StartupEx(); start.Base.Size = (uint)Marshal.SizeOf(start); start.Base.Flags = 0x100;
            start.Base.Input = GetStdHandle(-10); start.Base.Output = GetStdHandle(-11); start.Base.Error = GetStdHandle(-12);
            foreach (var handle in new[] {start.Base.Input, start.Base.Output, start.Base.Error})
                if (handle == IntPtr.Zero || handle == new IntPtr(-1) || !SetHandleInformation(handle, 1, 1)) return 123;
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            if (size == IntPtr.Zero) return 131;
            attributes = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributes, 2, 0, ref size)) return 132;
            initialized = true; start.Attributes = attributes;
            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job);
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handles, 0, start.Base.Input); Marshal.WriteIntPtr(handles, IntPtr.Size, start.Base.Output); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, start.Base.Error);
            // Job membership is assigned during creation, with no post-create
            // gap that could orphan a suspended child if this helper is killed.
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) return 133;
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) return 134;
            var command = new StringBuilder(); foreach (string arg in args) { if (command.Length > 0) command.Append(' '); command.Append(Quote(arg)); }
            if (!CreateProcess(args[0], command, IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, null, ref start, out child)) return 124;
            // Never fall back to launching without job membership.
            if (ResumeThread(child.Thread) == 0xffffffff) return 126;
            if (WaitForSingleObject(child.Process, 0xffffffff) != 0) return 127;
            uint code; if (!GetExitCodeProcess(child.Process, out code)) return 128;
            // Background descendants still belong to this command. Keep ownership
            // alive until they finish or the host explicitly cancels this helper.
            for (;;) {
                Accounting state;
                if (!QueryInformationJobObject(job, 1, out state, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) return 129;
                if (state.ActiveProcesses == 0) break;
                Thread.Sleep(20);
            }
            return unchecked((int)code);
        } catch { return 130; }
        finally {
            if (initialized) DeleteProcThreadAttributeList(attributes);
            foreach (var memory in new[] {attributes, jobs, handles}) if (memory != IntPtr.Zero) Marshal.FreeHGlobal(memory);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
        }
    }
}
