using System.Reflection;
using System.Text.Json;
using DocxEngine.Edit;
using DocxEngine.Inspect;
using DocxEngine.Protocol;
using DocxEngine.Security;
using DocxEngine.Validate;

var engineVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
EngineResponse response;
try
{
    var json = await Console.In.ReadToEndAsync();
    var request = JsonSerializer.Deserialize<EngineRequest>(json, JsonProtocol.Options) ?? throw new EngineException("PROTOCOL_ERROR", "Request JSON is empty.");
    if (request.ProtocolVersion != JsonProtocol.Version) throw new EngineException("PROTOCOL_ERROR", $"Unsupported protocol version {request.ProtocolVersion}.");
    object? result = request.Command switch
    {
        "version" => new { protocolVersion = JsonProtocol.Version, engineVersion, openXmlSdk = typeof(DocumentFormat.OpenXml.OpenXmlElement).Assembly.GetName().Version?.ToString() },
        "inspect" => DocumentInspector.Inspect(RequirePath(request.SourcePath, "sourcePath")),
        "plan" => DocumentEditor.Plan(RequirePath(request.SourcePath, "sourcePath"), RequireOperations(request.Operations)),
        "edit" => DocumentEditor.Edit(RequirePath(request.SourcePath, "sourcePath"), RequirePath(request.OutputPath, "outputPath"), RequireOperations(request.Operations)),
        "validate" => DocumentValidator.Validate(RequirePath(request.SourcePath, "sourcePath")),
        _ => throw new EngineException("PROTOCOL_ERROR", $"Unknown command {request.Command}."),
    };
    response = new EngineResponse(JsonProtocol.Version, true, engineVersion, result);
}
catch (EngineException error) { response = new EngineResponse(JsonProtocol.Version, false, engineVersion, Error: new EngineError(error.Code, Redaction.Apply(error.Message), error.Details)); Environment.ExitCode = 2; }
catch (Exception error) { response = new EngineResponse(JsonProtocol.Version, false, engineVersion, Error: new EngineError("VALIDATION_FAILED", Redaction.Apply(error.Message))); Environment.ExitCode = 1; }
Console.Out.WriteLine(JsonSerializer.Serialize(response, JsonProtocol.Options));

static string RequirePath(string? value, string name)
{
    if (string.IsNullOrWhiteSpace(value)) throw new EngineException("INVALID_ARGUMENT", $"{name} is required.");
    return Path.GetFullPath(value);
}
static JsonElement RequireOperations(JsonElement? value) => value is { ValueKind: JsonValueKind.Array } element ? element : throw new EngineException("INVALID_ARGUMENT", "operations must be an array.");
