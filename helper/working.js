'use strict';

/**
 * reportDocxBuilder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade HTML → DOCX converter for CKEditor / Jodit rich-text content.
 * Designed for diagnostic patient reports with a clean, professional layout.
 *
 * Pipeline: Raw HTML → normalise → AST → docx elements
 * Page:     A4, 0.4" side margins → 7.72" (11088 DXA) usable content width
 * Tables:   Zero borders, content-proportional columns, shaded headers, alt rows
 * ─────────────────────────────────────────────────────────────────────────────
 */

const docx = require('docx');
const {
  Document, Packer,
  Paragraph, TextRun, Table, TableCell, TableRow,
  WidthType, AlignmentType, BorderStyle, HeadingLevel,
  VerticalAlign, UnderlineType, ShadingType,
  LevelFormat, convertInchesToTwip,
  // ─── ADDED: HeightRule was used but not imported ─────────────────────────
  HeightRule,
} = docx;

// ═════════════════════════════════════════════════════════════════════════════
// PAGE & LAYOUT CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const PAGE = {
  WIDTH:          11906,  // A4 width  (8.27")
  HEIGHT:         16838,  // A4 height (11.69")
  MARGIN_TOP:     convertInchesToTwip(1.5),
  MARGIN_BOTTOM:  convertInchesToTwip(0.2),
  MARGIN_SIDE:    convertInchesToTwip(0.2),
};
PAGE.CONTENT_W = PAGE.WIDTH - (PAGE.MARGIN_SIDE * 2);

// ═════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═════════════════════════════════════════════════════════════════════════════

const FONT = { BODY: 'Calibri', MONO: 'Courier New' };

const PT = {
  H1: 32, H2: 28, H3: 26, H4: 24, H5: 22, H6: 20,
  BODY: 20,       // 10pt
  SMALL: 18,      // 9pt
  LABEL: 17,      // 8.5pt
  SIG_NAME: 24,   // 12pt
  SIG_DEG: 19,    // 9.5pt
  SIG_ROLE: 18,   // 9pt
};

const C = {
  NAVY:       '1B3A6B',
  NAVY_LIGHT: '2D5FA3',
  BODY:       '1A1A1A',
  MUTED:      '52637A',
  SUBTLE:     '8896A4',
  RULE:       'D0D9E8',
  TH_BG:      'EDF2FA',
  TD_ALT:     'FFFFFF',
  WHITE:      'FFFFFF',
};

// ═════════════════════════════════════════════════════════════════════════════
// BORDER PRESETS
// ═════════════════════════════════════════════════════════════════════════════

const BORDER_NONE = {
  top:    { style: BorderStyle.NONE, size: 0, color: C.WHITE },
  bottom: { style: BorderStyle.NONE, size: 0, color: C.WHITE },
  left:   { style: BorderStyle.NONE, size: 0, color: C.WHITE },
  right:  { style: BorderStyle.NONE, size: 0, color: C.WHITE },
};

const BORDER_BOTTOM_RULE = {
  top:    { style: BorderStyle.NONE, size: 0, color: C.WHITE },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: C.RULE },
  left:   { style: BorderStyle.NONE, size: 0, color: C.WHITE },
  right:  { style: BorderStyle.NONE, size: 0, color: C.WHITE },
};

// ═════════════════════════════════════════════════════════════════════════════
// NUMBERING CONFIG
// ═════════════════════════════════════════════════════════════════════════════

const NR = {
  UL0: 'ul-0', UL1: 'ul-1', UL2: 'ul-2',
  OL0: 'ol-0', OL1: 'ol-1', OL2: 'ol-2',
};

const buildNumberingConfig = () => [
  { reference: NR.UL0, levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 320 } } } }] },
  { reference: NR.UL1, levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 960, hanging: 320 } } } }] },
  { reference: NR.UL2, levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u25AA', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1280, hanging: 320 } } } }] },
  { reference: NR.OL0, levels: [{ level: 0, format: LevelFormat.DECIMAL,      text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 320 } } } }] },
  { reference: NR.OL1, levels: [{ level: 0, format: LevelFormat.LOWER_LETTER, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 960, hanging: 320 } } } }] },
  { reference: NR.OL2, levels: [{ level: 0, format: LevelFormat.LOWER_ROMAN,  text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1280, hanging: 320 } } } }] },
];

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════════════════════

