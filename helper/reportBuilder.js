// helper/reportBuilder.js — FINAL v4
// Two completely separate HTML builders:
//   buildHtmlForBrowser(data, mode)     — html2pdf.js (no Puppeteer)
//   buildHtmlForPuppeteer(data)         — Puppeteer only
// Zero shared assumptions about width, margins, or layout
'use strict';

const fs   = require('fs');
const path = require('path');

const BRAND = {
    name:            process.env.BRAND_NAME               || 'RANJANA IMAGING AND MEDICAL SOLUTIONS',
    tagline:         process.env.BRAND_TAGLINE            || 'A Unit of R.S & J.P. Healthcare Pvt. Ltd.',
    address:         process.env.BRAND_ADDRESS            || 'G1/A, Baidyanath Palace, Pillar No. 10, Jagdeo Path, Bailey Road, Patna – 800014',
    phone:           process.env.BRAND_PHONE              || '+91-612-000-0000',
    email:           process.env.BRAND_EMAIL              || 'reports@jpdiagnostic.in',
    headerImagePath: process.env.BRAND_HEADER_IMAGE_PATH  || './images/JpHeaderF.jpg',
    footerImagePath: process.env.BRAND_FOOTER_IMAGE_PATH  || './images/JpFooter.jpg',
    headerHeightMm:  parseFloat(process.env.BRAND_HEADER_HEIGHT_MM  || '35'),
    footerHeightMm:  parseFloat(process.env.BRAND_FOOTER_HEIGHT_MM  || '20'),
    lineHeight:      process.env.BRAND_CONTENT_LINE_HEIGHT || '1.4',
    disclaimer:      process.env.BRAND_FOOTER_DISCLAIMER  || 'This report is confidential and intended solely for the referring physician.',
};

const USE_PUPPETEER = process.env.USE_PUPPETEER === 'true';

// ── Helpers ──────────────────────────────────────────────────
const imageToBase64 = (filePath) => {
    try {
        if (!filePath) return null;
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) return null;
        const ext  = path.extname(filePath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        return `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`;
    } catch { return null; }
};

const fmt = (v) => (v != null && v !== '' ? String(v) : '—');

