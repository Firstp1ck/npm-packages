using System.Text.Json;
using System.Text.RegularExpressions;
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
        var main = document.MainDocumentPart ?? throw new EngineException("INVALID_PACKAGE", "MainDocumentPart is missing.");
        var body = main.Document.Body ?? throw new EngineException("INVALID_PACKAGE", "Document body is missing.");
        var resolver = new SelectorResolver(body);
        var results = new List<object>();
        foreach (var operation in Enumerate(operations)) results.Add(ResolveOnly(operation, resolver, body, main));
        return new { operationCount = results.Count, operations = results, expectedChangedParts = ExpectedParts(operations, main.Uri.OriginalString) };
    }

    public static object Edit(string sourcePath, string outputPath, JsonElement operations)
    {
        File.Copy(sourcePath, outputPath, true);
        using var document = WordprocessingDocument.Open(outputPath, true, new OpenSettings { AutoSave = true });
        var main = document.MainDocumentPart ?? throw new EngineException("INVALID_PACKAGE", "MainDocumentPart is missing.");
        var body = main.Document.Body ?? throw new EngineException("INVALID_PACKAGE", "Document body is missing.");
        var results = new List<object>();
        foreach (var operation in Enumerate(operations))
        {
            var resolver = new SelectorResolver(body);
            results.Add(Apply(operation, resolver, body, main, document));
        }
        main.Document.Save();
        return new { operationCount = results.Count, operations = results, expectedChangedParts = ExpectedParts(operations, main.Uri.OriginalString) };
    }

    private static IEnumerable<JsonElement> Enumerate(JsonElement operations)
    {
        if (operations.ValueKind != JsonValueKind.Array || operations.GetArrayLength() == 0) throw new EngineException("INVALID_ARGUMENT", "operations must be a non-empty array.");
        foreach (var operation in operations.EnumerateArray()) yield return operation;
    }

    private static object ResolveOnly(JsonElement operation, SelectorResolver resolver, Body body, MainDocumentPart main)
    {
        var type = SelectorResolver.RequiredString(operation, "type");
        switch (type)
        {
            case "replaceText": return PlanReplace(operation, resolver, body);
            case "insertParagraph": return Resolve(resolver.ResolveParagraph(RequiredObject(operation, "selector")), type);
            case "deleteParagraph":
            {
                var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector"));
                CheckExpectedText(operation, SelectorResolver.TextValue(paragraph), "deleteParagraph");
                return Resolve(paragraph, type);
            }
            case "setTableCellText":
            {
                var cell = resolver.ResolveCell(RequiredObject(operation, "selector"));
                CheckExpectedText(operation, SelectorResolver.TextValue(cell), "setTableCellText");
                GuardCellStructure(cell);
                return Resolve(cell, type);
            }
            case "insertTableRow":
            {
                var row = resolver.ResolveRow(RequiredObject(operation, "selector"));
                GuardTableStructure(row, deleting: false);
                ValidateInsertedCellCount(operation, row);
                return Resolve(row, type);
            }
            case "deleteTableRow":
            {
                var row = resolver.ResolveRow(RequiredObject(operation, "selector"));
                GuardTableStructure(row, deleting: true);
                return Resolve(row, type);
            }
            case "setCharacterFormatting":
            case "setParagraphFormatting":
                RequireNonEmptyObject(operation, "formatting");
                return Resolve(resolver.ResolveParagraph(RequiredObject(operation, "selector")), type);
            case "setHyperlink": return PlanSetHyperlink(operation, resolver, main);
            case "removeHyperlink": return PlanRemoveHyperlink(operation, resolver);
            case "setCoreProperties":
                RequireNonEmptyObject(operation, "properties");
                return new { type, resolved = true, part = "docProps/core.xml" };
            default: throw new EngineException("UNSUPPORTED_FEATURE", $"Unsupported operation: {type}.");
        }
    }

    private static object Resolve(OpenXmlElement element, string type) => new { type, resolved = true, currentText = SelectorResolver.TextValue(element) };

    private static object PlanReplace(JsonElement operation, SelectorResolver resolver, Body body)
    {
        var find = SelectorResolver.RequiredString(operation, "find"), expected = SelectorResolver.RequiredInt(operation, "expectedCount");
        var paragraphs = ReplacementParagraphs(operation, resolver, body), actual = paragraphs.Sum(paragraph => Count(SelectorResolver.TextValue(paragraph), find));
        if (actual != expected) throw new EngineException("AMBIGUOUS_SELECTOR", "replaceText expectedCount precondition failed.", new { expected, actual });
        return new { type = "replaceText", resolved = true, expectedCount = expected, paragraphCount = paragraphs.Count };
    }

    private static List<Paragraph> ReplacementParagraphs(JsonElement operation, SelectorResolver resolver, Body body)
    {
        if (operation.TryGetProperty("story", out var story) && story.GetString() is not null and not "main") throw new EngineException("UNSUPPORTED_FEATURE", "P1 replaceText supports only the main story.");
        if (operation.TryGetProperty("selector", out var selector) && selector.ValueKind == JsonValueKind.Object) return new List<Paragraph> { resolver.ResolveParagraph(selector) };
        return body.Descendants<Paragraph>().ToList();
    }

    private static object Apply(JsonElement operation, SelectorResolver resolver, Body body, MainDocumentPart main, WordprocessingDocument document)
    {
        var type = SelectorResolver.RequiredString(operation, "type");
        return type switch
        {
            "replaceText" => ReplaceText(operation, resolver, body),
            "insertParagraph" => InsertParagraph(operation, resolver),
            "deleteParagraph" => DeleteParagraph(operation, resolver),
            "setTableCellText" => SetCell(operation, resolver),
            "insertTableRow" => InsertRow(operation, resolver),
            "deleteTableRow" => DeleteRow(operation, resolver),
            "setCharacterFormatting" => SetCharacterFormatting(operation, resolver),
            "setParagraphFormatting" => SetParagraphFormatting(operation, resolver),
            "setHyperlink" => SetHyperlink(operation, resolver, main),
            "removeHyperlink" => RemoveHyperlink(operation, resolver, main),
            "setCoreProperties" => SetCoreProperties(operation, document),
            _ => throw new EngineException("UNSUPPORTED_FEATURE", $"Unsupported operation: {type}."),
        };
    }

    private static object ReplaceText(JsonElement operation, SelectorResolver resolver, Body body)
    {
        var find = SelectorResolver.RequiredString(operation, "find"), replacement = operation.GetProperty("replacement").GetString() ?? "", expected = SelectorResolver.RequiredInt(operation, "expectedCount");
        var paragraphs = ReplacementParagraphs(operation, resolver, body), matches = paragraphs.Sum(paragraph => Count(SelectorResolver.TextValue(paragraph), find));
        if (matches != expected) throw new EngineException("AMBIGUOUS_SELECTOR", "replaceText expectedCount precondition failed.", new { expected, actual = matches });
        foreach (var paragraph in paragraphs) ReplaceAll(paragraph, find, replacement);
        return new { type = "replaceText", replacements = matches };
    }

    private static void ReplaceAll(Paragraph paragraph, string find, string replacement)
    {
        var combined = SelectorResolver.TextValue(paragraph), starts = new List<int>();
        for (var index = 0; (index = combined.IndexOf(find, index, StringComparison.Ordinal)) >= 0; index += find.Length) starts.Add(index);
        for (var index = starts.Count - 1; index >= 0; index--) ReplaceRange(paragraph, starts[index], find.Length, replacement);
    }

    private static void ReplaceRange(Paragraph paragraph, int start, int length, string replacement)
    {
        var texts = paragraph.Descendants<Text>().ToList(), end = start + length, cursor = 0, first = -1, last = -1, firstOffset = 0, lastOffset = 0;
        for (var index = 0; index < texts.Count; index++)
        {
            var next = cursor + texts[index].Text.Length;
            if (first < 0 && start < next) { first = index; firstOffset = start - cursor; }
            if (first >= 0 && end <= next) { last = index; lastOffset = end - cursor; break; }
            cursor = next;
        }
        if (first < 0 || last < 0) throw new EngineException("VALIDATION_FAILED", "Cross-run replacement mapping failed.");
        var prefix = texts[first].Text[..firstOffset], suffix = texts[last].Text[lastOffset..];
        texts[first].Text = prefix + replacement + (first == last ? suffix : "");
        PreserveSpace(texts[first]);
        for (var index = first + 1; index < last; index++) texts[index].Text = "";
        if (last != first) { texts[last].Text = suffix; PreserveSpace(texts[last]); }
    }

    private static void PreserveSpace(Text text) => text.Space = text.Text.StartsWith(' ') || text.Text.EndsWith(' ') ? SpaceProcessingModeValues.Preserve : null;
    private static int Count(string value, string find)
    {
        var count = 0;
        for (var index = 0; (index = value.IndexOf(find, index, StringComparison.Ordinal)) >= 0; index += find.Length) count++;
        return count;
    }

    private static object InsertParagraph(JsonElement operation, SelectorResolver resolver)
    {
        var anchor = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = new Text(operation.GetProperty("text").GetString() ?? "");
        PreserveSpace(text);
        var paragraph = new Paragraph(new Run(text));
        if (operation.TryGetProperty("style", out var style) && !string.IsNullOrWhiteSpace(style.GetString())) paragraph.ParagraphProperties = new ParagraphProperties(new ParagraphStyleId { Val = style.GetString() });
        var position = SelectorResolver.RequiredString(operation, "position");
        if (position == "before") anchor.InsertBeforeSelf(paragraph);
        else if (position == "after") anchor.InsertAfterSelf(paragraph);
        else throw new EngineException("INVALID_ARGUMENT", "position must be before or after.");
        return new { type = "insertParagraph", position, text = SelectorResolver.TextValue(paragraph) };
    }

    private static object DeleteParagraph(JsonElement operation, SelectorResolver resolver)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = SelectorResolver.TextValue(paragraph);
        CheckExpectedText(operation, text, "deleteParagraph");
        paragraph.Remove();
        return new { type = "deleteParagraph", deletedText = text };
    }

    private static object SetCell(JsonElement operation, SelectorResolver resolver)
    {
        var cell = resolver.ResolveCell(RequiredObject(operation, "selector")), before = SelectorResolver.TextValue(cell);
        CheckExpectedText(operation, before, "setTableCellText");
        GuardCellStructure(cell);
        SetCellContent(cell, operation.GetProperty("text").GetString() ?? "");
        return new { type = "setTableCellText", before, after = SelectorResolver.TextValue(cell) };
    }

    private static void GuardCellStructure(TableCell cell)
    {
        if (cell.Descendants<Table>().Any() || cell.Descendants<SdtElement>().Any() || cell.ChildElements.Any(child => child is not TableCellProperties and not Paragraph))
            throw new EngineException("UNSUPPORTED_FEATURE", "P1 setTableCellText refuses nested tables, content controls, or non-paragraph cell structures.");
    }

    private static void SetCellContent(TableCell cell, string value)
    {
        var firstParagraph = cell.Elements<Paragraph>().FirstOrDefault(), paragraphProperties = firstParagraph?.ParagraphProperties?.CloneNode(true) as ParagraphProperties;
        var firstRunProperties = firstParagraph?.Descendants<Run>().FirstOrDefault()?.RunProperties?.CloneNode(true) as RunProperties;
        foreach (var paragraph in cell.Elements<Paragraph>().ToList()) paragraph.Remove();
        var text = new Text(value); PreserveSpace(text);
        var run = new Run(); if (firstRunProperties is not null) run.Append(firstRunProperties); run.Append(text);
        var replacement = new Paragraph(); if (paragraphProperties is not null) replacement.Append(paragraphProperties); replacement.Append(run);
        cell.Append(replacement);
    }

    private static void GuardTableStructure(TableRow row, bool deleting)
    {
        var table = row.Ancestors<Table>().FirstOrDefault() ?? throw new EngineException("INVALID_PACKAGE", "Table row has no containing table.");
        if (table.Descendants<VerticalMerge>().Any() || table.Descendants<GridSpan>().Any(span => (span.Val?.Value ?? 1) > 1))
            throw new EngineException("UNSUPPORTED_FEATURE", "Row insertion/deletion is blocked when the table contains vertical or horizontal merges.");
        if (deleting && table.Elements<TableRow>().Count() <= 1) throw new EngineException("UNSUPPORTED_FEATURE", "Deleting the final row of a table is blocked.");
    }

    private static void ValidateInsertedCellCount(JsonElement operation, TableRow anchor)
    {
        var actual = operation.GetProperty("cells").GetArrayLength(), expected = anchor.Elements<TableCell>().Count();
        if (actual != expected) throw new EngineException("LOSSY_OPERATION", "Inserted row cell count must exactly match the anchor row.", new { expected, actual });
    }

    private static object InsertRow(JsonElement operation, SelectorResolver resolver)
    {
        var anchor = resolver.ResolveRow(RequiredObject(operation, "selector"));
        GuardTableStructure(anchor, deleting: false);
        ValidateInsertedCellCount(operation, anchor);
        var row = (TableRow)anchor.CloneNode(true), values = operation.GetProperty("cells").EnumerateArray().Select(value => value.GetString() ?? "").ToArray(), cells = row.Elements<TableCell>().ToArray();
        for (var index = 0; index < cells.Length; index++) { GuardCellStructure(cells[index]); SetCellContent(cells[index], values[index]); }
        var position = SelectorResolver.RequiredString(operation, "position");
        if (position == "before") anchor.InsertBeforeSelf(row);
        else if (position == "after") anchor.InsertAfterSelf(row);
        else throw new EngineException("INVALID_ARGUMENT", "position must be before or after.");
        return new { type = "insertTableRow", position, cells = cells.Length };
    }

    private static object DeleteRow(JsonElement operation, SelectorResolver resolver)
    {
        var row = resolver.ResolveRow(RequiredObject(operation, "selector"));
        GuardTableStructure(row, deleting: true);
        var text = SelectorResolver.TextValue(row);
        row.Remove();
        return new { type = "deleteTableRow", deletedText = text };
    }

    private static object SetCharacterFormatting(JsonElement operation, SelectorResolver resolver)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), patch = RequireNonEmptyObject(operation, "formatting"), runs = paragraph.Descendants<Run>().ToList();
        if (runs.Count == 0) throw new EngineException("SELECTOR_NOT_FOUND", "Selected paragraph contains no runs to format.");
        foreach (var run in runs)
        {
            var properties = run.RunProperties ?? run.PrependChild(new RunProperties());
            if (patch.TryGetProperty("bold", out var bold)) properties.Bold = bold.GetBoolean() ? new Bold() : null;
            if (patch.TryGetProperty("italic", out var italic)) properties.Italic = italic.GetBoolean() ? new Italic() : null;
            if (patch.TryGetProperty("underline", out var underline)) properties.Underline = underline.GetString() switch { "none" => new Underline { Val = UnderlineValues.None }, "single" => new Underline { Val = UnderlineValues.Single }, "double" => new Underline { Val = UnderlineValues.Double }, _ => throw new EngineException("INVALID_ARGUMENT", "Unsupported underline value.") };
            if (patch.TryGetProperty("fontFamily", out var family)) properties.RunFonts = new RunFonts { Ascii = family.GetString(), HighAnsi = family.GetString(), EastAsia = family.GetString(), ComplexScript = family.GetString() };
            if (patch.TryGetProperty("fontSizePoints", out var size))
            {
                var points = size.GetDouble(); if (!double.IsFinite(points) || points <= 0 || points > 409) throw new EngineException("INVALID_ARGUMENT", "fontSizePoints is outside the supported range.");
                var halfPoints = (points * 2).ToString(System.Globalization.CultureInfo.InvariantCulture); properties.FontSize = new FontSize { Val = halfPoints }; properties.FontSizeComplexScript = new FontSizeComplexScript { Val = halfPoints };
            }
            if (patch.TryGetProperty("color", out var color))
            {
                var value = color.GetString() ?? ""; if (!Regex.IsMatch(value, "^[A-Fa-f0-9]{6}$")) throw new EngineException("INVALID_ARGUMENT", "color must be a six-digit RGB value."); properties.Color = new Color { Val = value.ToUpperInvariant() };
            }
        }
        return new { type = "setCharacterFormatting", runCount = runs.Count };
    }

    private static object SetParagraphFormatting(JsonElement operation, SelectorResolver resolver)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), patch = RequireNonEmptyObject(operation, "formatting"), properties = paragraph.ParagraphProperties ?? paragraph.PrependChild(new ParagraphProperties());
        if (patch.TryGetProperty("style", out var style)) properties.ParagraphStyleId = new ParagraphStyleId { Val = style.GetString() };
        if (patch.TryGetProperty("alignment", out var alignment)) properties.Justification = new Justification { Val = alignment.GetString() switch { "left" => JustificationValues.Left, "center" => JustificationValues.Center, "right" => JustificationValues.Right, "both" => JustificationValues.Both, _ => throw new EngineException("INVALID_ARGUMENT", "Unsupported paragraph alignment.") } };
        if (patch.TryGetProperty("spacingBeforePoints", out _) || patch.TryGetProperty("spacingAfterPoints", out _) || patch.TryGetProperty("lineSpacing", out _))
        {
            var spacing = properties.SpacingBetweenLines ??= new SpacingBetweenLines();
            if (patch.TryGetProperty("spacingBeforePoints", out var before)) spacing.Before = Twips(before.GetDouble());
            if (patch.TryGetProperty("spacingAfterPoints", out var after)) spacing.After = Twips(after.GetDouble());
            if (patch.TryGetProperty("lineSpacing", out var line)) { spacing.Line = Math.Round(line.GetDouble() * 240).ToString(System.Globalization.CultureInfo.InvariantCulture); spacing.LineRule = LineSpacingRuleValues.Auto; }
        }
        if (patch.TryGetProperty("indentLeftPoints", out _) || patch.TryGetProperty("indentRightPoints", out _) || patch.TryGetProperty("firstLineIndentPoints", out _))
        {
            var indentation = properties.Indentation ??= new Indentation();
            if (patch.TryGetProperty("indentLeftPoints", out var left)) indentation.Left = Twips(left.GetDouble());
            if (patch.TryGetProperty("indentRightPoints", out var right)) indentation.Right = Twips(right.GetDouble());
            if (patch.TryGetProperty("firstLineIndentPoints", out var first)) indentation.FirstLine = Twips(first.GetDouble());
        }
        return new { type = "setParagraphFormatting", text = SelectorResolver.TextValue(paragraph) };
    }

    private static string Twips(double points)
    {
        if (!double.IsFinite(points)) throw new EngineException("INVALID_ARGUMENT", "Point value must be finite.");
        return Math.Round(points * 20).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private static Uri HyperlinkUri(JsonElement operation)
    {
        var target = SelectorResolver.RequiredString(operation, "target");
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto")) throw new EngineException("INVALID_ARGUMENT", "P1 hyperlinks support only absolute http, https, or mailto targets.");
        return uri;
    }

    private static object PlanSetHyperlink(JsonElement operation, SelectorResolver resolver, MainDocumentPart main)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = SelectorResolver.RequiredString(operation, "text");
        _ = HyperlinkUri(operation);
        var existing = paragraph.Descendants<Hyperlink>().Where(link => SelectorResolver.TextValue(link) == text).ToList();
        if (existing.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"setHyperlink matched {existing.Count} existing hyperlinks.");
        if (existing.Count == 0)
        {
            var runs = paragraph.Descendants<Run>().Where(run => SelectorResolver.TextValue(run) == text).ToList();
            if (runs.Count == 0) throw new EngineException("SELECTOR_NOT_FOUND", "Hyperlink text was not found as one complete run.");
            if (runs.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"Hyperlink text matched {runs.Count} complete runs.");
        }
        return new { type = "setHyperlink", resolved = true, updated = existing.Count == 1, relationshipPart = RelationshipPart(main.Uri.OriginalString) };
    }

    private static object SetHyperlink(JsonElement operation, SelectorResolver resolver, MainDocumentPart main)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector")), text = SelectorResolver.RequiredString(operation, "text"), uri = HyperlinkUri(operation);
        var existingMatches = paragraph.Descendants<Hyperlink>().Where(link => SelectorResolver.TextValue(link) == text).ToList();
        if (existingMatches.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"setHyperlink matched {existingMatches.Count} existing hyperlinks.");
        Run? selectedRun = null;
        if (existingMatches.Count == 0)
        {
            var runs = paragraph.Descendants<Run>().Where(run => SelectorResolver.TextValue(run) == text).ToList();
            if (runs.Count == 0) throw new EngineException("SELECTOR_NOT_FOUND", "Hyperlink text was not found as one complete run.");
            if (runs.Count > 1) throw new EngineException("AMBIGUOUS_SELECTOR", $"Hyperlink text matched {runs.Count} complete runs.");
            selectedRun = runs[0];
        }
        var relationship = main.AddHyperlinkRelationship(uri, true);
        if (existingMatches.Count == 1)
        {
            var existing = existingMatches[0], oldId = existing.Id?.Value;
            existing.Id = relationship.Id;
            if (operation.TryGetProperty("tooltip", out var tooltip)) existing.Tooltip = tooltip.GetString();
            DeleteUnusedHyperlinkRelationship(main, paragraph, oldId, relationship.Id);
            return new { type = "setHyperlink", updated = true };
        }
        var hyperlink = new Hyperlink { Id = relationship.Id, Tooltip = operation.TryGetProperty("tooltip", out var tip) ? tip.GetString() : null };
        hyperlink.Append(selectedRun!.CloneNode(true));
        selectedRun.InsertAfterSelf(hyperlink);
        selectedRun.Remove();
        return new { type = "setHyperlink", updated = false };
    }

    private static object PlanRemoveHyperlink(JsonElement operation, SelectorResolver resolver)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector"));
        var text = operation.TryGetProperty("text", out var textElement) ? textElement.GetString() : null;
        var matches = paragraph.Descendants<Hyperlink>().Where(link => text is null || SelectorResolver.TextValue(link) == text).ToList();
        if (matches.Count != 1) throw new EngineException(matches.Count == 0 ? "SELECTOR_NOT_FOUND" : "AMBIGUOUS_SELECTOR", $"removeHyperlink matched {matches.Count} hyperlinks.");
        return new { type = "removeHyperlink", resolved = true, text = SelectorResolver.TextValue(matches[0]) };
    }

    private static object RemoveHyperlink(JsonElement operation, SelectorResolver resolver, MainDocumentPart main)
    {
        var paragraph = resolver.ResolveParagraph(RequiredObject(operation, "selector"));
        var text = operation.TryGetProperty("text", out var textElement) ? textElement.GetString() : null;
        var matches = paragraph.Descendants<Hyperlink>().Where(link => text is null || SelectorResolver.TextValue(link) == text).ToList();
        if (matches.Count != 1) throw new EngineException(matches.Count == 0 ? "SELECTOR_NOT_FOUND" : "AMBIGUOUS_SELECTOR", $"removeHyperlink matched {matches.Count} hyperlinks.");
        var link = matches[0], id = link.Id?.Value;
        foreach (var child in link.ChildElements.ToList()) link.InsertBeforeSelf(child.CloneNode(true));
        link.Remove();
        DeleteUnusedHyperlinkRelationship(main, paragraph, id);
        return new { type = "removeHyperlink", text = text ?? SelectorResolver.TextValue(link) };
    }

    private static void DeleteUnusedHyperlinkRelationship(MainDocumentPart main, Paragraph paragraph, string? relationshipId, string? replacementId = null)
    {
        if (string.IsNullOrWhiteSpace(relationshipId) || relationshipId == replacementId) return;
        if (paragraph.Ancestors<Document>().FirstOrDefault()?.Descendants<Hyperlink>().Any(link => link.Id?.Value == relationshipId) == true) return;
        try { main.DeleteReferenceRelationship(relationshipId); } catch (KeyNotFoundException) { }
    }

    private static object SetCoreProperties(JsonElement operation, WordprocessingDocument document)
    {
        var properties = RequireNonEmptyObject(operation, "properties"), package = document.PackageProperties;
        if (properties.TryGetProperty("title", out var title)) package.Title = title.GetString();
        if (properties.TryGetProperty("subject", out var subject)) package.Subject = subject.GetString();
        if (properties.TryGetProperty("creator", out var creator)) package.Creator = creator.GetString();
        if (properties.TryGetProperty("keywords", out var keywords)) package.Keywords = keywords.GetString();
        if (properties.TryGetProperty("description", out var description)) package.Description = description.GetString();
        if (properties.TryGetProperty("category", out var category)) package.Category = category.GetString();
        return new { type = "setCoreProperties", updated = properties.EnumerateObject().Select(property => property.Name).ToArray() };
    }

    private static void CheckExpectedText(JsonElement operation, string actual, string operationName)
    {
        if (operation.TryGetProperty("expectedText", out var expected) && expected.GetString() != actual) throw new EngineException("SOURCE_CHANGED", $"{operationName} expectedText precondition failed.", new { expected = expected.GetString(), actual });
    }

    private static JsonElement RequiredObject(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Object ? property : throw new EngineException("INVALID_ARGUMENT", $"Missing object property {name}.");
    private static JsonElement RequireNonEmptyObject(JsonElement value, string name)
    {
        var property = RequiredObject(value, name);
        if (!property.EnumerateObject().Any()) throw new EngineException("INVALID_ARGUMENT", $"{name} must contain at least one property.");
        return property;
    }

    private static string RelationshipPart(string mainUri)
    {
        var main = mainUri.TrimStart('/'), slash = main.LastIndexOf('/');
        var directory = slash >= 0 ? main[..(slash + 1)] : "", file = main[(slash + 1)..];
        return $"{directory}_rels/{file}.rels";
    }

    private static string[] ExpectedParts(JsonElement operations, string mainUri)
    {
        var main = mainUri.TrimStart('/'), parts = new HashSet<string>();
        foreach (var operation in Enumerate(operations))
        {
            var type = SelectorResolver.RequiredString(operation, "type");
            if (type == "setCoreProperties") parts.Add("docProps/core.xml");
            else
            {
                parts.Add(main);
                if (type is "setHyperlink" or "removeHyperlink") parts.Add(RelationshipPart(mainUri));
            }
        }
        return parts.OrderBy(value => value).ToArray();
    }
}
