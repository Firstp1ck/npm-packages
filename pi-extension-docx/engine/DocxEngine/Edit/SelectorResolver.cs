using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxEngine.Protocol;

namespace DocxEngine.Edit;

public sealed class SelectorResolver
{
    private const string W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    private readonly Body _body;
    private readonly Dictionary<Paragraph, string> _paragraphPaths = new();
    private readonly Dictionary<Table, string> _tablePaths = new();
    private readonly Dictionary<TableRow, string> _rowPaths = new();
    private readonly Dictionary<TableCell, string> _cellPaths = new();

    public SelectorResolver(Body body)
    {
        _body = body;
        BuildPaths();
    }

    private void BuildPaths()
    {
        var paragraph = 0;
        var table = 0;
        void Walk(OpenXmlElement parent, string basePath)
        {
            foreach (var child in parent.ChildElements)
            {
                if (child is Paragraph p)
                {
                    paragraph++;
                    _paragraphPaths[p] = $"{basePath}/p[{paragraph}]";
                }
                else if (child is Table tbl)
                {
                    table++;
                    var tablePath = $"{basePath}/tbl[{table}]";
                    _tablePaths[tbl] = tablePath;
                    var rowIndex = 0;
                    foreach (var row in tbl.Elements<TableRow>())
                    {
                        rowIndex++;
                        var rowPath = $"{tablePath}/tr[{rowIndex}]";
                        _rowPaths[row] = rowPath;
                        var cellIndex = 0;
                        foreach (var cell in row.Elements<TableCell>())
                        {
                            cellIndex++;
                            _cellPaths[cell] = $"{rowPath}/tc[{cellIndex}]";
                        }
                    }
                    Walk(tbl, tablePath);
                }
                else
                {
                    Walk(child, basePath);
                }
            }
        }
        Walk(_body, "/main");
    }

    public Paragraph ResolveParagraph(JsonElement selector)
    {
        RequireMainStory(selector);
        var kind = RequiredString(selector, "kind");
        var candidates = _body.Descendants<Paragraph>().ToList();
        IEnumerable<Paragraph> matches = kind switch
        {
            "paragraphId" => candidates.Where(p => string.Equals(p.GetAttribute("paraId", W14).Value, RequiredString(selector, "paragraphId"), StringComparison.OrdinalIgnoreCase)),
            "path" => candidates.Where(p => _paragraphPaths.TryGetValue(p, out var paragraphPath) && paragraphPath == RequiredString(selector, "path")),
            "text" => candidates.Where(p => TextSelectorMatches(TextValue(p), selector)),
            "bookmark" => candidates.Where(p => p.Descendants<BookmarkStart>().Any(bookmark => bookmark.Name?.Value == RequiredString(selector, "name"))),
            "contentControl" => ResolveContentControl(selector),
            _ => throw new EngineException("INVALID_ARGUMENT", $"Selector kind {kind} does not select a paragraph."),
        };
        var list = matches.ToList();
        if (kind == "text" && selector.TryGetProperty("expectedCount", out var expected) && expected.GetInt32() != list.Count)
            throw new EngineException("AMBIGUOUS_SELECTOR", "Text selector expectedCount precondition failed.", new { expected = expected.GetInt32(), actual = list.Count });
        if (kind == "text" && selector.TryGetProperty("occurrence", out var occurrence))
        {
            var index = occurrence.GetInt32() - 1;
            if (index < 0 || index >= list.Count) throw new EngineException("SELECTOR_NOT_FOUND", "Text selector occurrence was not found.");
            list = new List<Paragraph> { list[index] };
        }
        if (list.Count == 0) throw new EngineException("SELECTOR_NOT_FOUND", "Paragraph selector matched no paragraph.");
        if (list.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"Paragraph selector matched {list.Count} paragraphs.");
        ValidateParagraphHash(list[0], selector);
        return list[0];
    }

    private static bool TextSelectorMatches(string text, JsonElement selector)
    {
        var anchor = RequiredString(selector, "text");
        if (!text.Contains(anchor, StringComparison.Ordinal)) return false;
        if (selector.TryGetProperty("before", out var before) && !text.Contains((before.GetString() ?? "") + anchor, StringComparison.Ordinal)) return false;
        if (selector.TryGetProperty("after", out var after) && !text.Contains(anchor + (after.GetString() ?? ""), StringComparison.Ordinal)) return false;
        return true;
    }