const fmt        = (v) => (v != null && v !== '') ? String(v) : '—';
const safeNames   = (n) => String(n || 'Unknown').replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim();
const toTitle    = (s) => s && s !== '—' ? s.toLowerCase().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ') : s;
const fmtDate    = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return String(v); }
};

// ═════════════════════════════════════════════════════════════════════════════
// INLINE HTML → TextRun PARSER
// ═════════════════════════════════════════════════════════════════════════════

function parseInlineToRuns(html, base = {}) {
  if (!html) return [new TextRun({ text: '', font: FONT.BODY, size: PT.BODY, ...base })];

  const decoded = html
    .replace(/&nbsp;/g,  ' ')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  const tokens = decoded.split(/(<[^>]+>)/gi);
  const runs = [];

  let bold = false, italic = false, underline = false;
  let strike = false, sup = false, sub = false;
  let color = base.color || null;
  let size  = base.size  || PT.BODY;
  const colorStack = [], sizeStack = [];

  const makeRun = (text) => {
    const cfg = { text, font: base.font || FONT.BODY, size, ...base };
    if (color)     cfg.color     = color;
    if (bold)      cfg.bold      = true;
    if (italic)    cfg.italics   = true;
    if (underline) cfg.underline = { type: UnderlineType.SINGLE };
    if (strike)    cfg.strike    = true;
    if (sup)       cfg.superScript = true;
    if (sub)       cfg.subScript   = true;
    return new TextRun(cfg);
  };

  for (const tok of tokens) {
    if (!tok) continue;
    if (tok.startsWith('<')) {
      const t = tok.toLowerCase().trim();
      if (t === '<strong>' || t === '<b>')                        { bold = true;      continue; }
      if (t === '</strong>' || t === '</b>')                      { bold = false;     continue; }
      if (t === '<em>' || t === '<i>')                            { italic = true;    continue; }
      if (t === '</em>' || t === '</i>')                          { italic = false;   continue; }
      if (t === '<u>')                                            { underline = true; continue; }
      if (t === '</u>')                                           { underline = false;continue; }
      if (t==='<s>'||t==='<strike>'||t==='<del>')                { strike = true;    continue; }
      if (t==='</s>'||t==='</strike>'||t==='</del>')             { strike = false;   continue; }
      if (t === '<sup>')  { sup = true;  continue; }  if (t === '</sup>') { sup = false;  continue; }
      if (t === '<sub>')  { sub = true;  continue; }  if (t === '</sub>') { sub = false;  continue; }
      if (/^<<br[\s/]*>$/i.test(tok)) { runs.push(new TextRun({ break: 1 })); continue; }
      if (/^<<span/i.test(tok)) {
        colorStack.push(color); sizeStack.push(size);
        const cm = tok.match(/color\s*:\s*#?([0-9a-fA-F]{3,6})/);
        const sm = tok.match(/font-size\s*:\s*([\d.]+)pt/);
        if (cm) color = cm[1].padStart(6, '0');
        if (sm) size  = Math.round(parseFloat(sm[1]) * 2);
        continue;
      }
      if (t === '</span>') {
        color = colorStack.length ? colorStack.pop() : (base.color || null);
        size  = sizeStack.length  ? sizeStack.pop()  : (base.size  || PT.BODY);
        continue;
      }
      continue;
    }
    const lines = tok.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) runs.push(makeRun(lines[i]));
      if (i < lines.length - 1) runs.push(new TextRun({ break: 1 }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '', font: FONT.BODY, size: PT.BODY, ...base })];
}

// ═════════════════════════════════════════════════════════════════════════════
// HTML NORMALISER
// ═════════════════════════════════════════════════════════════════════════════

