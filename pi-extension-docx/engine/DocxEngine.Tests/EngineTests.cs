using System.Text.Json;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxEngine.Edit;
using DocxEngine.Protocol;

namespace DocxEngine.Tests;

public sealed class EngineTests
{
    private static string Fixture(params string[] paragraphs)
    {
        var path = Path.Combine(Path.GetTempPath(), $"docx-engine-{Guid.NewGuid():N}.docx");
        using var document = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var main = document.AddMainDocumentPart();
        main.Document = new Document(new Body(paragraphs.Select(value => new Paragraph(new Run(new Text(value))))));
        main.Document.Save();
        return path;
    }

    [Fact]
    public void CrossRunReplacementPreservesUnrelatedText()
    {
        var source = Fixture("Hello world"), output = Path.ChangeExtension(source, ".edited.docx");
        try
        {
            using (var document = WordprocessingDocument.Open(source, true))
            {
                var paragraph = document.MainDocumentPart!.Document.Body!.GetFirstChild<Paragraph>()!;
                paragraph.RemoveAllChildren<Run>();
                paragraph.Append(new Run(new Text("Hello ")), new Run(new Text("world")));
                document.MainDocumentPart.Document.Save();
            }
            using var json = JsonDocument.Parse("[{\"type\":\"replaceText\",\"find\":\"lo wo\",\"replacement\":\"LO WO\",\"expectedCount\":1}]");
            DocumentEditor.Edit(source, output, json.RootElement);
            using var edited = WordprocessingDocument.Open(output, false);
            Assert.Equal("HelLO WOrld", edited.MainDocumentPart!.Document.Body!.InnerText);
        }
        finally { File.Delete(source); File.Delete(output); }
    }

    [Fact]
    public void ReplacementDoesNotRematchReplacementText()
    {
        var source = Fixture("a"), output = Path.ChangeExtension(source, ".edited.docx");
        try
        {
            using var json = JsonDocument.Parse("[{\"type\":\"replaceText\",\"find\":\"a\",\"replacement\":\"aa\",\"expectedCount\":1}]");
            DocumentEditor.Edit(source, output, json.RootElement);
            using var edited = WordprocessingDocument.Open(output, false);
            Assert.Equal("aa", edited.MainDocumentPart!.Document.Body!.InnerText);
        }
        finally { File.Delete(source); File.Delete(output); }
    }

    [Fact]
    public void ReplacementSelectorScopesTheMutation()
    {
        var source = Fixture("same", "same"), output = Path.ChangeExtension(source, ".edited.docx");
        try
        {
            using var json = JsonDocument.Parse("[{\"type\":\"replaceText\",\"find\":\"same\",\"replacement\":\"changed\",\"expectedCount\":1,\"selector\":{\"kind\":\"text\",\"text\":\"same\",\"expectedCount\":2,\"occurrence\":1}}]");
            DocumentEditor.Edit(source, output, json.RootElement);
            using var edited = WordprocessingDocument.Open(output, false);
            Assert.Equal(new[] { "changed", "same" }, edited.MainDocumentPart!.Document.Body!.Elements<Paragraph>().Select(paragraph => paragraph.InnerText));
        }
        finally { File.Delete(source); File.Delete(output); }
    }

    [Fact]
    public void DryRunChecksExpectedTextPreconditions()
    {
        var source = Fixture("actual");
        try
        {
            using var json = JsonDocument.Parse("[{\"type\":\"deleteParagraph\",\"selector\":{\"kind\":\"text\",\"text\":\"actual\",\"expectedCount\":1},\"expectedText\":\"stale\"}]");
            var error = Assert.Throws<EngineException>(() => DocumentEditor.Plan(source, json.RootElement));
            Assert.Equal("SOURCE_CHANGED", error.Code);
        }
        finally { File.Delete(source); }
    }
}
