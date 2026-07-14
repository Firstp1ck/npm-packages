using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxEngine.Protocol;

namespace DocxEngine.Edit;

public sealed class SelectorResolver
{
    private const string W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    private readonly Body _body;
    private readonly Dictionary<Paragraph, string> _paths = new();
    public SelectorResolver(Body body) { _body = body; BuildPaths(); }

    private void BuildPaths()
    {
        var paragraph = 0;
        var table = 0;
        void Walk(OpenXmlElement parent, string basePath)
        {
            foreach (var child in parent.ChildElements)
            {
                if (child is Paragraph p) { paragraph++; _paths[p] = $"{basePath}/p[{paragraph}]"; }
                else if (child is Table tbl) { table++; var tablePath = $"{basePath}/tbl[{table}]"; Walk(tbl, tablePath); }
                else Walk(child, basePath);
            }
        }
        Walk(_body, "/main");
    }

    public Paragraph ResolveParagraph(JsonElement selector)
    {
        var kind = RequiredString(selector, "kind");
        var candidates = _body.Descendants<Paragraph>().ToList();
        if (selector.TryGetProperty("story", out var story) && story.GetString() is not null and not "main") throw new EngineException("UNSUPPORTED_FEATURE", "P1 mutation supports only the main document story.");
        IEnumerable<Paragraph> matches = kind switch
        {
            "paragraphId" => candidates.Where(p => string.Equals(p.GetAttribute("paraId", W14).Value, RequiredString(selector, "paragraphId"), StringComparison.OrdinalIgnoreCase)),
            "path" => candidates.Where(p => _paths.TryGetValue(p, out var path) && path == RequiredString(selector, "path")),
            "text" => candidates.Where(p => p.InnerText.Contains(RequiredString(selector, "text"), StringComparison.Ordinal)),
            "bookmark" => candidates.Where(p => p.Descendants<BookmarkStart>().Any(b => b.Name?.Value == RequiredString(selector, "name"))),
            "contentControl" => ResolveContentControl(selector),
            _ => throw new EngineException("INVALID_ARGUMENT", $"Selector kind {kind} does not select a paragraph."),
        };
        var list = matches.ToList();
        if (kind == "text" && selector.TryGetProperty("expectedCount", out var expected) && expected.GetInt32() != list.Count) throw new EngineException("AMBIGUOUS_SELECTOR", "Text selector expectedCount precondition failed.", new { expected = expected.GetInt32(), actual = list.Count });
        if (kind == "text" && selector.TryGetProperty("occurrence", out var occurrence)) { var index = occurrence.GetInt32() - 1; if (index < 0 || index >= list.Count) throw new EngineException("SELECTOR_NOT_FOUND", "Text selector occurrence was not found."); list = new List<Paragraph> { list[index] }; }
        if (list.Count == 0) throw new EngineException("SELECTOR_NOT_FOUND", "Paragraph selector matched no paragraph.");
        if (list.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"Paragraph selector matched {list.Count} paragraphs.");
        ValidateHash(list[0], selector);
        return list[0];
    }

    private IEnumerable<Paragraph> ResolveContentControl(JsonElement selector)
    {
        var tag = selector.TryGetProperty("tag", out var tagElement) ? tagElement.GetString() : null;
        var title = selector.TryGetProperty("title", out var titleElement) ? titleElement.GetString() : null;
        if (tag is null && title is null) throw new EngineException("INVALID_ARGUMENT", "contentControl selector requires tag or title.");
        return _body.Descendants<SdtElement>().Where(sdt => (tag is null || sdt.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value == tag) && (title is null || sdt.SdtProperties?.GetFirstChild<SdtAlias>()?.Val?.Value == title)).SelectMany(sdt => sdt.Descendants<Paragraph>()).Distinct();
    }

    private void ValidateHash(Paragraph paragraph, JsonElement selector)
    {
        if (!selector.TryGetProperty("expectedHash", out var expectedElement)) return;
        var expected = expectedElement.GetString(); if (string.IsNullOrWhiteSpace(expected)) return;
        var story = selector.TryGetProperty("story", out var storyElement) ? storyElement.GetString() ?? "main" : "main";
        var path = _paths[paragraph]; var actual = ShortHash($"{story}\n{path}\n{paragraph.InnerText}");
        if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new EngineException("SOURCE_CHANGED", "Selector expectedHash precondition failed.", new { expected, actual, path });
    }

    public TableCell ResolveCell(JsonElement selector)
    {
        RequireKind(selector, "tableCell"); var tableNumber = RequiredInt(selector, "table"), rowNumber = RequiredInt(selector, "row"), cellNumber = RequiredInt(selector, "cell"); var table = _body.Descendants<Table>().ElementAtOrDefault(tableNumber - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table not found."); var row = table.Elements<TableRow>().ElementAtOrDefault(rowNumber - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table row not found."); return row.Elements<TableCell>().ElementAtOrDefault(cellNumber - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table cell not found.");
    }
    public TableRow ResolveRow(JsonElement selector) { RequireKind(selector, "tableRow"); var table = _body.Descendants<Table>().ElementAtOrDefault(RequiredInt(selector, "table") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table not found."); return table.Elements<TableRow>().ElementAtOrDefault(RequiredInt(selector, "row") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table row not found."); }
    public static string RequiredString(JsonElement value, string name) => value.TryGetProperty(name, out var property) && !string.IsNullOrEmpty(property.GetString()) ? property.GetString()! : throw new EngineException("INVALID_ARGUMENT", $"Missing string property {name}.");
    public static int RequiredInt(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.TryGetInt32(out var result) ? result : throw new EngineException("INVALID_ARGUMENT", $"Missing integer property {name}.");
    public static void RequireKind(JsonElement selector, string expected) { var actual = RequiredString(selector, "kind"); if (actual != expected) throw new EngineException("INVALID_ARGUMENT", $"Expected {expected} selector, received {actual}."); }
    private static string ShortHash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..16];
}
