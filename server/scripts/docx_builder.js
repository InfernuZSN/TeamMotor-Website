const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>TeamMotor - Comprehensive Development History, Bug Remediation &amp; Testing Report</dc:title>
  <dc:subject>Detailed Engineering Report on CHANGES.md and logic.test.js Regression Suite</dc:subject>
  <dc:creator>TeamMotor Engineering</dc:creator>
  <cp:keywords>TeamMotor, Audit, Bugs, Testing, Architecture, Node.js, Express, MongoDB</cp:keywords>
  <cp:lastModifiedBy>TeamMotor Engineering</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-11-21T01:30:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-21T01:30:00Z</dcterms:modified>
</cp:coreProperties>`;

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company>TeamMotor</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Segoe UI"/>
        <w:sz w:val="21"/>
        <w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="140" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="360" w:after="100"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Segoe UI Semibold" w:hAnsi="Segoe UI Semibold"/>
      <w:b/>
      <w:sz w:val="46"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="280"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/>
      <w:sz w:val="24"/>
      <w:color w:val="DC2626"/>
      <w:b/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="400" w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Segoe UI Semibold" w:hAnsi="Segoe UI Semibold"/>
      <w:b/>
      <w:sz w:val="32"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="280" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Segoe UI Semibold" w:hAnsi="Segoe UI Semibold"/>
      <w:b/>
      <w:sz w:val="26"/>
      <w:color w:val="1E40AF"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="200" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Segoe UI Semibold" w:hAnsi="Segoe UI Semibold"/>
      <w:b/>
      <w:sz w:val="22"/>
      <w:color w:val="334155"/>
    </w:rPr>
  </w:style>
</w:styles>`;