function normaliseHtml(html) {
  if (!html) return '';
  return html
    .replace(/&nbsp;/g,         ' ')
    .replace(/<<br\s*\/?>/gi,    '<br/>')
    .replace(/[\u200B\u00AD]/g, '')
    .replace(/<<span[^>]*>(\s*)<<\/span>/gi, '$1');
}

// ═════════════════════════════════════════════════════════════════════════════
// HTML → AST PARSER
// ═════════════════════════════════════════════════════════════════════════════

const VOID_TAGS  = new Set(['br','hr','img','input','meta','link','col']);
const BLOCK_TAGS = new Set(['p','div','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','blockquote','pre','figure','section','article','hr']);

function parseAttrs(str) {
  const a = {}, re = /([a-zA-Z:_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? true;
  return a;
}

function parseHtmlToAst(html) {
  const TAG_RE = /(<\/?\s*[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>|<!--[\s\S]*?-->)/g;

  function parse(cursor, stopAt = []) {
    const nodes = [];
    while (cursor.pos < html.length) {
      TAG_RE.lastIndex = cursor.pos;
      const m = TAG_RE.exec(html);
      const textEnd = m ? m.index : html.length;
      if (cursor.pos < textEnd) {
        const t = html.slice(cursor.pos, textEnd);
        if (t) nodes.push({ type: 'text', text: t });
        cursor.pos = textEnd;
      }
      if (!m) break;
      cursor.pos = m.index + m[0].length;
      const raw = m[0];
      if (raw.startsWith('<!--')) continue;
      const closing = raw[1] === '/';
      const inner   = closing ? raw.slice(2, -1).trim() : raw.slice(1, -1).trim();
      const sp      = inner.search(/\s/);
      const tag     = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
      const attrStr = sp === -1 ? '' : inner.slice(sp);
      if (closing) {
        if (stopAt.includes(tag)) { cursor.pos = m.index; break; }
        continue;
      }
      const attrs = parseAttrs(attrStr);
      const self  = raw[raw.length - 2] === '/' || VOID_TAGS.has(tag);
      if (self) { nodes.push({ type: 'element', tag, attrs, children: [] }); continue; }
      const children = parse(cursor, [tag]);
      TAG_RE.lastIndex = cursor.pos;
      const cm = TAG_RE.exec(html);
      if (cm && cm[0].toLowerCase() === `</${tag}>` && cm.index === cursor.pos)
        cursor.pos = cm.index + cm[0].length;
      nodes.push({ type: 'element', tag, attrs, children });
    }
    return nodes;
  }
  return parse({ pos: 0 });
}

// ═════════════════════════════════════════════════════════════════════════════
// AST HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function astToInlineHtml(nodes) {
  return (nodes || []).map(n => {
    if (n.type === 'text') return n.text;
    if (n.tag === 'br')    return '<br/>';
    return `<${n.tag}>${astToInlineHtml(n.children)}</${n.tag}>`;
  }).join('');
}

function astToPlainText(nodes) {
  return (nodes || []).map(n => {
    if (n.type === 'text') return n.text;
    if (n.tag === 'br')    return ' ';
    return astToPlainText(n.children);
  }).join('');
}

const spanN = (attrs, k) => { const v = parseInt(attrs[k], 10); return Number.isFinite(v) && v > 0 ? v : 1; };

// ═════════════════════════════════════════════════════════════════════════════
// CONTENT-AWARE COLUMN WIDTH CALCULATOR
// ═════════════════════════════════════════════════════════════════════════════

function cellWeight(cellNode) {
  const text = astToPlainText(cellNode.children || []).trim();
  if (!text) return 3;
  const len = text.length;
  return Math.min(Math.max(len * 0.8, 6), 40);
}

function calculateProportionalWidths(trNodes, maxCols) {
  const colWeights = new Array(maxCols).fill(0);

  for (const tr of trNodes) {
    const cellNodes = (tr.children || []).filter(
      c => c?.type === 'element' && (c.tag === 'td' || c.tag === 'th')
    );
    let colIdx = 0;
    for (const cell of cellNodes) {
      const cs = spanN(cell.attrs || {}, 'colspan');
      const w = cellWeight(cell);
      const perCol = w / cs;
      for (let i = 0; i < cs && colIdx + i < maxCols; i++) {
        colWeights[colIdx + i] = Math.max(colWeights[colIdx + i], perCol);
      }
      colIdx += cs;
    }
  }

  const totalWeight = colWeights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    const w = Math.floor(PAGE.CONTENT_W / maxCols);
    return Array.from({ length: maxCols }, (_, i) =>
      i === maxCols - 1 ? PAGE.CONTENT_W - w * (maxCols - 1) : w
    );
  }

  let allocated = 0;
  const widths = colWeights.map((w, i) => {
    if (i === maxCols - 1) {
      return PAGE.CONTENT_W - allocated;
    }
    const dxa = Math.round((w / totalWeight) * PAGE.CONTENT_W);
    allocated += dxa;
    return dxa;
  });

  const MIN_COL_W = 300;
  const adjusted = widths.map(w => Math.max(w, MIN_COL_W));
  const excess = adjusted.reduce((a, b) => a + b, 0) - PAGE.CONTENT_W;

  if (excess > 0) {
    const sortedIdx = adjusted.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
    let remaining = excess;
    for (const item of sortedIdx) {
      if (remaining <= 0) break;
      const canShrink = adjusted[item.i] - MIN_COL_W;
      const shrink = Math.min(canShrink, remaining);
      adjusted[item.i] -= shrink;
      remaining -= shrink;
    }
  }

  return adjusted;
}

// ═════════════════════════════════════════════════════════════════════════════
// TABLE RENDERER
// ═════════════════════════════════════════════════════════════════════════════

function renderTable(tableNode) {
    const trNodes = [];
    for (const c of tableNode.children || []) {
      if (!c || c.type !== 'element') continue;
      if (c.tag === 'tr') trNodes.push(c);
      else if (['thead','tbody','tfoot'].includes(c.tag))
        for (const tr of c.children || [])
          if (tr?.type === 'element' && tr.tag === 'tr') trNodes.push(tr);
    }
    if (!trNodes.length) return null;

    let maxCols = 0;
    for (const tr of trNodes) {
      let cols = 0;
      for (const c of tr.children || [])
        if (c?.type === 'element' && (c.tag === 'td' || c.tag === 'th'))
          cols += spanN(c.attrs || {}, 'colspan');
      if (cols > maxCols) maxCols = cols;
    }
    if (maxCols === 0) return null;

    const colWidths = calculateProportionalWidths(trNodes, maxCols);

    const isHeaderRow = (tr, idx) => {
      if (idx === 0) {
        const parent = tableNode.children?.find(p => p?.children?.includes(tr));
        if (parent?.tag === 'thead') return true;
        if ((tr.children || []).some(c => c?.type === 'element' && c.tag === 'th')) return true;
      }
      return false;
    };

    const docxRows = trNodes.map((tr, rowIdx) => {
      const header   = isHeaderRow(tr, rowIdx);
      const isAltRow = !header && (rowIdx % 2 === 1);

      const cellNodes = (tr.children || []).filter(
        c => c?.type === 'element' && (c.tag === 'td' || c.tag === 'th')
      );

      let colIdx = 0;
      const docxCells = cellNodes.map((cell) => {
        const cs   = spanN(cell.attrs || {}, 'colspan');
        const cw   = colWidths.slice(colIdx, colIdx + cs).reduce((a, b) => a + b, 0);
        colIdx += cs;

        const isTh      = cell.tag === 'th' || header;
        const innerHtml = astToInlineHtml(cell.children || []);

        const hasBlocks = (cell.children || []).some(
          c => c?.type === 'element' && BLOCK_TAGS.has(c.tag) && !['br','hr'].includes(c.tag)
        );
        const cellChildren = hasBlocks
          ? astToDocxElements(cell.children || [])
          : [new Paragraph({
              children: parseInlineToRuns(innerHtml, {
                bold:  isTh,
                color: isTh ? C.NAVY : C.BODY,
                size:  isTh ? PT.SMALL + 1 : PT.BODY,
              }),
              alignment: AlignmentType.LEFT,
              spacing: { before: 30, after: 30 },
            })];

        const fill = isTh ? C.TH_BG : (isAltRow ? C.TD_ALT : C.WHITE);

        return new TableCell({
          width:   { size: Math.max(cw, 100), type: WidthType.DXA },
          borders: BORDER_NONE,
          shading: { fill, type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          columnSpan: cs > 1 ? cs : undefined,
          children: cellChildren,
        });
      });

      while (colIdx < maxCols) {
        docxCells.push(new TableCell({
          width:   { size: colWidths[colIdx], type: WidthType.DXA },
          borders: BORDER_NONE,
          shading: { fill: C.WHITE, type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 120, right: 120 },
          children: [new Paragraph({ children: [] })],
        }));
        colIdx++;
      }

      return new TableRow({
        children:    docxCells,
        tableHeader: header,
      });
    });

    return new Table({
      width:       { size: PAGE.CONTENT_W, type: WidthType.DXA },
      columnWidths: colWidths,
      borders: {
        top:     { style: BorderStyle.NONE, size: 0, color: C.WHITE },
        bottom:  { style: BorderStyle.NONE, size: 0, color: C.WHITE },
        left:    { style: BorderStyle.NONE, size: 0, color: C.WHITE },
        right:   { style: BorderStyle.NONE, size: 0, color: C.WHITE },
        insideH: { style: BorderStyle.SINGLE, size: 2, color: C.RULE },
        insideV: { style: BorderStyle.NONE,  size: 0, color: C.WHITE },
      },
      rows: docxRows,
    });
  }

// ═════════════════════════════════════════════════════════════════════════════
// LIST ITEM RENDERER
// ═════════════════════════════════════════════════════════════════════════════

function renderListItem(liNode, listType, depth) {
  const elements = [];
  const d   = Math.min(depth, 2);
  const ref = listType === 'ol'
    ? [NR.OL0, NR.OL1, NR.OL2][d]
    : [NR.UL0, NR.UL1, NR.UL2][d];

  const inlineNodes = [], blockNodes = [];
  for (const c of liNode.children || []) {
    if (c?.type === 'element' && (c.tag === 'ul' || c.tag === 'ol')) blockNodes.push(c);
    else inlineNodes.push(c);
  }

  elements.push(new Paragraph({
    children: parseInlineToRuns(astToInlineHtml(inlineNodes).trim() || ' '),
    numbering: { reference: ref, level: 0 },
    spacing: { before: 30, after: 30 },
  }));

  for (const sub of blockNodes)
    for (const c of sub.children || [])
      if (c?.type === 'element' && c.tag === 'li')
        elements.push(...renderListItem(c, sub.tag, depth + 1));

  return elements;
}

// ═════════════════════════════════════════════════════════════════════════════
// AST → DOCX ELEMENTS
// ═════════════════════════════════════════════════════════════════════════════

function astToDocxElements(nodes, ctx = {}) {
  const elements = [];

  const bodyPara = (html, opts = {}) => new Paragraph({
    children: parseInlineToRuns(html),
    spacing: { before: 60, after: 60, line: 280 },
    alignment: AlignmentType.JUSTIFIED,
    ...opts,
  });

  for (const node of nodes || []) {
    if (!node) continue;

    if (node.type === 'text') {
      const t = node.text.replace(/\s+/g, ' ').trim();
      if (t) elements.push(bodyPara(t));
      continue;
    }

    const { tag, attrs = {}, children = [] } = node;

    if (/^h[1-6]$/.test(tag)) {
      const lvl = parseInt(tag[1], 10);
      const hMap = [, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
                      HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
      const sMap = [, PT.H1, PT.H2, PT.H3, PT.H4, PT.H5, PT.H6];
      elements.push(new Paragraph({
        heading: hMap[lvl],
        children: parseInlineToRuns(astToInlineHtml(children), {
          size: sMap[lvl], bold: lvl <= 3,
          color: lvl === 1 ? C.NAVY : lvl === 2 ? C.NAVY_LIGHT : C.BODY,
        }),
        alignment: AlignmentType.LEFT,
        spacing: { before: lvl <= 2 ? 280 : 180, after: lvl <= 2 ? 100 : 60 },
        border: lvl <= 2 ? {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: C.RULE, space: 4 }
        } : undefined,
      }));
      continue;
    }

    if (tag === 'p' || tag === 'div') {
      const inner = astToInlineHtml(children).trim();
      if (!inner) { elements.push(new Paragraph({ children: [], spacing: { before: 60, after: 60 } })); continue; }
      const hasBlock = children.some(c => c?.type === 'element' && BLOCK_TAGS.has(c.tag) && !['br'].includes(c.tag));
      if (hasBlock) { elements.push(...astToDocxElements(children, ctx)); continue; }
      elements.push(bodyPara(inner));
      continue;
    }

    if (tag === 'blockquote') {
      elements.push(new Paragraph({
        children: parseInlineToRuns(astToInlineHtml(children), { italics: true, color: C.MUTED }),
        indent: { left: 720 },
        spacing: { before: 100, after: 100, line: 280 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.NAVY_LIGHT, space: 10 } },
      }));
      continue;
    }

    if (tag === 'pre') {
      for (const line of astToInlineHtml(children).replace(/<<[^>]+>/g, '').split('\n')) {
        elements.push(new Paragraph({
          children: [new TextRun({ text: line, font: FONT.MONO, size: 17 })],
          spacing: { before: 20, after: 20 },
          shading: { fill: 'F4F4F4', type: ShadingType.CLEAR },
          indent: { left: 360 },
        }));
      }
      continue;
    }

    if (tag === 'hr') {
      elements.push(new Paragraph({
        children: [], spacing: { before: 100, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.RULE, space: 1 } },
      }));
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      for (const c of children)
        if (c?.type === 'element' && c.tag === 'li')
          elements.push(...renderListItem(c, tag, ctx.listDepth || 0));
      continue;
    }

    if (tag === 'table') {
      const t = renderTable(node);
      if (t) {
        elements.push(new Paragraph({ children: [], spacing: { before: 80, after: 0 } }));
        elements.push(t);
        elements.push(new Paragraph({ children: [], spacing: { before: 0, after: 80 } }));
      }
      continue;
    }

    if (['figure','section','article','header','footer'].includes(tag)) {
      elements.push(...astToDocxElements(children, ctx)); continue;
    }

    if (['strong','b','em','i','u','s','span','a','del'].includes(tag)) {
      const h = astToInlineHtml([node]);
      if (h.trim()) elements.push(bodyPara(h));
      continue;
    }

    elements.push(...astToDocxElements(children, ctx));
  }
  return elements;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC: htmlToDocxElements
// ═════════════════════════════════════════════════════════════════════════════

function htmlToDocxElements(html) {
  if (!html?.trim()) return [];
  return astToDocxElements(parseHtmlToAst(normaliseHtml(html)));
}

// ═════════════════════════════════════════════════════════════════════════════
// PATIENT INFO HEADER
// ═════════════════════════════════════════════════════════════════════════════

function makeInfoCell(text, role, widthDxa) {
  const isLabel  = role === 'label';
  const isAccent = role === 'accent';
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    borders: isLabel ? BORDER_NONE : BORDER_BOTTOM_RULE,
    shading: { fill: C.WHITE, type: ShadingType.CLEAR },
    margins: { top: 30, bottom: 30, left: 0, right: 60 },
    verticalAlign: VerticalAlign.BOTTOM,
    children: [new Paragraph({
      children: [new TextRun({
        text,
        font: FONT.BODY,
        size:   isLabel  ? PT.LABEL : PT.BODY,
        bold:   isAccent,
        color:  isLabel  ? C.SUBTLE
               : isAccent ? C.NAVY
               : C.BODY,
      })],
      spacing: { before: 0, after: isLabel ? 10 : 20, line: 240 },
    })],
  });
}

