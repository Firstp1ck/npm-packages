# Synthetic DOCX corpus

All fixtures in this test corpus are generated from source in `../fixture-builder.mjs`. The text and OOXML were authored for this repository and are released under the repository MIT license; no third-party Word documents, fonts, images, macros, signatures, or proprietary templates are redistributed.

The generated matrix covers basic and feature-rich DOCX packages, styles/themes/numbering, nested and merged tables, sections/columns, headers/footers, footnotes/endnotes, comments, revisions, content controls, fields, bookmarks, hyperlinks, image/chart/SmartArt relationships, text boxes, custom XML, altChunk, embeddings, external relationships, signatures, macro-enabled content types, encrypted ZIP members, DTDs, malformed packages, and bounded-intake limits.

The fixtures are intentionally synthetic. Passing them does not replace controlled Microsoft Word and LibreOffice interoperability gates.