function p(text, opts = {}) {
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const before = opts.before !== undefined ? `w:before="${opts.before}"` : '';
  const after = opts.after !== undefined ? `w:after="${opts.after}"` : 'w:after="140"';
  const spacing = (before || after) ? `<w:spacing ${before} ${after} w:line="276" w:lineRule="auto"/>` : '';
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '';
  const bullet = opts.bullet ? `<w:r><w:rPr><w:color w:val="DC2626"/><w:b/></w:rPr><w:t xml:space="preserve">▪  </w:t></w:r>` : '';
  const indent = opts.bullet ? `<w:ind w:left="360" w:hanging="240"/>` : (opts.indent ? `<w:ind w:left="${opts.indent}"/>` : '');

  const runs = Array.isArray(text) ? text : [{ text: text, ...opts }];

  const runXml = runs.map(r => {
    const bold = r.bold ? '<w:b/>' : '';
    const italic = r.italic ? '<w:i/>' : '';
    const sz = r.sz ? `<w:sz w:val="${r.sz}"/>` : '';
    const color = r.color ? `<w:color w:val="${r.color}"/>` : '';
    const font = r.font ? `<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/>` : '';
    return `<w:r><w:rPr>${font}${bold}${italic}${sz}${color}</w:rPr><w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
  }).join('');

  return `<w:p><w:pPr>${style}${align}${spacing}${indent}</w:pPr>${bullet}${runXml}</w:p>`;
}

function h1(title) {
  return p(title, { style: 'Heading1', before: 360, after: 140, bold: true, sz: 32, color: '0F172A' });
}

function h2(title) {
  return p(title, { style: 'Heading2', before: 260, after: 100, bold: true, sz: 26, color: '1E40AF' });
}

function h3(title) {
  return p(title, { style: 'Heading3', before: 180, after: 60, bold: true, sz: 22, color: '334155' });
}

function callout(title, body, tone = 'ok') {
  let borderCol = '16A34A', bgCol = 'F0FDF4', textCol = '166534';
  if (tone === 'info') { borderCol = '2563EB'; bgCol = 'EFF6FF'; textCol = '1E40AF'; }
  if (tone === 'warn') { borderCol = 'CA8A04'; bgCol = 'FEFCE8'; textCol = '854D0E'; }
  if (tone === 'danger') { borderCol = 'DC2626'; bgCol = 'FEF2F2'; textCol = '991B1B'; }

  return `
    <w:p>
      <w:pPr>
        <w:pBdr>
          <w:left w:val="single" w:sz="24" w:space="12" w:color="${borderCol}"/>
          <w:top w:val="single" w:sz="4" w:space="6" w:color="${borderCol}"/>
          <w:right w:val="single" w:sz="4" w:space="6" w:color="${borderCol}"/>
          <w:bottom w:val="single" w:sz="4" w:space="6" w:color="${borderCol}"/>
        </w:pBdr>
        <w:shd w:val="clear" w:color="auto" w:fill="${bgCol}"/>
        <w:spacing w:before="140" w:after="40"/>
        <w:ind w:left="240" w:right="240"/>
      </w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="${textCol}"/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pBdr>
          <w:left w:val="single" w:sz="24" w:space="12" w:color="${borderCol}"/>
          <w:right w:val="single" w:sz="4" w:space="6" w:color="${borderCol}"/>
          <w:bottom w:val="single" w:sz="4" w:space="6" w:color="${borderCol}"/>
        </w:pBdr>
        <w:shd w:val="clear" w:color="auto" w:fill="${bgCol}"/>
        <w:spacing w:before="0" w:after="140"/>
        <w:ind w:left="240" w:right="240"/>
      </w:pPr>
      <w:r><w:rPr><w:sz w:val="20"/><w:color w:val="334155"/></w:rPr><w:t xml:space="preserve">${escapeXml(body)}</w:t></w:r>
    </w:p>`;
}

function table(headers, rows, colWidths = []) {
  const totalWidth = 9360;
  const colCount = headers.length;
  const defaultW = Math.floor(totalWidth / colCount);
  const widths = colWidths.length === colCount ? colWidths : Array(colCount).fill(defaultW);

  const tblGrid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('');

  const headerCells = headers.map((h, i) => {
    return `<w:tc>
      <w:tcPr>
        <w:tcW w:w="${widths[i]}" w:type="dxa"/>
        <w:shd w:val="clear" w:color="auto" w:fill="0F172A"/>
        <w:tcMar>
          <w:top w:w="120" w:type="dxa"/>
          <w:bottom w:w="120" w:type="dxa"/>
          <w:left w:w="140" w:type="dxa"/>
          <w:right w:w="140" w:type="dxa"/>
        </w:tcMar>
      </w:tcPr>
      <w:p>
        <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
        <w:r><w:rPr><w:b/><w:sz w:val="19"/><w:color w:val="FFFFFF"/><w:rFonts w:ascii="Segoe UI Semibold" w:hAnsi="Segoe UI Semibold"/></w:rPr><w:t xml:space="preserve">${escapeXml(h)}</w:t></w:r>
      </w:p>
    </w:tc>`;
  }).join('');

  const rowsXml = rows.map((r, rIdx) => {
    const bg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
    const cells = r.map((c, cIdx) => {
      const isBold = cIdx === 0;
      return `<w:tc>
        <w:tcPr>
          <w:tcW w:w="${widths[cIdx]}" w:type="dxa"/>
          <w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>
          <w:tcMar>
            <w:top w:w="100" w:type="dxa"/>
            <w:bottom w:w="100" w:type="dxa"/>
            <w:left w:w="140" w:type="dxa"/>
            <w:right w:w="140" w:type="dxa"/>
          </w:tcMar>
        </w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr>${isBold ? '<w:b/>' : ''}<w:sz w:val="19"/><w:color w:val="1E293B"/></w:rPr><w:t xml:space="preserve">${escapeXml(c)}</w:t></w:r>
        </w:p>
      </w:tc>`;
    }).join('');

    return `<w:tr>
      <w:trPr><w:cantSplit/></w:trPr>
      ${cells}
    </w:tr>`;
  }).join('');

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${totalWidth}" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:left w:val="none"/>
        <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:right w:val="none"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
        <w:insideV w:val="none"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="80" w:type="dxa"/>
        <w:bottom w:w="80" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
        <w:right w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>${tblGrid}</w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${headerCells}</w:tr>
    ${rowsXml}
  </w:tbl><w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`;
}

module.exports = {
  contentTypesXml,
  relsXml,
  documentRelsXml,
  coreXml,
  appXml,
  stylesXml,
  p,
  h1,
  h2,
  h3,
  callout,
  table,
  escapeXml
};