function buildPatientInfoTable(data) {
  const GENDER = { '1': 'Male', '2': 'Female', 'M': 'Male', 'F': 'Female' };
  const gender   = GENDER[data.Gender] || fmt(data.Gender);
  const age      = data.Age ? `${data.Age} ${data.YMD || 'Yrs'}` : '—';
  const date     = data.FinalizedAtFormatted || fmtDate(data.RegisteredOn);
  const patient  = toTitle(`${fmt(data.Title)} ${fmt(data.Name)}`.trim());
  const doctor   = toTitle(fmt(data.DoctorName));

  const TABLE_W  = Math.round(PAGE.CONTENT_W * 0.96);
  const LW = Math.round(TABLE_W * 0.16);
  const VW = Math.round(TABLE_W * 0.34);

  const row = (...cells) => new TableRow({ children: cells });

  const spacer = () => new TableRow({
    children: [new TableCell({
      columnSpan: 4,
      width: { size: TABLE_W, type: WidthType.DXA },
      borders: BORDER_NONE,
      children: [new Paragraph({ children: [], spacing: { before: 20, after: 0 } })],
    })],
    height: { value: 80, rule: HeightRule.ATLEAST },
  });

  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: [LW, VW, LW, VW],
    borders: BORDER_NONE,
    rows: [
      row(
        makeInfoCell('PATIENT NAME', 'label', LW),
        makeInfoCell(patient,        'accent', VW),
        makeInfoCell('CONTACT',      'label', LW),
        makeInfoCell(fmt(data.PhoneNumber), 'value', VW),
      ),
      spacer(),
      row(
        makeInfoCell('AGE / GENDER', 'label', LW),
        makeInfoCell(`${age} / ${gender}`, 'value', VW),
        makeInfoCell('REPORT DATE',   'label', LW),
        makeInfoCell(date,             'value', VW),
      ),
      spacer(),
      row(
        makeInfoCell('REFERRING DR.', 'label', LW),
        new TableCell({
          width: { size: VW, type: WidthType.DXA },
          borders: BORDER_BOTTOM_RULE,
          margins: { top: 20, bottom: 20, left: 0, right: 60 },
          verticalAlign: VerticalAlign.BOTTOM,
          children: [
            new Paragraph({
              children: [new TextRun({ text: doctor, font: FONT.BODY, size: PT.BODY, color: C.BODY })],
              spacing: { before: 0, after: data.DoctorSpeciality ? 0 : 20, line: 240 },
            }),
            ...(data.DoctorSpeciality ? [new Paragraph({
              children: [new TextRun({ text: fmt(data.DoctorSpeciality), font: FONT.BODY, size: PT.LABEL, italics: true, color: C.SUBTLE })],
              spacing: { before: 0, after: 10, line: 240 },
            })] : []),
          ],
        }),
        makeInfoCell('INVESTIGATION',  'label', LW),
        makeInfoCell(fmt(data.TestName), 'accent', VW),
      ),
    ],
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// DIVIDERS & SECTION HEADINGS
// ═════════════════════════════════════════════════════════════════════════════

const makeNavyRule = (before = 100, after = 120) => new Paragraph({
  children: [],
  spacing: { before, after },
  border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: C.NAVY, space: 1 } },
});

