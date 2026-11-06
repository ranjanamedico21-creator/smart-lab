'use strict';

const fs   = require('fs');
const path = require('path');

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
    return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
const fmtDate = (v) => {
    if (!v) return '—';
    try {
        const d = new Date(v);
        if (isNaN(d)) return String(v);
        return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    } catch { return String(v); }
};
const safeName = (v) => (v||'Patient').replace(/\s+/g,'_').replace(/[^\w_-]/g,'');
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

const buildHtmlWithHeaderFooter = (data, BRAND) => {
    const hH        = BRAND.headerHeightMm;
    const fH        = BRAND.footerHeightMm;
    const lh        = BRAND.lineHeight;
    const headerB64 = imageToBase64(BRAND.headerImagePath);
    const footerB64 = imageToBase64(BRAND.footerImagePath);

    const genderMap  = {'1':'Male','2':'Female','1.0':'Male','2.0':'Female'};
    const gender     = genderMap[String(data.Gender)] || fmt(data.Gender);
    const ageDisplay = data.Age ? `${data.Age} ${data.YMD||'Yrs'}` : '—';
    const reportDate = data.FinalizedAtFormatted || fmtDate(data.RegisteredOn);
    const patName    = toTitleCase(`${fmt(data.Title)} ${fmt(data.Name)}`.trim());
    const docName    = toTitleCase(fmt(data.DoctorName));
    const phone      = fmt(data.PhoneNumber);
    const specialty  = data.DoctorSpeciality ? fmt(data.DoctorSpeciality) : '';
    const filename   = `Report_${safeName(data.Name)}_${safeName(data.TestName)}.pdf`;

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
        return `<div style="flex:0 0 auto;min-width:130px;margin-right:24px;">
            ${sig}
            <div style="border-top:1px solid #333;width:130px;margin-bottom:3px;"></div>
            <div style="font-size:8pt;font-weight:700;color:#111;">Dr. ${name}</div>
            ${deg?`<div style="font-size:7pt;color:#444;margin-top:1px;line-height:1.3;">${deg}</div>`:''}
            <div style="font-size:7pt;color:#666;font-style:italic;margin-top:1px;">Radiologist</div>
        </div>`;
    }).join('');

    const A4_PX     = 794;
    const MARGIN_MM = 15;
    const PAD_PX    = 57;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${patName}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }

html, body {
    width: 100%;
    margin: 0;
    padding: 0;
    background: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 9pt;
    line-height: ${lh};
    color: #111;
}

/* Capture element: exact A4 width at 96dpi
   Padding creates left/right margins inside the canvas */
#capture {
    width: ${A4_PX}px;
    margin: 0 auto;
    background: #fff;
    padding: 0 ${PAD_PX}px;
}

#rr {
    padding-top: 6px;
}

.pt { width:100%; table-layout:fixed; border-collapse:collapse; border-bottom:1.5px solid #1a3a6e; }
.pt td { padding:2px 5px 2px 0; vertical-align:top; }
.lbl { font-size:7pt; font-weight:600; color:#555; text-transform:uppercase; letter-spacing:0.3px; width:90px; white-space:nowrap; }
.name-val { font-size:10.5pt; font-weight:700; color:#1a3a6e; }
.val { font-size:9pt; color:#111; }

.rb { font-size:9pt; line-height:${lh}; margin-top:7px; }
.rb * { background:transparent!important; }
.rb p { margin-bottom:3px; text-align:justify; }
.rb strong { font-weight:700; }
.rb h1 { font-size:9.5pt; font-weight:700; color:#1a3a6e; text-align:center; text-transform:uppercase; margin:5px 0 3px; }
.rb h2 { font-size:9pt; font-weight:700; color:#1a3a6e; border-bottom:1px solid #ddd; padding-bottom:1px; margin:4px 0 2px; }
.rb h3 { font-size:8.5pt; font-weight:700; margin:3px 0 1px; }
.rb ul,.rb ol { margin:2px 0 3px 16px; }
.rb li { margin-bottom:1px; }
.rb table { width:100%; border-collapse:collapse; margin:2px 0; font-size:8.5pt; }
.rb table td,.rb table th { border:none; padding:2px 5px; vertical-align:top; }
.rb table th { font-weight:700; color:#1a3a6e; border-bottom:1px solid #ddd; font-size:8pt; text-transform:uppercase; }
.rb img { max-width:100%; height:auto; display:block; }
.no-break { page-break-inside:avoid; break-inside:avoid; }
.sig { margin-top:14px; }

@media screen {
    html,body { background:#666; }
    #capture { background:#fff; margin:10px auto; box-shadow:0 2px 16px rgba(0,0,0,.4); }
}
</style>
</head>
<body>
<div id="capture">
<div id="rr">

<table class="pt">
    <tr>
        <td class="lbl">Patient Name</td>
        <td class="name-val">${patName}<br><span style="font-size:7pt;color:#666;font-style:italic;display:block;">${phone}</span></td>
        <td class="lbl">Age / Gender</td>
        <td class="val">${ageDisplay} / ${gender}</td>
    </tr>
    <tr>
        <td class="lbl">Referred By</td>
        <td class="val">Dr. ${docName}${specialty?`<span style="font-size:7pt;color:#666;font-style:italic;display:block;">${specialty}</span>`:''}</td>
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
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
window.addEventListener('load', function () {
    setTimeout(function () {
        var opt = {
            margin:      [${hH}, 0, ${fH}, 0],  // top/bottom only for header/footer space
            filename:    '${filename}',
            image:       { type:'jpeg', quality:0.98 },
            html2canvas: {
                scale:       2,
                useCORS:     true,
                logging:     false,
                windowWidth: ${A4_PX},
                scrollX:     0,
                scrollY:     0,
                x:           0,
                y:           0
            },
            jsPDF: { unit:'mm', format:'a4', orientation:'portrait' },
            pagebreak: { mode:['css','legacy'], avoid:'.no-break' }
        };
        html2pdf().set(opt).from(document.getElementById('capture'))
            .toPdf().get('pdf').then(function(pdf){
                var n  = pdf.internal.getNumberOfPages();
                var pw = pdf.internal.pageSize.getWidth();
                var ph = pdf.internal.pageSize.getHeight();
                ${headerB64 ? `
                for(var i=1;i<=n;i++){
                    pdf.setPage(i);
                    pdf.addImage('${headerB64}','JPEG',0,0,pw,${hH});
                }` : ''}
                ${footerB64 ? `
                for(var j=1;j<=n;j++){
                    pdf.setPage(j);
                    pdf.addImage('${footerB64}','JPEG',0,ph-${fH},pw,${fH});
                }` : ''}
                pdf.save('${filename}');
                setTimeout(function(){window.close();},800);
            });
    }, 600);
});
</script>
</body>
</html>`;
};

module.exports = { buildHtmlWithHeaderFooter };