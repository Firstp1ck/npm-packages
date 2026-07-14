import fs from "node:fs/promises";
import { zipSync } from "fflate";

const enc = new TextEncoder();
const xml = (value) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);

export function workbookFixtureBytes(options = {}) {
  const macro = options.macro === true;
  const vbaPart = options.vbaPart ?? "xl/vbaProject.bin";
  const workbookContentType = macro
    ? "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${workbookContentType}"/>`,
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
  ];
  if (macro) overrides.push(`<Override PartName="/${vbaPart}" ContentType="application/vnd.ms-office.vbaProject"/>`);
  if (options.theme) overrides.push(`<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`);

  const workbookRelationships = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${options.relationshipTraversal ? "../../evil.xml" : "worksheets/sheet1.xml"}"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ];
  if (macro) workbookRelationships.push(`<Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="${vbaPart.replace(/^xl\//, "")}"/>`);
  if (options.theme) workbookRelationships.push(`<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`);

  const sheetPrefix = options.dtdSheet ? `<!DOCTYPE worksheet [<!ENTITY boom "unsafe">]>` : "";
  const sheetText = options.dtdSheet ? "&boom;" : "Hello";
  const formulaCell = options.complexFormula
    ? `<c r="C1"><f t="array" ref="C1:C2">SUM(B1:B2)</f><v>50</v></c>`
    : `<c r="C1"><f>SUM(B1,8)</f><v>50</v></c>`;
  const entries = {
    "[Content_Types].xml": xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="Answer">Sheet1!$B$1</definedName></definedNames><calcPr calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships.join("")}</Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`${sheetPrefix}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${sheetText}</t></is></c><c r="B1"><v>42</v></c>${formulaCell}</row><row r="2" ht="20" customHeight="1" hidden="1"><c r="A2" s="1" t="inlineStr"><is><t>Styled</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells><conditionalFormatting sqref="B1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>40</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="whole" sqref="B3" operator="between"><formula1>1</formula1><formula2>10</formula2></dataValidation></dataValidations></worksheet>`),
    "xl/styles.xml": xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF006100"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><font><color rgb="FF9C0006"/></font></dxf></dxfs></styleSheet>`),
  };
  if (macro) entries[vbaPart] = options.vbaBytes ?? Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x50, 0x49, 0x2d, 0x56, 0x42, 0x41]);
  if (options.theme) entries["xl/theme/theme1.xml"] = xml(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements><a:clrScheme name="Fixture"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Fixture"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name="Fixture"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
  return zipSync(entries, { level: 6 });
}

export async function writeWorkbookFixture(filePath, options = {}) {
  await fs.writeFile(filePath, workbookFixtureBytes(options));
  return filePath;
}
