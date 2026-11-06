'use strict';

/**
 * reportDocxBuilder.js
 * ─────────────────────────────────────────────────────────────
 * PROFESSIONAL MEDICAL REPORT DOCX BUILDER
 * Stable HTML → DOCX renderer
 *
 * ✔ CKEditor
 * ✔ Summernote
 * ✔ Word Paste
 * ✔ Images
 * ✔ Tables
 * ✔ Nested HTML
 * ✔ Medical Report Layout
 * ✔ RIS/PACS Style
 * ✔ Reporting Pad Support
 * ─────────────────────────────────────────────────────────────
 */

const docx = require('docx');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  ImageRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  UnderlineType,
  HeightRule,
  VerticalAlign,
  convertInchesToTwip,
} = docx;

const { parse } = require('node-html-parser');

const fs = require('fs');
const path = require('path');

// ═════════════════════════════════════════════════════════════
// PAGE CONFIG
// ═════════════════════════════════════════════════════════════

const PAGE = {

  WIDTH: 11906,
  HEIGHT: 16838,

  MARGIN_TOP:
    convertInchesToTwip(0.3),

  MARGIN_BOTTOM:
    convertInchesToTwip(0.3),

  MARGIN_SIDE:
    convertInchesToTwip(0.4),
};

// ═════════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═════════════════════════════════════════════════════════════

const FONT = {
  BODY: 'Calibri',
};

const COLOR = {
  BLACK: '000000',
  GRAY: '666666',
  BORDER: 'D9D9D9',
};

const PT = {

  BODY: 22,

  SMALL: 18,

  H1: 34,
  H2: 30,
  H3: 26,

  LABEL: 20,
};

// ═════════════════════════════════════════════════════════════
// BORDERS
// ═════════════════════════════════════════════════════════════

const BORDER_NONE = {

  top: {
    style: BorderStyle.NONE,
    size: 0,
    color: 'FFFFFF',
  },

  bottom: {
    style: BorderStyle.NONE,
    size: 0,
    color: 'FFFFFF',
  },

  left: {
    style: BorderStyle.NONE,
    size: 0,
    color: 'FFFFFF',
  },

  right: {
    style: BorderStyle.NONE,
    size: 0,
    color: 'FFFFFF',
  },
};

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

const safeNames = (value = '') => {

  return String(value)
    .replace(
      /[^a-zA-Z0-9_\-. ]/g,
      '_'
    )
    .trim();
};

function sanitize(text) {

  if (text == null) return '';

  return String(text)

    .replace(
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
      ''
    )

    .replace(/\s+/g, ' ');
}

function safeParagraph(config = {}) {

  return new Paragraph({

    ...config,

    children:
      config.children &&
      config.children.length
        ? config.children
        : [new TextRun('')],
  });
}

