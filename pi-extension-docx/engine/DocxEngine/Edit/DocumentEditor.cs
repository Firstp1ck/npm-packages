using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxEngine.Protocol;

namespace DocxEngine.Edit;

public static class DocumentEditor
{
    public static object Plan(string sourcePath, JsonElement operations)
    {
        using var document = WordprocessingDocument.Open(sourcePath, false);
        var body = document.MainDocumentPart?.Document.Body ?? throw new EngineException("INVALID_PACKAGE", "Document body is missing.");
        var resolver = new SelectorResolver(body);
        var results = new List<object>();
        foreach (var operation in Enumerate(operations)) results.Add(ResolveOnly(operation, resolver, body));
        return new { operationCount = results.Count, operations = results, expectedChangedParts = ExpectedParts(operations) };
    }

    public static object Edit(string sourcePath, string outputPath, JsonElement operations)
    {
        File.Copy(sourcePath, outputPath, true);
        using var document = WordprocessingDocument.Open(outputPath, true, new OpenSettings { AutoSave = true });
        var main = document.MainDocumentPart ?? throw new EngineException("INVALID_PACKAGE", "MainDocumentPart is missing.");
        var body = main.Document.Body ?? throw new EngineException("INVALID_PACKAGE", "Document body is missing.");
        var results = new List<object>();
        foreach (var operation in Enumerate(operations)) { var resolver = new SelectorResolver(body); results.Add(Apply(operation, resolver, body, main, document)); }
        main.Document.Save();
        return new { operationCount = results.Count, operations = results, expectedChangedParts = ExpectedParts(operations) };
    }

    private static IEnumerable<JsonElement> Enumerate(JsonElement operations)
    {
        if (operations.ValueKind != JsonValueKind.Array || operations.GetArrayLength() == 0) throw new EngineException("INVALID_ARGUMENT", "operations must be a non-empty array.");
        foreach (var operation in operations.EnumerateArray()) yield return operation;
    }

    private static object ResolveOnly(JsonElement operation, SelectorResolver resolver, Body body)
    {
        var type = SelectorResolver.RequiredString(operation, "type");
        return type switch
        {
            "replaceText" => PlanReplace(operation, body),
            "setCoreProperties" => new { type, resolved = true, part = "docProps/core.xml" },
            "setTableCellText" => Resolve(resolver.ResolveCell(RequiredObject(operation, "selector")), type),
            "insertTableRow" or "deleteTableRow" => Resolve(resolver.ResolveRow(RequiredObject(operation, "selector")), type),
            _ => Resolve(resolver.ResolveParagraph(RequiredObject(operation, "selector")), type),
        };
    }
    private static object Resolve(OpenXmlElement element, string type) => new { type, resolved = true, currentText = element.InnerText };
    private static object PlanReplace(JsonElement operation, Body body) { var find = SelectorResolver.RequiredString(operation, "find"), expected = SelectorResolver.RequiredInt(operation, "expectedCount"), actual = body.Descendants<Paragraph>().Sum(p => Count(p.InnerText, find)); if (actual != expected) throw new EngineException("AMBIGUOUS_SELECTOR", "replaceText expectedCount precondition failed.", new { expected, actual }); return new { type = "replaceText", resolved = true, expectedCount = expected }; }

    private static object Apply(JsonElement operation, SelectorResolver resolver, Body body, MainDocumentPart main, WordprocessingDocument document)
    {
        var type = SelectorResolver.RequiredString(operation, "type");
        switch (type)
        {
            case "replaceText": return ReplaceText(operation, body);
            case "insertParagraph": return InsertParagraph(operation, resolver);
            case "deleteParagraph": return DeleteParagraph(operation, resolver);
            case "setTableCellText": return SetCell(operation, resolver);
            case "insertTableRow": return InsertRow(operation, resolver);
            case "deleteTableRow": return DeleteRow(operation, resolver);
            case "setCharacterFormatting": return SetCharacterFormatting(operation, resolver);
            case "setParagraphFormatting": return SetParagraphFormatting(operation, resolver);
            case "setHyperlink": return SetHyperlink(operation, resolver, main);
            case "removeHyperlink": return RemoveHyperlink(operation, resolver, main);
            case "setCoreProperties": return SetCoreProperties(operation, document);
            default: throw new EngineException("UNSUPPORTED_FEATURE", $"Unsupported operation: {type}.");
        }
    }

