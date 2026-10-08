using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
namespace ILedger;

public sealed class LedgerStore : IDisposable {
    [DllImport("iledger_core", CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr il_open([MarshalAs(UnmanagedType.LPUTF8Str)] string path, [MarshalAs(UnmanagedType.LPUTF8Str)] string seed);
    [DllImport("iledger_core", CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr il_execute(IntPtr store, [MarshalAs(UnmanagedType.LPUTF8Str)] string request);
    [DllImport("iledger_core", CallingConvention=CallingConvention.Cdecl)] private static extern void il_free(IntPtr response);
    [DllImport("iledger_core", CallingConvention=CallingConvention.Cdecl)] private static extern void il_close(IntPtr store);
    [DllImport("iledger_core", CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr il_last_error();
    private readonly object gate = new();
    private IntPtr handle;
    public LedgerStore() {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "iLedger Native");
        Directory.CreateDirectory(directory);
        handle = il_open(Path.Combine(directory,"ledger.sqlite"),File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"presets.json")));
        if(handle == IntPtr.Zero) throw new InvalidOperationException(Marshal.PtrToStringUTF8(il_last_error()));
    }
    public Task<JsonObject> Execute(JsonObject request) => Task.Run(() => {
        lock(gate) {
            ObjectDisposedException.ThrowIf(handle == IntPtr.Zero,this);
            var pointer=il_execute(handle,request.ToJsonString());
            if(pointer==IntPtr.Zero)throw new InvalidOperationException("数据库内存不足");
            try {
                var response=JsonNode.Parse(Marshal.PtrToStringUTF8(pointer)!)!.AsObject();
                if(response["ok"]?.GetValue<bool>()!=true)throw new InvalidOperationException(response["error"]?.GetValue<string>());
                return response["data"]?.AsObject() ?? new JsonObject();
            } finally { il_free(pointer); }
        }
    });
    public void Dispose(){lock(gate){if(handle!=IntPtr.Zero){il_close(handle);handle=IntPtr.Zero;}}}
}
public static class RecordExtensions {
    public static string Text(this JsonObject row,string key,string fallback="") => row[key]?.ToString() ?? fallback;
    public static double Number(this JsonObject row,string key) => double.TryParse(row.Text(key),System.Globalization.NumberStyles.Any,System.Globalization.CultureInfo.InvariantCulture,out var number)?number:0;
    public static IEnumerable<JsonObject> Rows(this JsonObject state,string key) => state[key]?.AsArray().OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>();
}