    private IEnumerable<Paragraph> ResolveContentControl(JsonElement selector)
    {
        var tag = selector.TryGetProperty("tag", out var tagElement) ? tagElement.GetString() : null;
        var title = selector.TryGetProperty("title", out var titleElement) ? titleElement.GetString() : null;
        if (tag is null && title is null) throw new EngineException("INVALID_ARGUMENT", "contentControl selector requires tag or title.");
        return _body.Descendants<SdtElement>()
            .Where(sdt => (tag is null || sdt.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value == tag) && (title is null || sdt.SdtProperties?.GetFirstChild<SdtAlias>()?.Val?.Value == title))
            .SelectMany(sdt => sdt.Descendants<Paragraph>())
            .Distinct();
    }

    private void ValidateParagraphHash(Paragraph paragraph, JsonElement selector)
    {
        if (!selector.TryGetProperty("expectedHash", out var expectedElement) || string.IsNullOrWhiteSpace(expectedElement.GetString())) return;
        var expected = expectedElement.GetString()!;
        var story = selector.TryGetProperty("story", out var storyElement) ? storyElement.GetString() ?? "main" : "main";
        var paragraphPath = _paragraphPaths[paragraph];
        var actual = ShortHash($"{story}\n{paragraphPath}\n{TextValue(paragraph)}");
        if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
            throw new EngineException("SOURCE_CHANGED", "Selector expectedHash precondition failed.", new { expected, actual, path = paragraphPath });
    }

    public TableCell ResolveCell(JsonElement selector)
    {
        RequireMainStory(selector);
        RequireKind(selector, "tableCell");
        var table = _body.Descendants<Table>().ElementAtOrDefault(RequiredInt(selector, "table") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table not found.");
        var row = table.Elements<TableRow>().ElementAtOrDefault(RequiredInt(selector, "row") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table row not found.");
        var cell = row.Elements<TableCell>().ElementAtOrDefault(RequiredInt(selector, "cell") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table cell not found.");
        if (selector.TryGetProperty("expectedHash", out var expectedElement) && !string.IsNullOrWhiteSpace(expectedElement.GetString()))
        {
            var expected = expectedElement.GetString()!;
            var cellPath = _cellPaths[cell];
            var actual = ShortHash($"{cellPath}\n{TextValue(cell)}");
            if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
                throw new EngineException("SOURCE_CHANGED", "Table cell expectedHash precondition failed.", new { expected, actual, path = cellPath });
        }
        return cell;
    }

    public TableRow ResolveRow(JsonElement selector)
    {
        RequireMainStory(selector);
        RequireKind(selector, "tableRow");
        var table = _body.Descendants<Table>().ElementAtOrDefault(RequiredInt(selector, "table") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table not found.");
        var row = table.Elements<TableRow>().ElementAtOrDefault(RequiredInt(selector, "row") - 1) ?? throw new EngineException("SELECTOR_NOT_FOUND", "Table row not found.");
        if (selector.TryGetProperty("expectedHash", out var expectedElement) && !string.IsNullOrWhiteSpace(expectedElement.GetString()))
        {
            var expected = expectedElement.GetString()!;
            var rowPath = _rowPaths[row];
            var cells = row.Elements<TableCell>().Select(cell => TextValue(cell)).ToArray();
            var fingerprint = string.Join("|", cells.Select(value => $"{value.Length}:{value}"));
            var actual = ShortHash($"{rowPath}\n{fingerprint}");
            if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
                throw new EngineException("SOURCE_CHANGED", "Table row expectedHash precondition failed.", new { expected, actual, path = rowPath });
        }
        return row;
    }

    public static string TextValue(OpenXmlElement element) => string.Concat(element.Descendants<Text>().Select(text => text.Text));

    private static void RequireMainStory(JsonElement selector)
    {
        if (selector.TryGetProperty("story", out var story) && story.GetString() is not null and not "main")
            throw new EngineException("UNSUPPORTED_FEATURE", "P1 mutation supports only the main document story.");
    }

    public static string RequiredString(JsonElement value, string name) => value.TryGetProperty(name, out var property) && !string.IsNullOrEmpty(property.GetString()) ? property.GetString()! : throw new EngineException("INVALID_ARGUMENT", $"Missing string property {name}.");
    public static int RequiredInt(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || !property.TryGetInt32(out var result) || result < 1) throw new EngineException("INVALID_ARGUMENT", $"Missing or invalid positive integer property {name}.");
        return result;
    }
    public static void RequireKind(JsonElement selector, string expected)
    {
        var actual = RequiredString(selector, "kind");
        if (actual != expected) throw new EngineException("INVALID_ARGUMENT", $"Expected {expected} selector, received {actual}.");
    }
    private static string ShortHash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..16];
}
