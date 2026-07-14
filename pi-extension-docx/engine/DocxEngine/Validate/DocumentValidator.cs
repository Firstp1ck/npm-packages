using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

namespace DocxEngine.Validate;

public static class DocumentValidator
{
    public static object Validate(string sourcePath)
    {
        using var document = WordprocessingDocument.Open(sourcePath, false);
        var validator = new OpenXmlValidator();
        var errors = validator.Validate(document).Take(200).Select(error => new
        {
            description = error.Description,
            part = error.Part?.Uri.ToString(),
            path = error.Path?.XPath,
            errorType = error.ErrorType.ToString(),
        }).ToArray();
        return new { valid = errors.Length == 0, errorCount = errors.Length, errors, reopen = true };
    }
}