    private static object ReplaceText(JsonElement operation, Body body)
    {
        var find = SelectorResolver.RequiredString(operation, "find"), replacement = operation.GetProperty("replacement").GetString() ?? "", expected = SelectorResolver.RequiredInt(operation, "expectedCount");
        if (operation.TryGetProperty("story", out var story) && story.GetString() is not null and not "main") throw new EngineException("UNSUPPORTED_FEATURE", "P1 replaceText supports only the main story.");
        var matches = body.Descendants<Paragraph>().Sum(p => Count(p.InnerText, find)); if (matches != expected) throw new EngineException("AMBIGUOUS_SELECTOR", "replaceText expectedCount precondition failed.", new { expected, actual = matches });
        foreach (var paragraph in body.Descendants<Paragraph>().ToList()) while (paragraph.InnerText.Contains(find, StringComparison.Ordinal)) ReplaceFirst(paragraph, find, replacement);
        return new { type = "replaceText", replacements = matches };
    }

    private static void ReplaceFirst(Paragraph paragraph, string find, string replacement)
    {
        var texts = paragraph.Descendants<Text>().ToList(), combined = string.Concat(texts.Select(t => t.Text)), start = combined.IndexOf(find, StringComparison.Ordinal); if (start < 0) return; var end = start + find.Length, cursor = 0, first = -1, last = -1, firstOffset = 0, lastOffset = 0;
        for (var index = 0; index < texts.Count; index++) { var next = cursor + texts[index].Text.Length; if (first < 0 && start < next) { first = index; firstOffset = start - cursor; } if (end <= next) { last = index; lastOffset = end - cursor; break; } cursor = next; }
        if (first < 0 || last < 0) throw new EngineException("VALIDATION_FAILED", "Cross-run replacement mapping failed.");
        var prefix = texts[first].Text[..firstOffset], suffix = texts[last].Text[lastOffset..]; texts[first].Text = prefix + replacement + (first == last ? suffix : ""); PreserveSpace(texts[first]); for (var index = first + 1; index < last; index++) texts[index].Text = ""; if (last != first) { texts[last].Text = suffix; PreserveSpace(texts[last]); }
    }
    private static void PreserveSpace(Text text) { text.Space = text.Text.StartsWith(' ') || text.Text.EndsWith(' ') ? SpaceProcessingModeValues.Preserve : null; }
    private static int Count(string value, string find) { var count = 0, index = 0; while ((index = value.IndexOf(find, index, StringComparison.Ordinal)) >= 0) { count++; index += find.Length; } return count; }

    private static object InsertParagraph(JsonElement operation, SelectorResolver resolver) { var anchor = resolver.ResolveParagraph(RequiredObject(operation, "selector")), paragraph = new Paragraph(new Run(new Text(operation.GetProperty("text").GetString() ?? ""))); if (operation.TryGetProperty("style", out var style) && !string.IsNullOrWhiteSpace(style.GetString())) paragraph.ParagraphProperties = new ParagraphProperties(new ParagraphStyleId { Val = style.GetString() }); var position = SelectorResolver.RequiredString(operation, "position"); if (position == "before") anchor.InsertBeforeSelf(paragraph); else if (position == "after") anchor.InsertAfterSelf(paragraph); else throw new EngineException("INVALID_ARGUMENT", "position must be before or after."); return new { type = "insertParagraph", position, text = paragraph.InnerText }; }
    private static object DeleteParagraph(JsonElement operation, SelectorResolver resolver) { var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = paragraph.InnerText; if (operation.TryGetProperty("expectedText", out var expected) && expected.GetString() != text) throw new EngineException("SOURCE_CHANGED", "deleteParagraph expectedText precondition failed."); paragraph.Remove(); return new { type = "deleteParagraph", deletedText = text }; }
    private static object SetCell(JsonElement operation, SelectorResolver resolver) { var cell = resolver.ResolveCell(RequiredObject(operation, "selector")), before = cell.InnerText; if (operation.TryGetProperty("expectedText", out var expected) && expected.GetString() != before) throw new EngineException("SOURCE_CHANGED", "setTableCellText expectedText precondition failed."); cell.RemoveAllChildren<Paragraph>(); cell.Append(new Paragraph(new Run(new Text(operation.GetProperty("text").GetString() ?? "")))); return new { type = "setTableCellText", before, after = cell.InnerText }; }
    private static void GuardMerged(TableRow row) { if (row.Descendants<VerticalMerge>().Any() || row.Descendants<GridSpan>().Any(span => (span.Val?.Value ?? 1) > 1)) throw new EngineException("UNSUPPORTED_FEATURE", "Row insertion/deletion is blocked for vertically or horizontally merged target rows."); }
    private static object InsertRow(JsonElement operation, SelectorResolver resolver) { var anchor = resolver.ResolveRow(RequiredObject(operation, "selector")); GuardMerged(anchor); var row = new TableRow(); foreach (var value in operation.GetProperty("cells").EnumerateArray()) row.Append(new TableCell(new Paragraph(new Run(new Text(value.GetString() ?? ""))))); var position = SelectorResolver.RequiredString(operation, "position"); if (position == "before") anchor.InsertBeforeSelf(row); else if (position == "after") anchor.InsertAfterSelf(row); else throw new EngineException("INVALID_ARGUMENT", "position must be before or after."); return new { type = "insertTableRow", position, cells = row.Elements<TableCell>().Count() }; }
    private static object DeleteRow(JsonElement operation, SelectorResolver resolver) { var row = resolver.ResolveRow(RequiredObject(operation, "selector")); GuardMerged(row); var text = row.InnerText; row.Remove(); return new { type = "deleteTableRow", deletedText = text }; }

