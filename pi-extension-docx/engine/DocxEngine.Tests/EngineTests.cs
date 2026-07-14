using System.Text.Json;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxEngine.Edit;

namespace DocxEngine.Tests;

public sealed class EngineTests
{
    private static string Fixture()
    {
        var path = Path.Combine(Path.GetTempPath(), $"docx-engine-{Guid.NewGuid():N}.docx");
        using var document = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var main = document.AddMainDocumentPart(); main.Document = new Document(new Body(new Paragraph(new Run(new Text("Hello world"))))); main.Document.Save();
        return path;
    }

    [Fact]
    public void CrossRunReplacementPreservesUnrelatedText()
    {
        var source = Fixture(); var output = Path.ChangeExtension(source, ".edited.docx");
        try
        {
            using (var doc = WordprocessingDocument.Open(source, true)) { var paragraph = doc.MainDocumentPart!.Document.Body!.GetFirstChild<Paragraph>()!; paragraph.RemoveAllChildren<Run>(); paragraph.Append(new Run(new Text("Hello ")), new Run(new Text("world"))); doc.MainDocumentPart.Document.Save(); }
            using var json = JsonDocument.Parse("[{\"type\":\"replaceText\",\"find\":\"lo wo\",\"replacement\":\"LO WO\",\"expectedCount\":1}]");
            DocumentEditor.Edit(source, output, json.RootElement);
            using var edited = WordprocessingDocument.Open(output, false); Assert.Equal("HelLO WOrld", edited.MainDocumentPart!.Document.Body!.InnerText);
        }
        finally { File.Delete(source); File.Delete(output); }
    }
}
