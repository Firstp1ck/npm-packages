using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace DocxEngine.Inspect;

public static class DocumentInspector
{
    public static object Inspect(string sourcePath)
    {
        using var document = WordprocessingDocument.Open(sourcePath, false);
        var main = document.MainDocumentPart ?? throw new InvalidDataException("MainDocumentPart is missing.");
        var body = main.Document.Body ?? throw new InvalidDataException("Document body is missing.");
        return new
        {
            paragraphs = body.Descendants<Paragraph>().Count(),
            runs = body.Descendants<Run>().Count(),
            tables = body.Descendants<Table>().Count(),
            hyperlinks = body.Descendants<Hyperlink>().Count(),
            headers = main.HeaderParts.Count(),
            footers = main.FooterParts.Count(),
            hasFootnotes = main.FootnotesPart is not null,
            hasEndnotes = main.EndnotesPart is not null,
            hasComments = main.WordprocessingCommentsPart is not null,
            mainContentType = main.ContentType,
        };
    }
}