const toTitleCase = (str) => {
    if (!str || str === '—') return str;
    return str.toLowerCase().split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const fmtDate = (v) => {
    if (!v) return '—';
    try {
        const d = new Date(v);
        if (isNaN(d)) return String(v);
        return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    } catch { return String(v); }
};

const safeName = (v) =>
    (v || 'Patient').replace(/\s+/g, '_').replace(/[^\w_-]/g, '');

const cleanReportHtml = (html) => {
    if (!html) return '';
    return html
        .replace(/border\s*:\s*[^;"']+/gi, '')
        .replace(/border-\w+\s*:\s*[^;"']+/gi, '')
        .replace(/\s+border=["'][^"']*["']/gi, '')
        .replace(/background\s*:\s*[^;"']+/gi, '')
        .replace(/background-color\s*:\s*[^;"']+/gi, '')
        .replace(/bgcolor=["'][^"']*["']/gi, '')
        .replace(/\s+style=["']\s*["']/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
};

const sanitizeForDoc = (html) => {
    if (!html) return '';
    return html
        .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+class="[^"]*"/gi, '')
        .replace(/width\s*:\s*\d+(\.\d+)?%/gi, '')
        .replace(/width\s*:\s*auto/gi, '')
        .replace(/border\s*:\s*[^;"']+/gi, '')
        .replace(/background[^:]*:\s*[^;"']+/gi, '')
        .replace(/\s+style=["']\s*["']/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
};

// ── Shared data helpers ───────────────────────────────────────
const getPatientData = (data) => {
    const genderMap  = {'1':'Male','2':'Female','1.0':'Male','2.0':'Female'};
    return {
        gender:     genderMap[String(data.Gender)] || fmt(data.Gender),
        ageDisplay: data.Age ? `${data.Age} ${data.YMD||'Yrs'}` : '—',
        reportDate: data.FinalizedAtFormatted || fmtDate(data.RegisteredOn),
        patName:    toTitleCase(`${fmt(data.Title)} ${fmt(data.Name)}`.trim()),
        docName:    toTitleCase(fmt(data.DoctorName)),
        phone:      fmt(data.PhoneNumber),
        specialty:  data.DoctorSpeciality ? fmt(data.DoctorSpeciality) : '',
    };
};

const getFinalizingDoctor = (data) =>
    (data.doctors||[]).find(d => String(d.Id) === String(data.finalizedById))
    || (data.doctors||[])[0]
    || null;

// ═══════════════════════════════════════════════════════════
// ── BUILDER A: html2pdf.js (browser-side) ────────────────
// Width: 595px (A4 at 72dpi — what jsPDF uses internally)
// No header/footer in HTML — stamped by jsPDF.addImage after render
// mode: 'download' = with header/footer stamps
//       'print'    = no stamps, @page margins leave space for pad
// ═══════════════════════════════════════════════════════════
const buildHtmlForBrowser = (data, mode) => {
    const isPrint   = mode === 'print';
    const { gender, ageDisplay, reportDate, patName, docName, phone, specialty } = getPatientData(data);
    const filename  = `Report_${safeName(data.Name)}_${safeName(data.TestName)}.pdf`;
    const headerB64 = imageToBase64(BRAND.headerImagePath);
    const footerB64 = imageToBase64(BRAND.footerImagePath);
    const hH        = BRAND.headerHeightMm;
    const fH        = BRAND.footerHeightMm;
    const lh        = BRAND.lineHeight;

    // Doctor signatures
    const doctors    = data.doctors || [];
    const finId      = data.finalizedById;
    const doctorHtml = doctors.map(doc => {
        const name  = toTitleCase(`${doc.FirstName||''} ${doc.LastName||''}`.trim());
        const deg   = doc.Qualification || '';
        const isFin = String(doc.Id) === String(finId);
        let sig     = '<div style="height:38px;"></div>';
        if (isFin && doc.SignaturePath) {
            const b64 = imageToBase64(doc.SignaturePath);
            if (b64) sig = `<img src="${b64}" style="display:block;height:38px;max-width:140px;object-fit:contain;margin-bottom:2px;" />`;
        }
        return `<div style="flex:0 0 auto;min-width:140px;margin-right:28px;">
            ${sig}
            <div style="border-top:1px solid #333;width:140px;margin-bottom:3px;"></div>
            <div style="font-size:8.5pt;font-weight:700;">Dr. ${name}</div>
            ${deg?`<div style="font-size:7.5pt;color:#444;margin-top:1px;">${deg}</div>`:''}
            <div style="font-size:7pt;color:#666;font-style:italic;margin-top:1px;">Radiologist</div>
        </div>`;
    }).join('');

    const downloadScript = !isPrint ? `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
window.addEventListener('load', function () {
    setTimeout(function () {
        // 595px = A4 width at 72dpi (jsPDF internal unit)
        // windowWidth must exactly match body width
        var opt = {
            margin:      [${hH},12, ${fH}, 12],
            filename:    '${filename}',
            image:       { type:'jpeg', quality:0.98 },
            html2canvas: { scale:2, useCORS:true, logging:false, windowWidth:595 },
            jsPDF:       { unit:'mm', format:'a4', orientation:'portrait' },
            pagebreak:   { mode:['css','legacy'], avoid:'.no-break' }
        };
        html2pdf().set(opt).from(document.getElementById('rr'))
            .toPdf().get('pdf').then(function(pdf){
                var n  = pdf.internal.getNumberOfPages();
                var pw = pdf.internal.pageSize.getWidth();
                var ph = pdf.internal.pageSize.getHeight();
                ${headerB64 && !isPrint ? `
                for(var i=1;i<=n;i++){
                    pdf.setPage(i);
                    pdf.addImage('${headerB64}','JPEG',0,0,pw,${hH});
                }` : ''}
                ${footerB64 && !isPrint ? `
                for(var j=1;j<=n;j++){
                    pdf.setPage(j);
                    pdf.addImage('${footerB64}','JPEG',0,ph-${fH},pw,${fH});
                }` : ''}
                pdf.save('${filename}');
                setTimeout(function(){window.close();},800);
            });
    }, 600);
});
</script>` : `<script>window.addEventListener('load',function(){window.print();});</script>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${patName}</title>
<style>
@page {
    size: A4;
    margin-top: ${hH}mm;
    margin-bottom: ${fH}mm;
    margin-left: 10mm;
    margin-right: 10mm;
}
* { box-sizing:border-box; margin:0; padding:0; }
body {
    font-family: 'Segoe UI',Arial,sans-serif;
    font-size: 9pt;
    line-height: ${lh};
    color: #111;
    background: #fff;
    /* 595px = A4 at 72dpi — matches jsPDF internal width exactly */
    width: 595px;
    margin: 0 auto;
}
#rr { width:100%; }
table { border-collapse:collapse; }

/* Patient block */
.pt { width:100%; font-size:8.5pt; border-bottom:1.5px solid #1a3a6e; margin-bottom:0; }
.pt td { padding:2px 5px 2px 0; vertical-align:top; }
.pt .lbl { font-size:7pt; font-weight:600; color:#555; text-transform:uppercase; letter-spacing:0.3px; width:19%; white-space:nowrap; }
.pt .name { font-size:10.5pt; font-weight:700; color:#1a3a6e; }
.pt .val { font-size:8.5pt; color:#111; }

/* Report body */
.rb { font-size:9pt; line-height:${lh}; margin-top:6px; }
.rb * { background:transparent!important; }
.rb p { margin-bottom:2px; text-align:justify; }
.rb strong { font-weight:700; }
.rb h1 { font-size:9.5pt; font-weight:700; color:#1a3a6e; text-align:center; text-transform:uppercase; margin:4px 0 2px; }
.rb h2 { font-size:9pt; font-weight:700; color:#1a3a6e; border-bottom:1px solid #ddd; padding-bottom:1px; margin:4px 0 2px; }
.rb h3 { font-size:8.5pt; font-weight:700; margin:3px 0 1px; }
.rb ul,.rb ol { margin:2px 0 3px 16px; }
.rb li { margin-bottom:1px; }
.rb table { width:100%; margin:2px 0; font-size:8.5pt; }
.rb table td,.rb table th { padding:2px 5px; vertical-align:top; }
.rb table th { font-weight:700; color:#1a3a6e; border-bottom:1px solid #ddd; font-size:8pt; text-transform:uppercase; }
.rb img { max-width:100%; height:auto; display:block; }

.no-break { page-break-inside:avoid; break-inside:avoid; }
.sig { margin-top:14px; }

@media screen {
    body { background:#777; }
    #rr { background:#fff; padding:10px; margin:10px auto; box-shadow:0 2px 12px rgba(0,0,0,.3); }
}
@media print { body { background:#fff; } }
</style>
</head>
<body>
<div id="rr">

<table class="pt">
    <tr>
        <td class="lbl">Patient Name</td>
        <td class="name">${patName}<br><span style="font-size:6pt;color:#666;font-style:italic;display:block;">${phone}</span></td>
        <td class="lbl">Age / Gender</td>
        <td class="val">${ageDisplay} / ${gender}</td>
    </tr>
    <tr>
        <td class="lbl">Referred By</td>
        <td class="val" >Dr. ${docName}${specialty?`<span style="font-size:7pt;color:#666;font-style:italic;display:block;">${specialty}</span>`:''}</td>
        <td class="lbl">Report Date</td>
        <td class="val">${reportDate}</td>
    </tr>
</table>


<div class="rb">
    ${cleanReportHtml(data.Report)||'<p style="color:#aaa;text-align:center;">No content</p>'}
</div>

<div class="sig no-break">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;">
        ${doctorHtml}
    </div>
</div>

</div>
${downloadScript}
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════
// ── BUILDER B: Puppeteer (server-side) ───────────────────
// Width: full A4 (Puppeteer sets its own viewport)
// Header/footer: Puppeteer displayHeaderFooter handles them natively
// No width hacks, no jsPDF, clean HTML
// ═══════════════════════════════════════════════════════════
const buildHtmlForPuppeteerttt = (data) => {
    const { gender, ageDisplay, reportDate, patName, docName, phone, specialty } = getPatientData(data);
    const lh      = BRAND.lineHeight;
    const doctors = data.doctors || [];
    const finId   = data.finalizedById;

    const doctorHtml = doctors.map(doc => {
        const name  = toTitleCase(`${doc.FirstName||''} ${doc.LastName||''}`.trim());
        const deg   = doc.Qualification || '';
        const isFin = String(doc.Id) === String(finId);
        let sig     = '<div style="height:42px;"></div>';
        if (isFin && doc.SignaturePath) {
            const b64 = imageToBase64(doc.SignaturePath);
            if (b64) sig = `<img src="${b64}" style="display:block;height:42px;max-width:160px;object-fit:contain;margin-bottom:3px;" />`;
        }
        return `<div style="display:inline-block;vertical-align:bottom;min-width:160px;margin-right:36px;">
            ${sig}
            <div style="border-top:1.5px solid #333;width:160px;margin-bottom:4px;"></div>
            <div style="font-size:10pt;font-weight:700;color:#111;">Dr. ${name}</div>
            ${deg?`<div style="font-size:9pt;color:#444;margin-top:2px;">${deg}</div>`:''}
            <div style="font-size:8.5pt;color:#666;font-style:italic;margin-top:2px;">Radiologist</div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10pt;
    line-height: ${lh};
    color: #111;
    background: #fff;
    /* Puppeteer uses full A4 width minus margins — let it flow naturally */
}

/* Patient block — full width table, explicit columns */
.pt {
    width: 100%;
    border-collapse: collapse;
    border-bottom: 2px solid #1a3a6e;
    margin-bottom: 0;
    font-size: 9.5pt;
    table-layout: fixed;
}
.pt td { padding: 3px 8px 3px 0; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
.pt .lbl { font-size: 8pt; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.3px; width: 120px; white-space: nowrap; }
.pt .name { font-size: 12pt; font-weight: 700; color: #1a3a6e; word-wrap: break-word; overflow-wrap: break-word; }
.pt .val  { font-size: 9.5pt; color: #111; }

/* Report body */
.rb { font-size: 10pt; line-height: ${lh}; margin-top: 10px; }
.rb * { background: transparent !important; }
.rb p { margin-bottom: 4px; text-align: justify; }
.rb strong { font-weight: 700; }
.rb h1 { font-size: 11pt; font-weight: 700; color: #1a3a6e; text-align: center; text-transform: uppercase; margin: 6px 0 4px; }
.rb h2 { font-size: 10pt; font-weight: 700; color: #1a3a6e; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin: 6px 0 4px; }
.rb h3 { font-size: 9.5pt; font-weight: 700; margin: 5px 0 2px; }
.rb ul, .rb ol { margin: 3px 0 5px 20px; }
.rb li { margin-bottom: 2px; }
.rb table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 9.5pt; }
.rb table td, .rb table th { border: none; padding: 3px 8px; vertical-align: top; }
.rb table th { font-weight: 700; color: #1a3a6e; border-bottom: 1.5px solid #ddd; font-size: 9pt; text-transform: uppercase; }
.rb img { max-width: 100%; height: auto; display: block; }

.sig { margin-top: 20px; page-break-inside: avoid; }
</style>
</head>
<body>

<table class="pt">
    <colgroup>
        <col style="width:120px;" />
        <col />
        <col style="width:120px;" />
        <col />
    </colgroup>
    <tr>
        <td class="lbl">Patient Name</td>
        <td class="name">${patName}<br/><span style="font-size:6pt;color:#666;font-style:italic;">${phone}</span></td>
        <td class="lbl">Age / Gender</td>
        <td class="val">${ageDisplay} / ${gender}</td>
    </tr>
    <tr>
        <td class="lbl">Referred By</td>
        <td class="val">Dr. ${docName}${specialty?`<br/><span style="font-size:8pt;color:#666;font-style:italic;">${specialty}</span>`:''}</td>
        <td class="lbl">Report Date</td>
        <td class="val">${reportDate}</td>
    </tr>
</table>

<div class="rb">
    ${cleanReportHtml(data.Report)||'<p style="color:#aaa;text-align:center;">No content</p>'}
</div>

<div class="sig">
    ${doctorHtml}
</div>

</body>
</html>`;
};


// ═══════════════════════════════════════════════════════════
// ── BUILDER C: PRINT on the pre-printed letterhead pad ───
// ★ Separate from html2pdf: the old print view reused the 595px html2pdf body, so in a real
//   browser print the content was squeezed into the left ~80% of the page and the patient
//   block was a border-less strip. Here the page is sized in mm for A4 and the patient
//   details are a bordered, fixed-column table.
// Pad blank space: BRAND_PRINT_TOP_MM / BRAND_PRINT_BOTTOM_MM (default = header/footer height),
//                  BRAND_PRINT_SIDE_MM (default 12).
// ═══════════════════════════════════════════════════════════
const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PRINT = {
    topMm:    parseFloat(process.env.BRAND_PRINT_TOP_MM    || BRAND.headerHeightMm),
    bottomMm: parseFloat(process.env.BRAND_PRINT_BOTTOM_MM || BRAND.footerHeightMm),
    sideMm:   parseFloat(process.env.BRAND_PRINT_SIDE_MM   || '12'),
};

const buildHtmlForPrint = (data) => {
    const { gender, ageDisplay, reportDate, patName, docName, phone, specialty } = getPatientData(data);
    const lh  = BRAND.lineHeight;
    const val = (v) => (v && v !== '—' ? esc(v) : '—');

    const refBy = data.DoctorName && String(data.DoctorName).trim()
        ? `Dr. ${esc(docName)}${specialty ? `<span class="sub">${esc(specialty)}</span>` : ''}`
        : 'Self';

    // Only the doctor who FINALIZED (signed) the report — not every doctor in the system
    const fin = (data.doctors || []).find(d => String(d.Id) === String(data.finalizedById)) || null;
    let sigHtml = '';
    if (fin || data.FinalizedByName) {
        const name = toTitleCase(fin ? `${fin.FirstName || ''} ${fin.LastName || ''}`.trim() : String(data.FinalizedByName));
        const deg  = (fin && fin.Qualification) || data.ReportingDoctorDegree || '';
        const b64  = imageToBase64((fin && fin.SignaturePath) || data.ReportingDoctorSigPath);
        sigHtml = `<div class="sig no-break">
            ${b64 ? `<img src="${b64}" alt="" />` : '<div class="sig-space"></div>'}
            <div class="sig-name">Dr. ${esc(name)}</div>
            ${deg ? `<div class="sig-deg">${esc(deg)}</div>` : ''}
            <div class="sig-role">${esc(process.env.BRAND_SIGN_ROLE || 'Radiologist')}</div>
        </div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(patName)} - ${esc(data.TestName || 'Report')}</title>
<style>
@page { size: A4 portrait; margin: ${PRINT.topMm}mm ${PRINT.sideMm}mm ${PRINT.bottomMm}mm ${PRINT.sideMm}mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10.5pt; line-height: ${lh}; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
#rr { width: 100%; }

/* ── Patient details table ── */
table.pt {
    width: 100%; border-collapse: collapse; table-layout: fixed;
    border: 1px solid #000; font-size: 10pt; margin-bottom: 4mm;
}
table.pt td { border: 1px solid #000; padding: 1.4mm 2mm; vertical-align: top; overflow-wrap: anywhere; }
table.pt td.lbl { width: 17%; font-weight: 700; background: #f0f0f0; white-space: nowrap; }
table.pt td.v   { width: 33%; }
table.pt .pname { font-weight: 700; font-size: 11pt; }
table.pt .sub   { display: block; font-size: 8.5pt; color: #333; }

/* ── Test title ── */
.tt { text-align: center; font-weight: 700; font-size: 11.5pt; text-transform: uppercase;
      text-decoration: underline; margin: 0 0 3mm; }

/* ── Report body (doctor's text) ── */
.rb { font-size: 10.5pt; line-height: ${lh}; }
.rb * { background: transparent !important; }
.rb p { margin-bottom: 1.2mm; text-align: justify; }
.rb h1 { font-size: 11.5pt; text-align: center; text-transform: uppercase; margin: 2mm 0 1.5mm; }
.rb h2 { font-size: 11pt; margin: 2mm 0 1mm; }
.rb h3 { font-size: 10.5pt; margin: 1.5mm 0 1mm; }
.rb ul, .rb ol { margin: 1mm 0 1.5mm 6mm; }
.rb li { margin-bottom: 0.6mm; }
.rb table { width: 100%; border-collapse: collapse; margin: 1.5mm 0; font-size: 10pt; }
.rb table td, .rb table th { padding: 1mm 2mm; vertical-align: top; text-align: left; }
.rb table th { border-bottom: 1px solid #000; }
.rb img { max-width: 100%; height: auto; }

/* ── Signature (right side) ── */
.sig { margin-top: 10mm; margin-left: auto; width: 60mm; text-align: center; }
.sig img { display: block; height: 16mm; max-width: 55mm; object-fit: contain; margin: 0 auto 1mm; }
.sig-space { height: 16mm; }
.sig-name { border-top: 1px solid #000; padding-top: 1mm; font-weight: 700; }
.sig-deg  { font-size: 9pt; }
.sig-role { font-size: 9pt; font-style: italic; }

.no-break { page-break-inside: avoid; break-inside: avoid; }
table.pt, table.pt tr { page-break-inside: avoid; break-inside: avoid; }

/* On screen: show an A4 sheet with the pad's blank areas, so it looks like the print */
@media screen {
    html { background: #888; }
    body { width: 210mm; min-height: 297mm; margin: 8mm auto; background: #fff;
           padding: ${PRINT.topMm}mm ${PRINT.sideMm}mm ${PRINT.bottomMm}mm; box-shadow: 0 2px 14px rgba(0,0,0,.35); }
}
</style>
</head>
<body>
<div id="rr">

<table class="pt">
    <tr>
        <td class="lbl">Patient Name</td>
        <td class="v"><span class="pname">${val(patName)}</span></td>
        <td class="lbl">Bill No.</td>
        <td class="v">${val(data.PatientId)}</td>
    </tr>
    <tr>
        <td class="lbl">Age / Sex</td>
        <td class="v">${val(ageDisplay)} / ${val(gender)}</td>
        <td class="lbl">Report Date</td>
        <td class="v">${val(reportDate)}</td>
    </tr>
    <tr>
        <td class="lbl">Referred By</td>
        <td class="v">${refBy}</td>
        <td class="lbl">Mobile No.</td>
        <td class="v">${val(phone)}</td>
    </tr>
    <tr>
        <td class="lbl">Investigation</td>
        <td class="v" colspan="3">${val(data.TestName)}</td>
    </tr>
</table>

<div class="rb">
    ${cleanReportHtml(data.Report) || '<p style="text-align:center;">No content</p>'}
</div>

${sigHtml}

</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body>
</html>`;
};

// ═══════════════════════════════════════════════════════════
// buildHtmlLayout — unified entry point used by controller
// Routes to the correct builder based on mode
// ═══════════════════════════════════════════════════════════
const buildHtmlLayout = (data, mode = 'download') => {
    // ★ print → its own A4 builder (bordered patient table, full page width)
    if (mode === 'print') return buildHtmlForPrint(data);
    // Puppeteer uses its own builder — this path only for html2pdf
    return buildHtmlForBrowser(data, mode);
};


// ═══════════════════════════════════════════════════════════
// DOCX — unchanged, px widths only
// ═══════════════════════════════════════════════════════════
const buildDocxHtml = (data) => {
    const { gender, ageDisplay, reportDate, patName, docName, phone, specialty } = getPatientData(data);
    const finDoctor = getFinalizingDoctor(data);
    const finName   = finDoctor
        ? `Dr. ${toTitleCase(`${finDoctor.FirstName||''} ${finDoctor.LastName||''}`.trim())}`
        : (data.FinalizedByName?`Dr. ${data.FinalizedByName}`:'');
    const finDegree = finDoctor?(finDoctor.Qualification||''):'';
    const bodyHtml  = sanitizeForDoc(data.Report)||'<p>No report content.</p>';

    const lbl     = `font-family:Arial,sans-serif;font-size:8pt;font-weight:bold;color:#555;text-transform:uppercase;letter-spacing:0.3px;padding:3px 6px 3px 0;vertical-align:top;width:112px;white-space:nowrap;`;
    const val     = `font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:3px 6px 3px 0;vertical-align:top;width:143px;`;
    const valFull = `font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:3px 6px 3px 0;vertical-align:top;`;

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'Times New Roman',Times,serif;font-size:11pt;margin:0;padding:0;color:#111;line-height:1.45;">
<table style="width:600px;border-collapse:collapse;margin-top:5px;margin-bottom:0;">
    <tr>
        <td style="${lbl}">Patient Name</td>
        <td style="font-family:Arial,sans-serif;font-size:11pt;font-weight:bold;color:#1a3a6e;padding:3px 6px 3px 0;vertical-align:top;">${patName}<br/><span>${phone}</span></td>
        <td style="${lbl}">Age / Gender</td>
        <td style="${val}">${ageDisplay} / ${gender}</td>
    </tr>
    <tr>
        <td style="${lbl}">Referred By</td>
        <td style="${val}">Dr. ${docName}${specialty?` (${specialty})`:''}</td>
        <td style="${lbl}">Report Date</td>
        <td style="${valFull}">${reportDate}</td>
    </tr>
</table>
<div style="border-top:1px solid;margin:6px 0 8px;font-size:0;">&nbsp;</div>
<div style="font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.4;color:#111;">
${bodyHtml}
</div>
<table style="width:160px;border-collapse:collapse;margin-top:50px">
    <tr><td style="padding-top:4px;vertical-align:top;">
        ${finName?`<p style="font-family:Arial,sans-serif;font-size:11pt;font-weight:bold;margin:0;">${finName}</p>`:''}
        ${finDegree?`<p style="font-family:Arial,sans-serif;font-size:9.5pt;color:#555;margin:1px 0 0;">${finDegree}</p>`:''}
        <p style="font-family:Arial,sans-serif;font-size:8pt;color:#777;font-style:italic;margin:1px 0 0;">Radiologist</p>
    </td></tr>
</table>
</body></html>`;
};


// Replace buildHtmlForPuppeteer and generatePdfWithPuppeteer
// in helper/reportBuilder.js
//
// Fix: use position:fixed for header/footer INSIDE the HTML
//      and displayHeaderFooter: false in Puppeteer
//      This way Puppeteer renders header/footer as part of the page
//      and @page margins push content down correctly
//      Patient name is never overlapped

const buildHtmlForPuppeteer = (data) => {
    const genderMap  = {'1':'Male','2':'Female','1.0':'Male','2.0':'Female'};
    const gender     = genderMap[String(data.Gender)] || fmt(data.Gender);
    const ageDisplay = data.Age ? `${data.Age} ${data.YMD||'Yrs'}` : '—';
    const reportDate = data.FinalizedAtFormatted || fmtDate(data.RegisteredOn);
    const patName    = toTitleCase(`${fmt(data.Title)} ${fmt(data.Name)}`.trim());
    const docName    = toTitleCase(fmt(data.DoctorName));
    const phone      = fmt(data.PhoneNumber);
    const specialty  = data.DoctorSpeciality ? fmt(data.DoctorSpeciality) : '';

    const lh        = BRAND.lineHeight;
    const hH        = BRAND.headerHeightMm;
    const fH        = BRAND.footerHeightMm;
    const headerB64 = imageToBase64(BRAND.headerImagePath);
    const footerB64 = imageToBase64(BRAND.footerImagePath);

    const doctors    = data.doctors || [];
    const finId      = data.finalizedById;

    const doctorHtml = doctors.map(doc => {
        const name  = toTitleCase(`${doc.FirstName||''} ${doc.LastName||''}`.trim());
        const deg   = doc.Qualification || '';
        const isFin = String(doc.Id) === String(finId);
        let sig     = '<div style="height:42px;"></div>';
        if (isFin && doc.SignaturePath) {
            const b64 = imageToBase64(doc.SignaturePath);
            if (b64) sig = `<img src="${b64}" style="display:block;height:42px;max-width:160px;object-fit:contain;margin-bottom:3px;" />`;
        }
        return `<div style="display:inline-block;vertical-align:bottom;min-width:160px;margin-right:36px;">
            ${sig}
            <div style="border-top:1.5px solid #333;width:160px;margin-bottom:4px;"></div>
            <div style="font-size:10pt;font-weight:700;color:#111;">Dr. ${name}</div>
            ${deg?`<div style="font-size:9pt;color:#444;margin-top:2px;">${deg}</div>`:''}
            <div style="font-size:8.5pt;color:#666;font-style:italic;margin-top:2px;">Radiologist</div>
        </div>`;
    }).join('');

    // Header HTML — position:fixed, top:0, full width
    const headerHtml = headerB64
        ? `<div style="position:fixed;top:0;left:0;right:0;width:100%;height:${hH}mm;line-height:0;z-index:9999;">
               <img src="${headerB64}" style="width:100%;height:${hH}mm;object-fit:fill;display:block;" />
           </div>`
        : `<div style="position:fixed;top:0;left:0;right:0;width:100%;height:${hH}mm;background:#1a3a6e;display:flex;align-items:center;justify-content:center;z-index:9999;">
               <span style="color:#fff;font-size:14pt;font-weight:700;">${BRAND.name}</span>
           </div>`;

    // Footer HTML — position:fixed, bottom:0, full width
    const footerHtml = footerB64
        ? `<div style="position:fixed;bottom:0;left:0;right:0;width:100%;height:${fH}mm;line-height:0;z-index:9999;">
               <img src="${footerB64}" style="width:100%;height:${fH}mm;object-fit:fill;display:block;" />
           </div>`
        : `<div style="position:fixed;bottom:0;left:0;right:0;width:100%;height:${fH}mm;background:#1a3a6e;display:flex;align-items:center;justify-content:center;z-index:9999;">
               <span style="color:#fff;font-size:8pt;">${BRAND.phone} | ${BRAND.email}</span>
           </div>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing:border-box; margin:0; padding:0; }
html, body {
    width: 210mm;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10pt;
    line-height: ${lh};
    color: #111;
    background: #fff;
}

/* @page: zero margins — header/footer are inside HTML as fixed elements
   Content margin is handled by body padding below */
@page {
    size: A4;
    margin: 0;
}

/* Body padding pushes content away from fixed header/footer */
body {
    padding-top:    ${hH}mm;
    padding-bottom: ${fH}mm;
    padding-left:   12mm;
    padding-right:  12mm;
}

/* Patient block */
.pt {
    width: 100%;
    border-collapse: collapse;
    border-bottom: 2px solid #1a3a6e;
    font-size: 9.5pt;
    table-layout: fixed;
}
.pt td {
    padding: 4px 8px 4px 0;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
}
.lbl {
    font-size: 8pt;
    font-weight: 600;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    width: 22%;
    white-space: nowrap;
}
.name { font-size:10pt; font-weight:700; color:#1a3a6e; }
.val  { font-size:9.5pt; color:#111; }

/* Divider */
.div { border:none; border-top:2px solid #1a3a6e; margin:6px 0 0; }

/* Report body */
.rb { font-size:10pt; line-height:${lh}; margin-top:10px; }
.rb * { background:transparent!important; }
.rb p { margin-bottom:4px; text-align:justify; }
.rb strong { font-weight:700; }
.rb h1 { font-size:11pt; font-weight:700; color:#1a3a6e; text-align:center; text-transform:uppercase; margin:6px 0 4px; }
.rb h2 { font-size:10pt; font-weight:700; color:#1a3a6e; border-bottom:1px solid #ddd; padding-bottom:2px; margin:6px 0 4px; }
.rb h3 { font-size:9.5pt; font-weight:700; margin:5px 0 2px; }
.rb ul,.rb ol { margin:3px 0 5px 20px; }
.rb li { margin-bottom:2px; }
.rb table { width:100%; border-collapse:collapse; margin:4px 0; font-size:9.5pt; }
.rb table td,.rb table th { border:none; padding:3px 8px; vertical-align:top; }
.rb table th { font-weight:700; color:#1a3a6e; border-bottom:1.5px solid #ddd; font-size:9pt; text-transform:uppercase; }
.rb img { max-width:100%; height:auto; display:block; }

.sig { margin-top:20px; page-break-inside:avoid; }
</style>
</head>
<body>

${headerHtml}
${footerHtml}

<table class="pt">
    <colgroup>
        <col style="width:22%;" />
        <col style="width:28%;" />
        <col style="width:22%;" />
        <col style="width:28%;" />
    </colgroup>
    <tr>
        <td class="lbl">Patient Name</td>
        <td class="name" >${patName}<br/><span style="font-size:6pt;color:#666;font-style:italic;">${phone}</span></td>
        <td class="lbl">Age /Gender</td>
        <td class="val">${ageDisplay} / ${gender}</td>
    </tr>

    <tr>
        <td class="lbl">Referred By</td>
        <td class="val">Dr. ${docName}${specialty?`<br/><span style="font-size:8pt;color:#666;font-style:italic;">${specialty}</span>`:''}</td>
        <td class="lbl">Report Date</td>
        <td class="val" colspan="3">${reportDate}</td>
    </tr>
</table>

<div class="rb">
    ${cleanReportHtml(data.Report)||'<p style="color:#aaa;text-align:center;">No content</p>'}
</div>

<div class="sig">
    ${doctorHtml}
</div>

</body>
</html>`;
};

// Updated generatePdfWithPuppeteer — uses position:fixed header/footer
// so displayHeaderFooter: false
const generatePdfWithPuppeteer = async (data) => {
    const puppeteer = require('puppeteer');

    const html = buildHtmlForPuppeteer(data);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format:              'A4',
            printBackground:     true,
            // Header/footer are inside the HTML as position:fixed
            // Puppeteer renders them correctly on every page
            displayHeaderFooter: false,
            // @page margin is 0 — padding in body handles spacing
            margin: { top: '0', bottom: '0', left: '0', right: '0' },
        });

        return pdfBuffer;
    } finally {
        await browser.close();
    }
};
module.exports = {
    buildHtmlForPrint,
    buildHtmlLayout,
    buildHtmlForPuppeteer,
    buildDocxHtml,
    generatePdfWithPuppeteer,
    safeName,
    USE_PUPPETEER,
    BRAND,
    imageToBase64,
    cleanReportHtml
};