const makeThinRule = (before = 60, after = 80) => new Paragraph({
  children: [],
  spacing: { before, after },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.RULE, space: 1 } },
});

// ═════════════════════════════════════════════════════════════════════════════
// SIGNATURE BLOCK
// ═════════════════════════════════════════════════════════════════════════════

function buildSignatureBlock(data) {
  const name   = toTitle(fmt(data.FinalizedByName   || data.Signatory1Name   || 'Dr. Daya Prakash'));
  const degree = fmt(data.FinalizedByDegree || data.Signatory1Degree || 'DMRD, DNB (Rad)');
  const role   = fmt(data.FinalizedByRole   || data.Signatory1Role   || 'Radiologist');

  const HALF = Math.floor(PAGE.CONTENT_W / 2);

  return new Table({
    width: { size: PAGE.CONTENT_W, type: WidthType.DXA },
    columnWidths: [HALF, HALF],
    borders: BORDER_NONE,
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: HALF, type: WidthType.DXA },
          borders: BORDER_NONE,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Reported By', font: FONT.BODY, size: PT.LABEL, color: C.SUBTLE })],
              spacing: { before: 0, after: 100 },
            }),
            new Paragraph({
              children: [new TextRun({ text: name, font: FONT.BODY, size: PT.SIG_NAME, bold: true, color: C.NAVY })],
              spacing: { before: 0, after: 30 },
            }),
            new Paragraph({
              children: [new TextRun({ text: degree, font: FONT.BODY, size: PT.SIG_DEG, color: C.MUTED })],
              spacing: { before: 0, after: 20 },
            }),
            new Paragraph({
              children: [new TextRun({ text: role, font: FONT.BODY, size: PT.SIG_ROLE, italics: true, color: C.SUBTLE })],
              spacing: { before: 0, after: 0 },
            }),
          ],
        }),
        new TableCell({
          width: { size: HALF, type: WidthType.DXA },
          borders: BORDER_NONE,
          children: [new Paragraph({ children: [] })],
        }),
      ],
    })],
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// DOCUMENT STYLES
// ═════════════════════════════════════════════════════════════════════════════

