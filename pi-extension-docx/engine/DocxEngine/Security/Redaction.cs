using System.Text.RegularExpressions;

namespace DocxEngine.Security;

public static partial class Redaction
{
    [GeneratedRegex("(?i)(password|passwd|pwd|secret|token)(\\s*[=:]\\s*)([^\\s,;]+)")]
    private static partial Regex Sensitive();
    public static string Apply(string value) => Sensitive().Replace(value, "$1$2[REDACTED]");
}
