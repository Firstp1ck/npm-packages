import fs from "node:fs/promises";
import { zipSync } from "fflate";

const enc = new TextEncoder();
export function fixtureBytes(options = {}) {
  const macro = Boolean(options.macro), signed = Boolean(options.signed), external = Boolean(options.external), dtd = Boolean(options.dtd);
  const mainType = macro ? "application/vnd.ms-word.document.macroEnabled.main+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const overrides = [`<Override PartName="/word/document.xml" ContentType="${mainType}"/>`, `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`, macro ? `<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>` : "", signed ? `<Override PartName="/_xmlsignatures/sig1.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/>` : ""].join("");
  const documentRels = [`<Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/sentinel" TargetMode="External"/>`, macro ? `<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>` : ""].filter((value, index) => (index !== 0 || external)).join("");
  const files = {
    "[Content_Types].xml": enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`),
    "_rels/.rels": enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    "word/document.xml": enc.encode(`${dtd ? `<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///etc/passwd">]>` : `<?xml version="1.0" encoding="UTF-8"?>`}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="A1B2C3D4"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`),
    "word/_rels/document.xml.rels": enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRels}</Relationships>`),
    "docProps/core.xml": enc.encode(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:creator>Pi tests</dc:creator></cp:coreProperties>`),
  };
  if (macro) files["word/vbaProject.bin"] = Uint8Array.from([0, 1, 2, 3]);
  if (signed) files["_xmlsignatures/sig1.xml"] = enc.encode("<Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"/>");
  return zipSync(files, { level: 6 });
}
export async function writeFixture(filePath, options = {}) { await fs.writeFile(filePath, fixtureBytes(options)); return filePath; }
export function encryptedMemberFixture() { const bytes = fixtureBytes(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let i = 0; i <= bytes.length - 4; i++) { const signature = view.getUint32(i, true); if (signature === 0x04034b50) view.setUint16(i + 6, view.getUint16(i + 6, true) | 1, true); if (signature === 0x02014b50) view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true); } return bytes; }
