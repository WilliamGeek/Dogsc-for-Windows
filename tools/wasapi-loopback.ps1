# tools/wasapi-loopback.ps1
# Zero-dependency Windows WASAPI Loopback audio capture to WAV file.
# Emits one JSON header line to stdout once capture starts, then records until 'q' or stdin EOF.

param(
    [Parameter(Mandatory = $true)]
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class DogSCWasapiLoopback
{
    private const int CLSCTX_ALL = 23;
    private const int eRender = 0;
    private const int eConsole = 0;
    private const int AUDCLNT_SHAREMODE_SHARED = 0;
    private const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    private const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    private const ushort WAVE_FORMAT_PCM = 1;
    private const ushort WAVE_FORMAT_IEEE_FLOAT = 3;
    private const ushort WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

    private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    private static readonly Guid KSDATAFORMAT_SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00aa00389b71");
    private static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice ppEndpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int ShareMode, int StreamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, [MarshalAs(UnmanagedType.LPStruct)] Guid AudioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint pNumBufferFrames);
        [PreserveSig] int GetStreamLatency(out long phnsLatency);
        [PreserveSig] int GetCurrentPadding(out uint pNumPaddingFrames);
        [PreserveSig] int IsFormatSupported(int ShareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr ppDeviceFormat);
        [PreserveSig] int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        [PreserveSig] int ReleaseBuffer(uint NumFramesRead);
        [PreserveSig] int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    private static void CheckHr(int hr, string context)
    {
        if (hr < 0)
        {
            Marshal.ThrowExceptionForHR(hr);
        }
    }

    public static void Run(string outFile)
    {
        string dir = Path.GetDirectoryName(Path.GetFullPath(outFile));
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice device;
        CheckHr(enumerator.GetDefaultAudioEndpoint(eRender, eConsole, out device), "GetDefaultAudioEndpoint");

        object clientObj;
        CheckHr(device.Activate(IID_IAudioClient, CLSCTX_ALL, IntPtr.Zero, out clientObj), "Activate(IAudioClient)");
        var audioClient = (IAudioClient)clientObj;

        IntPtr pFormat = IntPtr.Zero;
        FileStream fs = null;
        bool started = false;
        try
        {
            CheckHr(audioClient.GetMixFormat(out pFormat), "GetMixFormat");
            var wf = (WAVEFORMATEX)Marshal.PtrToStructure(pFormat, typeof(WAVEFORMATEX));
            ushort resolvedTag = wf.wFormatTag;
            if (resolvedTag == WAVE_FORMAT_EXTENSIBLE && wf.cbSize >= 22)
            {
                byte[] guidBytes = new byte[16];
                Marshal.Copy(IntPtr.Add(pFormat, Marshal.SizeOf(typeof(WAVEFORMATEX)) + 6), guidBytes, 0, 16);
                var subFormat = new Guid(guidBytes);
                if (subFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) resolvedTag = WAVE_FORMAT_IEEE_FLOAT;
                else if (subFormat == KSDATAFORMAT_SUBTYPE_PCM) resolvedTag = WAVE_FORMAT_PCM;
            }

            long hnsBufferDuration = 10000000; // 1.0s
            CheckHr(
                audioClient.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, hnsBufferDuration, 0, pFormat, Guid.Empty),
                "Initialize"
            );

            object capObj;
            CheckHr(audioClient.GetService(IID_IAudioCaptureClient, out capObj), "GetService(IAudioCaptureClient)");
            var captureClient = (IAudioCaptureClient)capObj;

            fs = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.Read);
            using (var bw = new BinaryWriter(fs, System.Text.Encoding.ASCII, true))
            {
                // Standard 44-byte RIFF/WAVE header (data sizes patched on exit)
                bw.Write(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' });
                bw.Write((uint)36);
                bw.Write(new byte[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E' });
                bw.Write(new byte[] { (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
                bw.Write((uint)16);
                bw.Write((ushort)(resolvedTag == WAVE_FORMAT_EXTENSIBLE ? WAVE_FORMAT_PCM : resolvedTag));
                bw.Write(wf.nChannels);
                bw.Write(wf.nSamplesPerSec);
                bw.Write(wf.nAvgBytesPerSec);
                bw.Write(wf.nBlockAlign);
                bw.Write(wf.wBitsPerSample);
                bw.Write(new byte[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' });
                bw.Write((uint)0);
            }

            long startUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            CheckHr(audioClient.Start(), "Start");
            started = true;

            Console.Out.WriteLine(string.Format(
                CultureInfo.InvariantCulture,
                "{{\"hdr\":1,\"startUnixMs\":{0},\"sampleRate\":{1},\"channels\":{2},\"bitsPerSample\":{3},\"formatTag\":{4}}}",
                startUnixMs,
                wf.nSamplesPerSec,
                wf.nChannels,
                wf.wBitsPerSample,
                resolvedTag
            ));
            Console.Out.Flush();

            int stopRequested = 0;
            var stdinThread = new Thread(() =>
            {
                try
                {
                    while (true)
                    {
                        string line = Console.In.ReadLine();
                        if (line == null || line.Trim().Equals("q", StringComparison.OrdinalIgnoreCase))
                        {
                            Interlocked.Exchange(ref stopRequested, 1);
                            break;
                        }
                    }
                }
                catch
                {
                    Interlocked.Exchange(ref stopRequested, 1);
                }
            });
            stdinThread.IsBackground = true;
            stdinThread.Start();

            ulong dataBytes = 0;
            int blockAlign = Math.Max((int)wf.nBlockAlign, 1);
            byte[] buf = new byte[65536];

            while (Thread.VolatileRead(ref stopRequested) == 0)
            {
                uint packetLength = 0;
                CheckHr(captureClient.GetNextPacketSize(out packetLength), "GetNextPacketSize");
                if (packetLength == 0)
                {
                    Thread.Sleep(5);
                    continue;
                }

                while (packetLength > 0 && Thread.VolatileRead(ref stopRequested) == 0)
                {
                    IntPtr pData;
                    uint numFrames;
                    uint flags;
                    ulong devPos;
                    ulong qpcPos;
                    CheckHr(captureClient.GetBuffer(out pData, out numFrames, out flags, out devPos, out qpcPos), "GetBuffer");
                    int byteCount = (int)numFrames * blockAlign;
                    if (byteCount > 0)
                    {
                        if (byteCount > buf.Length) buf = new byte[byteCount];
                        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || pData == IntPtr.Zero)
                        {
                            Array.Clear(buf, 0, byteCount);
                        }
                        else
                        {
                            Marshal.Copy(pData, buf, 0, byteCount);
                        }
                        fs.Write(buf, 0, byteCount);
                        dataBytes += (ulong)byteCount;
                    }
                    CheckHr(captureClient.ReleaseBuffer(numFrames), "ReleaseBuffer");
                    CheckHr(captureClient.GetNextPacketSize(out packetLength), "GetNextPacketSize");
                }
            }

            fs.Flush();
            uint safeDataSize = (uint)Math.Min(dataBytes, (ulong)uint.MaxValue - 36);
            fs.Seek(4, SeekOrigin.Begin);
            byte[] riffSize = BitConverter.GetBytes((uint)(36 + safeDataSize));
            fs.Write(riffSize, 0, 4);
            fs.Seek(40, SeekOrigin.Begin);
            byte[] dataSizeBytes = BitConverter.GetBytes(safeDataSize);
            fs.Write(dataSizeBytes, 0, 4);
            fs.Flush();
        }
        finally
        {
            if (started)
            {
                try { audioClient.Stop(); } catch { }
            }
            if (fs != null)
            {
                try { fs.Dispose(); } catch { }
            }
            if (pFormat != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(pFormat);
            }
        }
    }
}
"@

[DogSCWasapiLoopback]::Run($OutFile)
