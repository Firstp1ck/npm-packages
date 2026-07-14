import fs from "node:fs/promises";
import { unzipSync, zipSync } from "fflate";

const enc = new TextEncoder();
const dec = new TextDecoder();
const args = process.argv.slice(2);
const inputPath = args[0];
let outputPath = inputPath;
let connectionUrl;
for (let index = 1; index < args.length; index++) {
  if (args[index] === "--connection-url") connectionUrl = args[++index];
  else outputPath = args[index];
}
if (!inputPath) throw new Error("Usage: node inject-custom-ui.mjs input.xlsx [output.xlsx] [--connection-url URL]");
const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\"/g, "&quot;");

const entries = unzipSync(await fs.readFile(inputPath));
const contentTypesPath = "[Content_Types].xml";
const rootRelsPath = "_rels/.rels";
let contentTypes = dec.decode(entries[contentTypesPath]);
let rootRelationships = dec.decode(entries[rootRelsPath]);
if (!contentTypes.includes('PartName="/customUI/customUI.xml"')) {
  contentTypes = contentTypes.replace(/<\/Types>\s*$/, '<Override PartName="/customUI/customUI.xml" ContentType="application/vnd.ms-office.customUI+xml"/></Types>');
}
if (!rootRelationships.includes("/ui/extensibility")) {
  const ids = [...rootRelationships.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  const nextId = Math.max(0, ...ids) + 1;
  rootRelationships = rootRelationships.replace(/<\/Relationships>\s*$/, `<Relationship Id="rId${nextId}" Type="http://schemas.microsoft.com/office/2006/relationships/ui/extensibility" Target="customUI/customUI.xml"/></Relationships>`);
}
if (connectionUrl) {
  if (!contentTypes.includes('PartName="/xl/connections.xml"')) {
    contentTypes = contentTypes.replace(/<\/Types>\s*$/, '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/></Types>');
  }
  const workbookRelsPath = "xl/_rels/workbook.xml.rels";
  let workbookRelationships = dec.decode(entries[workbookRelsPath]);
  if (!workbookRelationships.includes('/relationships/connections"')) {
    const ids = [...workbookRelationships.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
    const nextId = Math.max(0, ...ids) + 1;
    workbookRelationships = workbookRelationships.replace(/<\/Relationships>\s*$/, `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/></Relationships>`);
    entries[workbookRelsPath] = enc.encode(workbookRelationships);
  }
  entries["xl/connections.xml"] = enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="PiNoRefreshConnection" description="Local HTTP sentinel that must never refresh automatically" type="4" refreshedVersion="8" background="0" refreshOnLoad="0" saveData="1"><webPr sourceData="1" parsePre="1" consecutive="1" url="${escapeXml(connectionUrl)}" htmlTables="1"/></connection></connections>`);
}
entries[contentTypesPath] = enc.encode(contentTypes);
entries[rootRelsPath] = enc.encode(rootRelationships);
entries["customUI/customUI.xml"] = enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><customUI xmlns="http://schemas.microsoft.com/office/2006/01/customui"><ribbon><tabs><tab id="PiCorpusTab" label="Pi Corpus"/></tabs></ribbon></customUI>');
await fs.writeFile(outputPath, zipSync(entries, { level: 6 }));
console.log(JSON.stringify({ ok: true, inputPath, outputPath, customUiPart: "customUI/customUI.xml", connectionPart: connectionUrl ? "xl/connections.xml" : undefined, callbacks: false }));
