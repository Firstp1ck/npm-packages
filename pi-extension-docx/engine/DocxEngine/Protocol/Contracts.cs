using System.Text.Json;
using System.Text.Json.Serialization;

namespace DocxEngine.Protocol;

public sealed record EngineRequest(
    string ProtocolVersion,
    string Command,
    string? SourcePath,
    string? OutputPath,
    JsonElement? Operations);

public sealed record EngineError(string Code, string Message, object? Details = null);
public sealed record EngineResponse(string ProtocolVersion, bool Ok, string EngineVersion, object? Result = null, EngineError? Error = null, object[]? Warnings = null);

public sealed class EngineException : Exception
{
    public string Code { get; }
    public object? Details { get; }
    public EngineException(string code, string message, object? details = null) : base(message) { Code = code; Details = details; }
}

public static class JsonProtocol
{
    public const string Version = "1.0";
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };
}