    private static object SetCharacterFormatting(JsonElement operation, SelectorResolver resolver) { var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), patch = RequiredObject(operation, "formatting"), runs = paragraph.Descendants<Run>().ToList(); foreach (var run in runs) { var props = run.RunProperties ?? run.PrependChild(new RunProperties()); SetOnOff(props, patch, "bold", () => props.Bold, value => props.Bold = value ? new Bold() : null); SetOnOff(props, patch, "italic", () => props.Italic, value => props.Italic = value ? new Italic() : null); if (patch.TryGetProperty("underline", out var underline)) props.Underline = underline.GetString() switch { "none" => new Underline { Val = UnderlineValues.None }, "double" => new Underline { Val = UnderlineValues.Double }, _ => new Underline { Val = UnderlineValues.Single } }; if (patch.TryGetProperty("fontFamily", out var family)) props.RunFonts = new RunFonts { Ascii = family.GetString(), HighAnsi = family.GetString() }; if (patch.TryGetProperty("fontSizePoints", out var size)) props.FontSize = new FontSize { Val = (size.GetDouble() * 2).ToString(System.Globalization.CultureInfo.InvariantCulture) }; if (patch.TryGetProperty("color", out var color)) props.Color = new Color { Val = color.GetString() }; } return new { type = "setCharacterFormatting", runCount = runs.Count }; }
    private static void SetOnOff<T>(RunProperties props, JsonElement patch, string name, Func<T?> get, Action<bool> set) where T : OpenXmlElement { if (patch.TryGetProperty(name, out var value)) set(value.GetBoolean()); }
    private static object SetParagraphFormatting(JsonElement operation, SelectorResolver resolver) { var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), patch = RequiredObject(operation, "formatting"), props = paragraph.ParagraphProperties ?? paragraph.PrependChild(new ParagraphProperties()); if (patch.TryGetProperty("style", out var style)) props.ParagraphStyleId = new ParagraphStyleId { Val = style.GetString() }; if (patch.TryGetProperty("alignment", out var alignment)) props.Justification = new Justification { Val = alignment.GetString() switch { "center" => JustificationValues.Center, "right" => JustificationValues.Right, "both" => JustificationValues.Both, _ => JustificationValues.Left } }; var spacing = props.SpacingBetweenLines ??= new SpacingBetweenLines(); if (patch.TryGetProperty("spacingBeforePoints", out var before)) spacing.Before = Twips(before.GetDouble()); if (patch.TryGetProperty("spacingAfterPoints", out var after)) spacing.After = Twips(after.GetDouble()); if (patch.TryGetProperty("lineSpacing", out var line)) { spacing.Line = Math.Round(line.GetDouble() * 240).ToString(); spacing.LineRule = LineSpacingRuleValues.Auto; } var indentation = props.Indentation ??= new Indentation(); if (patch.TryGetProperty("indentLeftPoints", out var left)) indentation.Left = Twips(left.GetDouble()); if (patch.TryGetProperty("indentRightPoints", out var right)) indentation.Right = Twips(right.GetDouble()); if (patch.TryGetProperty("firstLineIndentPoints", out var first)) indentation.FirstLine = Twips(first.GetDouble()); return new { type = "setParagraphFormatting", text = paragraph.InnerText }; }
    private static string Twips(double points) => Math.Round(points * 20).ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static object SetHyperlink(JsonElement operation, SelectorResolver resolver, MainDocumentPart main) { var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = SelectorResolver.RequiredString(operation, "text"), target = SelectorResolver.RequiredString(operation, "target"); if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto")) throw new EngineException("INVALID_ARGUMENT", "P1 hyperlinks support only absolute http, https, or mailto targets."); var existing = paragraph.Descendants<Hyperlink>().FirstOrDefault(link => link.InnerText == text); var relationship = main.AddHyperlinkRelationship(uri, true); if (existing is not null) { if (existing.Id?.Value is string oldId) main.DeleteReferenceRelationship(oldId); existing.Id = relationship.Id; if (operation.TryGetProperty("tooltip", out var tooltip)) existing.Tooltip = tooltip.GetString(); return new { type = "setHyperlink", updated = true }; } var textNode = paragraph.Descendants<Text>().FirstOrDefault(node => node.Text == text) ?? throw new EngineException("UNSUPPORTED_FEATURE", "Adding a hyperlink requires the selected text to occupy one complete run in P1."); var run = textNode.Ancestors<Run>().First(), hyperlink = new Hyperlink { Id = relationship.Id, Tooltip = operation.TryGetProperty("tooltip", out var tip) ? tip.GetString() : null }; hyperlink.Append(run.CloneNode(true)); run.InsertAfterSelf(hyperlink); run.Remove(); return new { type = "setHyperlink", updated = false }; }
    private static object RemoveHyperlink(JsonElement operation, SelectorResolver resolver, MainDocumentPart main) { var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")); var text = operation.TryGetProperty("text", out var textElement) ? textElement.GetString() : null; var matches = paragraph.Descendants<Hyperlink>().Where(link => text is null || link.InnerText == text).ToList(); if (matches.Count != 1) throw new EngineException(matches.Count == 0 ? "SELECTOR_NOT_FOUND" : "AMBIGUOUS_SELECTOR", $"removeHyperlink matched {matches.Count} hyperlinks."); var link = matches[0]; if (link.Id?.Value is string id) main.DeleteReferenceRelationship(id); foreach (var child in link.ChildElements.ToList()) link.InsertBeforeSelf(child.CloneNode(true)); link.Remove(); return new { type = "removeHyperlink", text }; }
    private static object SetCoreProperties(JsonElement operation, WordprocessingDocument document) { var properties = RequiredObject(operation, "properties"), package = document.PackageProperties; if (properties.TryGetProperty("title", out var title)) package.Title = title.GetString(); if (properties.TryGetProperty("subject", out var subject)) package.Subject = subject.GetString(); if (properties.TryGetProperty("creator", out var creator)) package.Creator = creator.GetString(); if (properties.TryGetProperty("keywords", out var keywords)) package.Keywords = keywords.GetString(); if (properties.TryGetProperty("description", out var description)) package.Description = description.GetString(); if (properties.TryGetProperty("category", out var category)) package.Category = category.GetString(); return new { type = "setCoreProperties", updated = properties.EnumerateObject().Select(p => p.Name).ToArray() }; }

    private static JsonElement RequiredObject(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Object ? property : throw new EngineException("INVALID_ARGUMENT", $"Missing object property {name}.");
    private static string[] ExpectedParts(JsonElement operations) { var parts = new HashSet<string>(); foreach (var operation in Enumerate(operations)) { var type = SelectorResolver.RequiredString(operation, "type"); if (type == "setCoreProperties") parts.Add("docProps/core.xml"); else { parts.Add("word/document.xml"); if (type is "setHyperlink" or "removeHyperlink") parts.Add("word/_rels/document.xml.rels"); } } return parts.OrderBy(value => value).ToArray(); }
}
