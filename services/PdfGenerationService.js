/**
 * PDF Report Service — modern, shared-hosting compatible.
 *
 * Pure JavaScript via pdfmake. NO Puppeteer, NO PhantomJS, NO system binaries —
 * works identically on any shared host. The html-pdf path has been removed
 * because PhantomJS is abandoned and is what produced the crude output; a
 * well-built pdfmake document renders cleanly everywhere.
 *
 * Server font setup: pass the path to pdfmake's bundled Roboto fonts, or rely
 * on the default resolution below.
 */

const path = require("path");
const fs = require("fs");
const moment = require("moment");

/**
 * Font resolution for shared hosting.
 * Ship the four Roboto TTFs WITH your app (recommended) so you never depend on
 * node_modules internals. Set PDF_FONT_DIR to that folder, or drop them in
 * <project>/assets/fonts/Roboto. We fall back to pdfmake's copy if present.
 */
const FONT_CANDIDATES = [
  process.env.PDF_FONT_DIR,
  path.join(process.cwd(), "assets", "fonts", "Roboto"),
  path.join(__dirname, "..", "assets", "fonts", "Roboto"),
  (() => { try { return path.join(path.dirname(require.resolve("pdfmake")), "..", "fonts", "Roboto"); } catch (e) { return null; } })(),
  (() => { try { return path.join(path.dirname(require.resolve("pdfmake")), "..", "build", "fonts", "Roboto"); } catch (e) { return null; } })()
].filter(Boolean);

const PDFMAKE_FONT_DIR = FONT_CANDIDATES.find((d) => {
  try { return fs.existsSync(path.join(d, "Roboto-Regular.ttf")); } catch (e) { return false; }
}) || FONT_CANDIDATES[1];