const buildStyles = () => ({
  default: {
    document: { run: { font: FONT.BODY, size: PT.BODY, color: C.BODY } },
  },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: PT.H1, bold: true, font: FONT.BODY, color: C.NAVY },
      paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: PT.H2, bold: true, font: FONT.BODY, color: C.NAVY_LIGHT },
      paragraph: { spacing: { before: 220, after: 80  }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: PT.H3, bold: true, font: FONT.BODY, color: C.BODY },
      paragraph: { spacing: { before: 180, after: 60  }, outlineLevel: 2 } },
  ],
});

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC: buildDocxLayout — signature at bottom, NO footer horizontal line
// ═════════════════════════════════════════════════════════════════════════════

const buildDocxLayout = async (data) => {
    const reportBody = htmlToDocxElements(data.Report || '');

    // Build report content as a single table cell
    const reportCell = new TableCell({
      width: { size: PAGE.CONTENT_W, type: WidthType.DXA },
      borders: BORDER_NONE,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [
        buildPatientInfoTable(data),
        makeNavyRule(80, 120),
        ...reportBody,
      ],
    });

    // Signature cell — horizontal line REMOVED
    const signatureCell = new TableCell({
      width: { size: PAGE.CONTENT_W, type: WidthType.DXA },
      borders: BORDER_NONE,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [
        // ─── REMOVED: makeThinRule(0, 80) ──────────────────────────────────
        buildSignatureBlock(data),
      ],
    });

    // Single-column, two-row table: report expands, signature stays at bottom
    const layoutTable = new Table({
      width: { size: PAGE.CONTENT_W, type: WidthType.DXA },
      columnWidths: [PAGE.CONTENT_W],
      borders: BORDER_NONE,
      rows: [
        new TableRow({
          children: [reportCell],
          // Tall enough to push signature toward bottom on short reports
          height: { value: 12000, rule: HeightRule.ATLEAST },
        }),
        new TableRow({
          children: [signatureCell],
          height: { value: 1200, rule: HeightRule.ATLEAST },
        }),
      ],
    });

    const doc = new Document({
      numbering: { config: buildNumberingConfig() },
      styles:    buildStyles(),
      sections: [{
        properties: {
          page: {
            size:   { width: PAGE.WIDTH, height: PAGE.HEIGHT },
            margin: {
              top:    PAGE.MARGIN_TOP,
              bottom: PAGE.MARGIN_BOTTOM,
              left:   PAGE.MARGIN_SIDE,
              right:  PAGE.MARGIN_SIDE,
            },
          },
        },
        children: [layoutTable],
      }],
    });

    return await Packer.toBuffer(doc);
  };

// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = { buildDocxLayout, htmlToDocxElements, safeNames };