function cleanHtml(html = '') {

  return html

    .replace(
      /<!--[\s\S]*?-->/g,
      ''
    )

    .replace(
      /<o:p>\s*<\/o:p>/gi,
      ''
    )

    .replace(
      /<o:p>.*?<\/o:p>/gi,
      ''
    )

    .replace(
      /\s*mso-[^:]+:[^;"]+;?/gi,
      ''
    )

    .replace(
      /\s*class=['"]?Mso[a-zA-Z]+['"]?/gi,
      ''
    );
}

// ═════════════════════════════════════════════════════════════
// DOM HELPERS
// ═════════════════════════════════════════════════════════════

const isElem = (n) =>
  n && n.nodeType === 1;

const isText = (n) =>
  n && n.nodeType === 3;

const tagName = (n) =>
  n.tagName?.toLowerCase();

const childNodes = (n) =>
  n.childNodes || [];

// ═════════════════════════════════════════════════════════════
// FORMATTERS
// ═════════════════════════════════════════════════════════════

const capitalize = (str = '') => {

  return String(str)

    .toLowerCase()

    .split(' ')

    .map(
      s =>
        s.charAt(0).toUpperCase() +
        s.slice(1)
    )

    .join(' ');
};

function formatGender(gender) {

  if (
    gender === 1 ||
    gender === '1'
  ) return 'M';

  if (
    gender === 2 ||
    gender === '2'
  ) return 'F';

  return gender || '';
}

function formatDate(date) {

  if (!date) return '';

  const d = new Date(date);

  const dd = String(
    d.getDate()
  ).padStart(2, '0');

  const mm = String(
    d.getMonth() + 1
  ).padStart(2, '0');

  const yyyy =
    d.getFullYear();

  return `${dd}-${mm}-${yyyy}`;
}

// ═════════════════════════════════════════════════════════════
// IMAGE HANDLER
// ═════════════════════════════════════════════════════════════

async function fetchImageBuffer(src) {

  return new Promise(
    (resolve, reject) => {

      try {

        // BASE64
        if (
          src.startsWith('data:')
        ) {

          const b64 =
            src.split(',')[1];

          return resolve(
            Buffer.from(
              b64,
              'base64'
            )
          );
        }

        // REMOVE DOMAIN
        src = src.replace(
          /^https?:\/\/[^/]+/i,
          ''
        );

        src = src.replace(
          /^\/+/,
          ''
        );

        const fullPath =
          path.join(
            process.cwd(),
            src
          );

        fs.readFile(
          fullPath,
          (err, data) => {

            if (err) {

              console.error(
                'IMAGE ERROR:',
                fullPath
              );

              return reject(err);
            }

            resolve(data);
          }
        );

      } catch (err) {

        reject(err);
      }
    }
  );
}

function parseImageDimensions(
  styleStr = ''
) {

  const widthMatch =
    styleStr.match(
      /width\s*:\s*([\d.]+)px/i
    );

  const heightMatch =
    styleStr.match(
      /height\s*:\s*([\d.]+)px/i
    );

  let width = 450;
  let height = 300;

  if (widthMatch) {
    width =
      parseFloat(
        widthMatch[1]
      );
  }

  if (heightMatch) {
    height =
      parseFloat(
        heightMatch[1]
      );
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

// ═════════════════════════════════════════════════════════════
// INLINE RUN BUILDER
// ═════════════════════════════════════════════════════════════

async function buildRuns(
  nodes,
  fmt = {}
) {

  const runs = [];

  const state = {

    font: FONT.BODY,

    size:
      fmt.size || PT.BODY,

    bold:
      fmt.bold || false,

    italics:
      fmt.italics || false,

    underline: false,
  };

  const walk = async node => {

    // TEXT
    if (isText(node)) {

      const text =
        sanitize(node.text);

      if (text.trim()) {

        runs.push(

          new TextRun({

            text,

            font: state.font,

            size: state.size,

            color:
              COLOR.BLACK,

            bold:
              state.bold,

            italics:
              state.italics,

            underline:
              state.underline
                ? {
                    type:
                      UnderlineType.SINGLE,
                  }
                : undefined,
          })
        );
      }

      return;
    }

    if (!isElem(node))
      return;

    const tag =
      tagName(node);

    const attrs =
      node.attributes || {};

    // IMAGE
    if (tag === 'img') {

      const src =
        attrs.src;

      if (src) {

        try {

          const buffer =
            await fetchImageBuffer(
              src
            );

          const dims =
            parseImageDimensions(
              attrs.style ||
                ''
            );

          runs.push(

            new ImageRun({

              data: buffer,

              transformation:
                dims,
            })
          );

        } catch (err) {

          console.error(
            'IMAGE LOAD ERROR:',
            err.message
          );
        }
      }

      return;
    }

    // BR
    if (tag === 'br') {

      runs.push(
        new TextRun({
          break: 1,
        })
      );

      return;
    }

    // SAVE
    const saved = {
      ...state,
    };

    if (
      tag === 'strong' ||
      tag === 'b'
    ) {
      state.bold = true;
    }

    if (
      tag === 'em' ||
      tag === 'i'
    ) {
      state.italics = true;
    }

    if (tag === 'u') {
      state.underline = true;
    }

    for (const child of childNodes(
      node
    )) {

      await walk(child);
    }

    Object.assign(
      state,
      saved
    );
  };

  for (
    const n of Array.isArray(
      nodes
    )
      ? nodes
      : [nodes]
  ) {

    await walk(n);
  }

  return runs.length
    ? runs
    : [new TextRun('')];
}

// ═════════════════════════════════════════════════════════════
// HTML → DOCX
// ═════════════════════════════════════════════════════════════

async function domToDocx(
  node
) {

  const elements = [];

  // TEXT
  if (isText(node)) {

    const text =
      sanitize(node.text);

    if (text.trim()) {

      elements.push(

        safeParagraph({

          children: [

            new TextRun({
              text,
            }),

          ],
        })
      );
    }

    return elements;
  }

  if (!isElem(node))
    return elements;

  const tag =
    tagName(node);

  const kids =
    childNodes(node);

  // PARAGRAPH
  if (
    tag === 'p' ||
    tag === 'div'
  ) {

    elements.push(

      safeParagraph({

        children:
          await buildRuns(
            kids
          ),

        spacing: {
          before: 40,
          after: 40,
          line: 300,
        },

        alignment:
          AlignmentType.JUSTIFIED,
      })
    );

    return elements;
  }

  // HEADINGS
  if (/^h[1-6]$/.test(tag)) {

    const lvl =
      parseInt(
        tag[1],
        10
      );

    const headingMap = [
      null,
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ];

    const sizeMap = [
      null,
      PT.H1,
      PT.H2,
      PT.H3,
      PT.H3,
      PT.H3,
      PT.H3,
    ];

    elements.push(

      safeParagraph({

        heading:
          headingMap[lvl],

        children:
          await buildRuns(
            kids,
            {
              size:
                sizeMap[
                  lvl
                ],
              bold: true,
            }
          ),

        spacing: {
          before: 180,
          after: 100,
        },
      })
    );

    return elements;
  }

  // LIST
  if (
    tag === 'ul' ||
    tag === 'ol'
  ) {

    for (const li of kids) {

      if (
        !isElem(li) ||
        tagName(li) !==
          'li'
      ) continue;

      elements.push(

        safeParagraph({

          children:
            await buildRuns(
              childNodes(li)
            ),

          bullet: {
            level: 0,
          },

          spacing: {
            before: 30,
            after: 30,
          },
        })
      );
    }

    return elements;
  }

  // TABLE
  if (tag === 'table') {

    const rows = [];

    const trNodes = [];

    const collectTr =
      node => {

        if (!isElem(node))
          return;

        if (
          tagName(node) ===
          'tr'
        ) {

          trNodes.push(node);
        }

        for (const child of childNodes(
          node
        )) {

          collectTr(child);
        }
      };

    collectTr(node);

    for (const tr of trNodes) {

      const cells = [];

      for (const td of childNodes(
        tr
      )) {

        if (
          !isElem(td) ||
          !['td', 'th'].includes(
            tagName(td)
          )
        ) continue;

        const runs =
          await buildRuns(
            childNodes(td)
          );

        cells.push(

          new TableCell({

            borders:
              BORDER_NONE,

            margins: {
              top: 60,
              bottom: 60,
              left: 60,
              right: 60,
            },

            children: [

              safeParagraph({
                children:
                  runs,
              }),

            ],
          })
        );
      }

      // SKIP EMPTY ROWS
      if (!cells.length) {
        continue;
      }

      rows.push(

        new TableRow({

          children:
            cells,

          height: {
            value: 120,
            rule:
              HeightRule.AUTO,
          },
        })
      );
    }

    // SKIP EMPTY TABLES
    if (!rows.length) {
      return [];
    }

    elements.push(

      new Table({

        width: {
          size: 100,
          type:
            WidthType.PERCENTAGE,
        },

        borders:
          BORDER_NONE,

        rows,
      })
    );

    return elements;
  }

  // IMAGE BLOCK
  if (tag === 'img') {

    const src =
      node.attributes?.src;

    if (src) {

      try {

        const buffer =
          await fetchImageBuffer(
            src
          );

        const dims =
          parseImageDimensions(
            node.attributes
              ?.style || ''
          );

        elements.push(

          safeParagraph({

            children: [

              new ImageRun({
                data:
                  buffer,

                transformation:
                  dims,
              }),

            ],

            alignment:
              AlignmentType.CENTER,

            spacing: {
              before: 120,
              after: 120,
            },
          })
        );

      } catch (err) {

        console.error(
          'IMAGE BLOCK ERROR:',
          err.message
        );
      }
    }

    return elements;
  }

  // OTHER
  for (const child of kids) {

    elements.push(

      ...(await domToDocx(
        child
      ))
    );
  }

  return elements;
}

// ═════════════════════════════════════════════════════════════
// HTML PARSER
// ═════════════════════════════════════════════════════════════

async function htmlToDocxElements(
  html
) {

  if (!html?.trim())
    return [];

  const cleanedHtml =
    cleanHtml(html);

  const root = parse(
    cleanedHtml,
    {
      lowerCaseTagName: true,
      comment: false,
    }
  );

  const elements = [];

  for (const node of childNodes(
    root
  )) {

    elements.push(

      ...(await domToDocx(
        node
      ))
    );
  }

  return elements;
}

// ═════════════════════════════════════════════════════════════
// PROFESSIONAL INFO CELL
// ═════════════════════════════════════════════════════════════

function infoCell(
  label,
  value
) {

  return new TableCell({

    borders: {

      top: {
        style:
          BorderStyle.SINGLE,
        size: 1,
        color:
          COLOR.BORDER,
      },

      bottom: {
        style:
          BorderStyle.SINGLE,
        size: 1,
        color:
          COLOR.BORDER,
      },

      left: {
        style:
          BorderStyle.SINGLE,
        size: 1,
        color:
          COLOR.BORDER,
      },

      right: {
        style:
          BorderStyle.SINGLE,
        size: 1,
        color:
          COLOR.BORDER,
      },
    },

    margins: {
      top: 60,
      bottom: 60,
      left: 100,
      right: 100,
    },

    verticalAlign:
      VerticalAlign.CENTER,

    children: [

      new Paragraph({

        spacing: {
          before: 0,
          after: 0,
          line: 220,
        },

        children: [

          new TextRun({

            text: `${label}: `,

            bold: true,

            size:
              PT.LABEL,

            color:
              COLOR.GRAY,
          }),

          new TextRun({

            text: String(
              value || ''
            ),

            size:
              PT.BODY,

            color:
              COLOR.BLACK,
          }),

        ],
      }),

    ],
  });
}

// ═════════════════════════════════════════════════════════════
// MAIN DOC BUILDER
// ═════════════════════════════════════════════════════════════

async function buildDocxLayout(
  data
) {

  const reportBody =
    await htmlToDocxElements(
      data.Report || ''
    );

  const patientName =
    capitalize(
      `${data.Title || ''} ${data.Name || ''}`
    );

  const doctorName =
    `Dr. ${capitalize(
      data.DoctorName ||
        ''
    )}`;

  const doctorDegree =
    data.DoctorDegree ||
    data.DoctorSpeciality ||
    '';

  const gender =
    formatGender(
      data.Gender
    );

  const reportDate =
    formatDate(
      data.FinalizedAt ||
      data.RegisteredOn
    );

  // PATIENT TABLE
  const patientTable =
    new Table({

      width: {
        size: 100,
        type:
          WidthType.PERCENTAGE,
      },

      rows: [

        new TableRow({

          children: [

            infoCell(
              'PATIENT NAME',
              patientName
            ),

            infoCell(
              'AGE/GENDER',
              `${data.Age || ''}Y / ${gender}`
            ),

          ],
        }),

        new TableRow({

          children: [

            infoCell(
              'REFERRED BY',
              `${doctorName} ${doctorDegree}`
            ),

            infoCell(
              'REPORT DATE',
              reportDate
            ),

          ],
        }),

        new TableRow({

          children: [

            infoCell(
              'PATIENT ID',
              data.PatientId ||
                ''
            ),

            infoCell(
              '',
              ''
            ),

          ],
        }),

      ],
    });

  // DOCUMENT
  const doc =
    new Document({

      sections: [

        {

          properties: {

            page: {

              size: {
                width:
                  PAGE.WIDTH,
                height:
                  PAGE.HEIGHT,
              },

              margin: {

                top:
                  PAGE.MARGIN_TOP,

                bottom:
                  PAGE.MARGIN_BOTTOM,

                left:
                  PAGE.MARGIN_SIDE,

                right:
                  PAGE.MARGIN_SIDE,
              },
            },
          },

          children: [

            // HEADER SPACE FOR
            // PREPRINTED REPORT PAD
            new Paragraph({

              spacing: {
                before: 900,
                after: 0,
              },

              children: [
                new TextRun(''),
              ],
            }),

            patientTable,

            new Paragraph({

              spacing: {
                after: 220,
              },

              children: [
                new TextRun(''),
              ],
            }),

            ...reportBody,

          ],
        },

      ],
    });

  return await Packer.toBuffer(
    doc
  );
}

// ═════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════

module.exports = {

  buildDocxLayout,

  htmlToDocxElements,

  safeNames,
};