const FONTS = {
  Roboto: {
    normal: path.join(PDFMAKE_FONT_DIR, "Roboto-Regular.ttf"),
    bold: path.join(PDFMAKE_FONT_DIR, "Roboto-Medium.ttf"),
    italics: path.join(PDFMAKE_FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(PDFMAKE_FONT_DIR, "Roboto-MediumItalic.ttf")
  }
};

// ---- palette -------------------------------------------------------------
const C = {
  ink: "#1A2B45",        // near-black navy for headings
  body: "#33415C",       // body text
  muted: "#6B7A90",      // secondary text
  line: "#E3E8EF",       // hairlines
  band: "#F4F7FB",       // zebra / panel fill
  brand: "#16467A",      // primary brand
  brandSoft: "#EAF1F8",  // brand tint
  ok: "#1F9254",         // normal
  warn: "#C2691C",       // high/low
  crit: "#C0392B",       // critical
  critBg: "#FCEDEB",
  warnBg: "#FBF1E7"
};

class PDFService {
  /**
   * Primary entry point. Returns a Buffer of the finished PDF.
   * @param {object} data { report, results, labInfo }
   */
  async generateReport(data) {
    return this.generateReportPDFMake(data);
  }

  /** Backward-compatible alias — existing controllers call pdfService.generate(). */
  async generate(data) {
    return this.generateReportPDFMake(data);
  }

  async generateReportPDFMake({ report, results, labInfo }) {
    // pdfmake 0.2.x exports the server printer as the default export.
    const PdfPrinter = require("pdfmake");
    const printer = new PdfPrinter(FONTS);
    const docDefinition = this.buildDocDefinition({ report, results, labInfo });
    const doc = printer.createPdfKitDocument(docDefinition);

    return new Promise((resolve, reject) => {
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  }

  /* ----------------------------- helpers ------------------------------ */

  // Trim "32.0000 - 36.0000" -> "32 – 36"; keep meaningful decimals.
  _num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    // up to 2 decimals, no trailing zeros
    return n.toFixed(2).replace(/\.?0+$/, "");
  }

  _range(r) {
    const explicit = r.reference_range_used || r.ReferenceRangeUsed;
    if (explicit) {
      // normalise any "x.0000 - y.0000" that slipped through
      return String(explicit).replace(/(\d+)\.0+(?=\D|$)/g, "$1")
        .replace(/(\d+\.\d*?)0+(?=\D|$)/g, "$1")
        .replace(/\s*-\s*/, " – ");
    }
    const lo = this._num(r.min_value ?? r.MinValue);
    const hi = this._num(r.max_value ?? r.MaxValue);
    if (lo !== null && hi !== null) return `${lo} – ${hi}`;
    if (hi !== null) return `≤ ${hi}`;
    if (lo !== null) return `≥ ${lo}`;
    return "—";
  }

  _flagMeta(flag) {
    const f = (flag || "").toLowerCase();
    if (f === "critical_high") return { label: "CRITICAL HIGH", marker: "HH", color: C.crit, bg: C.critBg, abnormal: true, critical: true };
    if (f === "critical_low")  return { label: "CRITICAL LOW",  marker: "LL", color: C.crit, bg: C.critBg, abnormal: true, critical: true };
    if (f.includes("critical")) return { label: f.replace(/_/g, " ").toUpperCase(), marker: "!", color: C.crit, bg: C.critBg, abnormal: true, critical: true };
    if (f === "high") return { label: "HIGH", marker: "H", color: C.warn, bg: C.warnBg, abnormal: true, critical: false };
    if (f === "low")  return { label: "LOW",  marker: "L", color: C.warn, bg: C.warnBg, abnormal: true, critical: false };
    if (f === "abnormal") return { label: "ABNORMAL", marker: "*", color: C.warn, bg: C.warnBg, abnormal: true, critical: false };
    if (f === "normal") return { label: "NORMAL", marker: "", color: C.ok, bg: null, abnormal: false, critical: false };
    return { label: "PENDING", marker: "", color: C.muted, bg: null, abnormal: false, critical: false };
  }

  _fmtDate(v) {
    return v ? moment(v).format("DD MMM YYYY, HH:mm") : "—";
  }

  _gender(g) {
    if (g === null || g === undefined || g === "") return "—";
    const s = String(g).toLowerCase().trim();
    if (["1", "m", "male"].includes(s)) return "Male";
    if (["2", "f", "female"].includes(s)) return "Female";
    if (["3", "o", "other"].includes(s)) return "Other";
    return String(g);
  }

  /* --------------------------- document ------------------------------- */

  buildDocDefinition({ report, results, labInfo }) {
    labInfo = labInfo || {};
    results = Array.isArray(results) ? results : [];

    // Group by section, then sort params by display order / name within each.
    const grouped = results.reduce((acc, r) => {
      const s = r.section_header || r.SectionHeader || "Results";
      (acc[s] = acc[s] || []).push(r);
      return acc;
    }, {});
    Object.keys(grouped).forEach((s) => {
      grouped[s].sort((a, b) => {
        const ao = a.display_order ?? a.DisplayOrder ?? 9999;
        const bo = b.display_order ?? b.DisplayOrder ?? 9999;
        if (ao !== bo) return ao - bo;
        return String(a.parameter_name || a.ParameterName || "").localeCompare(String(b.parameter_name || b.ParameterName || ""));
      });
    });

    const anyCritical = results.some((r) => {
      const f = (r.flag || r.Flag || "").toLowerCase();
      return f.includes("critical");
    });
    const abnormalCount = results.filter((r) => this._flagMeta(r.flag || r.Flag).abnormal).length;

    const content = [];

    // ---- patient panel ----
    const pName = report.patient_name || report.PatientName || "—";
    const pAge = report.patient_age || report.PatientAge;
    const pAgeUnit = report.patient_age_unit || report.PatientAgeUnit || "yrs";
    const pGender = this._gender(report.patient_gender || report.PatientGender);
    const reportNo = report.report_number || report.ReportNumber || "—";
    const doctor = report.referring_doctor || report.ReferringDoctor || "—";

    content.push({
      table: {
        widths: ["18%", "32%", "18%", "32%"],
        body: [
          [
            this._pLabel("Patient"),
            { text: pName, style: "pValueStrong" },
            this._pLabel("Report No."),
            { text: reportNo, style: "pValueStrong" }
          ],
          [
            this._pLabel("Age / Sex"),
            { text: `${pAge != null ? pAge : "—"} ${pAge != null ? pAgeUnit : ""}  ·  ${pGender}`, style: "pValue" },
            this._pLabel("Ref. Doctor"),
            { text: doctor, style: "pValue" }
          ],
          [
            this._pLabel("Collected"),
            { text: this._fmtDate(report.specimen_collected_at || report.SpecimenCollectedAt), style: "pValue" },
            this._pLabel("Reported"),
            { text: this._fmtDate(report.approved_at || report.ApprovedAt || report.reported_at), style: "pValue" }
          ]
        ]
      },
      layout: {
        fillColor: (ri, node, ci) => (ci % 2 === 0 ? C.brandSoft : C.band),
        hLineColor: () => C.line,
        vLineColor: () => "#FFFFFF",
        hLineWidth: () => 0.75,
        vLineWidth: () => 2,
        paddingTop: () => 6, paddingBottom: () => 6,
        paddingLeft: () => 10, paddingRight: () => 10
      },
      margin: [0, 0, 0, 4]
    });

    // ---- summary chips ----
    content.push({
      columns: [
        { width: "*", text: "" },
        this._chip(`${results.length} parameters`, C.brand, C.brandSoft),
        abnormalCount ? this._chip(`${abnormalCount} abnormal`, C.warn, C.warnBg) : null,
        anyCritical ? this._chip("CRITICAL VALUES", C.crit, C.critBg) : null
      ].filter(Boolean),
      columnGap: 6,
      margin: [0, 8, 0, 4]
    });

    // ---- result sections ----
    for (const [name, items] of Object.entries(grouped)) {
      content.push({
        text: name.toUpperCase(),
        style: "sectionHeader",
        margin: [0, 12, 0, 0]
      });

      const body = [
        [
          { text: "PARAMETER", style: "th" },
          { text: "RESULT", style: "th", alignment: "right" },
          { text: "UNIT", style: "th" },
          { text: "REFERENCE", style: "th" },
          { text: "FLAG", style: "th", alignment: "center" }
        ]
      ];

      items.forEach((r) => {
        const meta = this._flagMeta(r.flag || r.Flag);
        const value = (r.result_value != null ? r.result_value : r.ResultValue);
        const unit = r.unit || r.Unit || r.ParamUnit || "";
        const pname = r.parameter_name || r.ParameterName || "";
        const shownVal = (value != null && value !== "") ? String(value) : "—";

        // Result cell: value + a small uppercase H/L/HH/LL marker (Roboto-safe;
        // the old ↑↑/↓↓ glyphs aren't in Roboto and rendered as boxes).
        const valueCell = meta.marker
          ? { text: [ { text: shownVal + " ", color: meta.color, bold: true }, { text: meta.marker, color: meta.color, bold: true, fontSize: 7.5 } ], alignment: "right", fontSize: 10 }
          : { text: shownVal, color: meta.color, bold: meta.abnormal, alignment: "right", fontSize: 10 };

        body.push([
          { text: pname, style: "td", color: meta.abnormal ? C.ink : C.body },
          valueCell,
          { text: unit || "", style: "tdMuted" },
          { text: this._range(r), style: "tdMuted" },
          this._flagPill(meta)
        ]);
      });

      content.push({
        table: { headerRows: 1, widths: ["*", "auto", "auto", "auto", "auto"], body },
        layout: {
          fillColor: (ri) => (ri === 0 ? C.brand : (ri % 2 === 0 ? C.band : null)),
          hLineColor: () => C.line,
          vLineColor: () => C.line,
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.75 : 0.5),
          vLineWidth: () => 0,
          paddingTop: () => 5, paddingBottom: () => 5,
          paddingLeft: () => 9, paddingRight: () => 9
        },
        margin: [0, 4, 0, 0]
      });
    }

    // ---- critical alert ----
    if (anyCritical) {
      content.push({
        table: { widths: ["*"], body: [[{
          stack: [
            { text: "CRITICAL ALERT", bold: true, color: C.crit, fontSize: 10, characterSpacing: 0.5 },
            { text: "One or more results are in the critical range. Immediate clinical correlation is required.", color: C.crit, fontSize: 8.5, margin: [0, 2, 0, 0] }
          ]
        }]] },
        layout: {
          fillColor: () => C.critBg,
          hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0),
          vLineColor: () => C.crit,
          paddingTop: () => 8, paddingBottom: () => 8, paddingLeft: () => 12, paddingRight: () => 12
        },
        margin: [0, 14, 0, 0]
      });
    }

    // ---- signatures ----
    // ---- signatures (kept together; won't split across pages) ----
    content.push({
      unbreakable: true,
      columns: [
        this._signatory(report.created_by_name || report.CreatedByName, "Technician", "Prepared by"),
        this._signatory(report.verified_by_name || report.VerifiedByName, "Senior Technician", "Verified by"),
        this._signatory(report.approved_by_name || report.ApprovedByName, "Pathologist", "Approved by")
      ],
      columnGap: 18,
      margin: [0, 36, 0, 0]
    });

    content.push({
      text: "This is a computer-generated report based on the sample received and analysed at our laboratory. Results should be clinically correlated. Valid only with laboratory seal and authorised signatures.",
      style: "disclaimer",
      margin: [0, 18, 0, 0]
    });

    // ---- assemble ----
    return {
      pageSize: "A4",
      pageMargins: [38, 116, 38, 64],
      defaultStyle: { font: "Roboto", fontSize: 9.5, color: C.body, lineHeight: 1.15 },

      header: () => this._pageHeader(labInfo),
      footer: (current, total) => this._pageFooter(current, total, reportNo),

      content,

      styles: {
        pLabel: { fontSize: 7.5, bold: true, color: C.muted, characterSpacing: 0.4 },
        pValue: { fontSize: 9.5, color: C.body },
        pValueStrong: { fontSize: 9.5, bold: true, color: C.ink },
        sectionHeader: { fontSize: 9, bold: true, color: C.brand, characterSpacing: 0.6 },
        th: { fontSize: 7.5, bold: true, color: "#FFFFFF", characterSpacing: 0.4 },
        td: { fontSize: 9.5, color: C.body },
        tdValue: { fontSize: 10, bold: false },
        tdMuted: { fontSize: 8.5, color: C.muted },
        disclaimer: { fontSize: 7.5, color: C.muted, italics: true, alignment: "center", lineHeight: 1.3 }
      }
    };
  }

  /* -------------------------- fragments ------------------------------- */

  _pLabel(t) { return { text: t.toUpperCase(), style: "pLabel" }; }

  _chip(text, color, bg) {
    return {
      width: "auto",
      table: { body: [[{ text, color, fontSize: 7.5, bold: true, characterSpacing: 0.3 }]] },
      layout: {
        fillColor: () => bg, hLineWidth: () => 0, vLineWidth: () => 0,
        paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 8, paddingRight: () => 8
      }
    };
  }

  _flagPill(meta) {
    if (!meta.abnormal && meta.label === "NORMAL") {
      return { text: "Normal", style: "tdMuted", color: C.ok, alignment: "center", fontSize: 8 };
    }
    if (meta.label === "PENDING") {
      return { text: "Pending", style: "tdMuted", alignment: "center", fontSize: 8 };
    }
    return {
      table: { body: [[{ text: meta.label, color: meta.color, fontSize: 7, bold: true, alignment: "center" }]] },
      layout: {
        fillColor: () => meta.bg, hLineWidth: () => 0, vLineWidth: () => 0,
        paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 6, paddingRight: () => 6
      },
      alignment: "center"
    };
  }

  _signatory(name, role, caption) {
    return {
      width: "*",
      stack: [
        name ? { text: name, alignment: "center", fontSize: 9, bold: true, color: C.ink, margin: [0, 0, 0, 2] }
             : { text: " ", fontSize: 9, margin: [0, 0, 0, 2] },
        { canvas: [{ type: "line", x1: 20, y1: 0, x2: 130, y2: 0, lineWidth: 0.75, lineColor: C.body }], alignment: "center" },
        { text: role, alignment: "center", fontSize: 9, bold: true, color: C.body, margin: [0, 5, 0, 0] },
        { text: caption, alignment: "center", fontSize: 7.5, color: C.muted, margin: [0, 1, 0, 0] }
      ]
    };
  }

  _pageHeader(labInfo) {
    const initials = (labInfo.name || "PL").split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
    return {
      margin: [38, 22, 38, 0],
      stack: [
        {
          columns: [
            // logo mark (initials in a rounded brand square)
            {
              width: 46,
              stack: [{
                table: { body: [[{ text: initials, color: "#FFFFFF", bold: true, fontSize: 16, alignment: "center", margin: [0, 9, 0, 9] }]] },
                layout: { fillColor: () => C.brand, hLineWidth: () => 0, vLineWidth: () => 0 }
              }]
            },
            {
              width: "*",
              stack: [
                { text: labInfo.name || "PATHOLOGY LABORATORY", fontSize: 16, bold: true, color: C.ink },
                { text: labInfo.address || "Laboratory Address", fontSize: 8, color: C.muted, margin: [0, 1, 0, 0] },
                {
                  text: [
                    labInfo.phone ? `Phone ${labInfo.phone}` : null,
                    labInfo.email ? `  ·  ${labInfo.email}` : null
                  ].filter(Boolean).join(""),
                  fontSize: 8, color: C.muted, margin: [0, 1, 0, 0]
                }
              ],
              margin: [10, 0, 0, 0]
            },
            {
              width: "auto",
              stack: [
                { text: "LABORATORY REPORT", fontSize: 8, bold: true, color: C.brand, alignment: "right", characterSpacing: 0.5 },
                labInfo.nabl !== false ? {
                  table: { body: [[{ text: "NABL ACCREDITED", color: "#FFFFFF", fontSize: 6.5, bold: true, alignment: "center" }]] },
                  layout: { fillColor: () => C.ok, hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 6, paddingRight: () => 6 },
                  margin: [0, 4, 0, 0], alignment: "right"
                } : {}
              ],
              alignment: "right"
            }
          ]
        },
        { canvas: [{ type: "line", x1: 0, y1: 8, x2: 519, y2: 8, lineWidth: 1.5, lineColor: C.brand }] }
      ]
    };
  }

  _pageFooter(current, total, reportNo) {
    return {
      margin: [38, 12, 38, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 519, y2: 0, lineWidth: 0.5, lineColor: C.line }] },
        {
          columns: [
            { text: reportNo, fontSize: 7.5, color: C.muted, alignment: "left", margin: [0, 5, 0, 0] },
            { text: "Generated by SmartLab", fontSize: 7.5, color: C.muted, alignment: "center", margin: [0, 5, 0, 0] },
            { text: `Page ${current} of ${total}`, fontSize: 7.5, color: C.muted, alignment: "right", margin: [0, 5, 0, 0] }
          ]
        }
      ]
    };
  }
}

module.exports = PDFService;