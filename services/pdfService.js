/**
 * PDF Report Service - Shared Hosting Compatible
 * Uses html-pdf (PhantomJS) and pdfmake (pure JS)
 * NO Puppeteer dependency - works on shared hosting
 */

const htmlPdf = require('html-pdf');
const pdfmake = require('pdfmake');
const moment = require('moment');

class PDFService {
  constructor() {
    // PhantomJS options for html-pdf
    this.phantomOptions = {
      format: 'A4',
      border: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      header: { height: '10mm' },
      footer: { height: '10mm' },
      type: 'pdf',
      timeout: 30000,
      // Shared hosting often needs custom phantom path
      phantomPath: process.env.PHANTOM_PATH || undefined
    };
  }

  /**
   * Generate PDF using html-pdf (PhantomJS) - Primary method
   * Best for: Complex HTML layouts, CSS styling, tables
   */
  async generateReportHTML({ report, results, labInfo }) {
    const html = this.buildHTML({ report, results, labInfo });

    return new Promise((resolve, reject) => {
      htmlPdf.create(html, this.phantomOptions).toBuffer((err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
    });
  }

  /**
   * Generate PDF using pdfmake - Pure JS fallback
   * Best for: Shared hosting where PhantomJS binary is missing
   * No external binary dependencies
   */
  async generateReportPDFMake({ report, results, labInfo }) {
    const docDefinition = this.buildPDFMakeDefinition({ report, results, labInfo });
    const printer = new pdfmake();
    const doc = printer.createPdfKitDocument(docDefinition);

    return new Promise((resolve, reject) => {
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  /**
   * Smart generation - tries html-pdf first, falls back to pdfmake
   */
  async generateReport(data) {
    try {
      // Try html-pdf first (better styling)
      return await this.generateReportHTML(data);
    } catch (err) {
      console.log('html-pdf failed, falling back to pdfmake:', err.message);
      // Fallback to pure JS pdfmake
      return await this.generateReportPDFMake(data);
    }
  }

  buildHTML({ report, results, labInfo }) {
    const grouped = results.reduce((acc, r) => {
      const section = r.section_header || 'Results';
      if (!acc[section]) acc[section] = [];
      acc[section].push(r);
      return acc;
    }, {});

    let sections = '';
    for (const [name, items] of Object.entries(grouped)) {
      const rows = items.map(r => {
        const isAbnormal = r.flag && r.flag !== 'normal';
        const isCritical = r.flag && (r.flag.includes('critical'));
        const bgColor = isCritical ? 'background:#fff5f5;' : (isAbnormal ? 'background:#fffaf0;' : '');
        const leftBorder = isAbnormal ? 'border-left:3px solid #c53030;' : '';
        const flagColor = isCritical ? 'color:#c53030;' : (isAbnormal ? 'color:#dd6b20;' : 'color:#38a169;');

        return `<tr style="${bgColor}${leftBorder}">
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11pt;">${r.parameter_name}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;font-size:11pt;${flagColor}">
            ${r.flag_symbol || ''} ${r.result_value || '-'}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:10pt;">${r.unit || ''}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:9pt;color:#718096;">${r.reference_range_used || 'N/A'}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;font-size:10pt;${flagColor}">${r.flag?.toUpperCase() || 'PENDING'}</td>
        </tr>`;
      }).join('');

      sections += `
        <div style="font-size:12pt;font-weight:700;color:#2c5282;background:#ebf8ff;padding:8px 12px;margin-top:12px;border:1px solid #bee3f8;border-bottom:none;">${name}</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:15px;">
          <thead><tr style="background:#2c5282;color:white;">
            <th style="padding:8px 10px;text-align:left;font-size:9pt;">Parameter</th>
            <th style="padding:8px 10px;text-align:center;font-size:9pt;">Result</th>
            <th style="padding:8px 10px;text-align:center;font-size:9pt;">Unit</th>
            <th style="padding:8px 10px;font-size:9pt;">Reference Range</th>
            <th style="padding:8px 10px;text-align:center;font-size:9pt;">Flag</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #333; margin: 0; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  td { vertical-align: top; }
</style>
</head><body>

<!-- Header -->
<table style="width:100%;border-bottom:3px solid #1a365d;margin-bottom:15px;">
  <tr>
    <td style="width:100px;padding:5px;">
      <div style="width:80px;height:80px;border:1px solid #ddd;text-align:center;line-height:80px;color:#999;font-size:10px;">LOGO</div>
    </td>
    <td style="padding:5px;">
      <div style="font-size:20px;font-weight:bold;color:#1a365d;">${labInfo.name || 'PATHOLOGY LABORATORY'}</div>
      <div style="font-size:9pt;color:#666;">${labInfo.address || 'Laboratory Address'}</div>
      <div style="font-size:9pt;color:#666;">Phone: ${labInfo.phone || 'N/A'} | Email: ${labInfo.email || 'N/A'}</div>
      <div style="background:#c53030;color:white;padding:2px 8px;font-size:8pt;font-weight:bold;display:inline-block;margin-top:5px;">NABL ACCREDITED</div>
    </td>
  </tr>
</table>

<!-- Patient Bar -->
<table style="width:100%;background:#f7fafc;border:1px solid #e2e8f0;margin-bottom:15px;">
  <tr>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;width:12%;">Patient:</td>
    <td style="padding:6px 10px;font-size:9pt;"><strong>${report.patient_name || 'N/A'}</strong></td>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;width:12%;">Age/Gender:</td>
    <td style="padding:6px 10px;font-size:9pt;">${report.patient_age || 'N/A'} / ${report.patient_gender || 'N/A'}</td>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;width:12%;">Report No:</td>
    <td style="padding:6px 10px;font-size:9pt;"><strong>${report.report_number}</strong></td>
  </tr>
  <tr>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;border-top:1px solid #e2e8f0;">Doctor:</td>
    <td style="padding:6px 10px;font-size:9pt;border-top:1px solid #e2e8f0;">${report.referring_doctor || 'N/A'}</td>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;border-top:1px solid #e2e8f0;">Collected:</td>
    <td style="padding:6px 10px;font-size:9pt;border-top:1px solid #e2e8f0;">${report.specimen_collected_at ? moment(report.specimen_collected_at).format('DD-MMM-YYYY HH:mm') : 'N/A'}</td>
    <td style="padding:6px 10px;font-size:9pt;font-weight:bold;color:#4a5568;border-top:1px solid #e2e8f0;">Reported:</td>
    <td style="padding:6px 10px;font-size:9pt;border-top:1px solid #e2e8f0;">${report.approved_at ? moment(report.approved_at).format('DD-MMM-YYYY HH:mm') : 'N/A'}</td>
  </tr>
</table>

<!-- Results -->
${sections}

<!-- Critical Alert Box -->
${results.some(r => r.flag && r.flag.includes('critical')) ? `
<table style="width:100%;margin-top:15px;background:#fff5f5;border-left:4px solid #c53030;">
  <tr><td style="padding:10px 15px;font-size:10pt;color:#c53030;">
    <strong>⚠️ CRITICAL ALERT:</strong> One or more results are in critical range. Immediate clinical correlation required.
  </td></tr>
</table>
` : ''}

<!-- Footer -->
<table style="width:100%;margin-top:25px;border-top:2px solid #e2e8f0;padding-top:15px;">
  <tr>
    <td style="width:33%;text-align:center;padding:10px;vertical-align:bottom;">
      <div style="border-top:1px solid #333;margin-top:40px;padding-top:5px;font-weight:bold;font-size:10pt;">Technician</div>
      <div style="font-size:8pt;color:#718096;margin-top:3px;">Created By</div>
    </td>
    <td style="width:33%;text-align:center;padding:10px;vertical-align:bottom;">
      <div style="border-top:1px solid #333;margin-top:40px;padding-top:5px;font-weight:bold;font-size:10pt;">Senior Technician</div>
      <div style="font-size:8pt;color:#718096;margin-top:3px;">Verified By</div>
    </td>
    <td style="width:33%;text-align:center;padding:10px;vertical-align:bottom;">
      <div style="border-top:1px solid #333;margin-top:40px;padding-top:5px;font-weight:bold;font-size:10pt;">Pathologist</div>
      <div style="font-size:8pt;color:#718096;margin-top:3px;">Approved By</div>
    </td>
  </tr>
</table>

<table style="width:100%;margin-top:15px;">
  <tr><td style="font-size:8pt;color:#a0aec0;text-align:center;padding:10px;border-top:1px solid #e2e8f0;">
    This is a computer-generated report based on the sample received and analyzed at our laboratory. 
    Results should be clinically correlated. This report is valid only with laboratory seal and authorized signatures.
  </td></tr>
</table>

</body></html>`;
  }

  buildPDFMakeDefinition({ report, results, labInfo }) {
    const grouped = results.reduce((acc, r) => {
      const section = r.section_header || 'Results';
      if (!acc[section]) acc[section] = [];
      acc[section].push(r);
      return acc;
    }, {});

    const tableBody = [];
    for (const [name, items] of Object.entries(grouped)) {
      tableBody.push([
        { text: name, colSpan: 5, style: 'sectionHeader' },
        {}, {}, {}, {}
      ]);
      tableBody.push([
        { text: 'Parameter', style: 'tableHeader' },
        { text: 'Result', style: 'tableHeader', alignment: 'center' },
        { text: 'Unit', style: 'tableHeader', alignment: 'center' },
        { text: 'Reference Range', style: 'tableHeader' },
        { text: 'Flag', style: 'tableHeader', alignment: 'center' }
      ]);

      items.forEach(r => {
        const isCritical = r.flag && r.flag.includes('critical');
        const isAbnormal = r.flag && r.flag !== 'normal';
        const color = isCritical ? '#c53030' : (isAbnormal ? '#dd6b20' : '#38a169');
        const bold = isAbnormal;

        tableBody.push([
          r.parameter_name,
          { text: `${r.flag_symbol || ''} ${r.result_value || '-'}`, color, bold, alignment: 'center' },
          { text: r.unit || '', alignment: 'center' },
          { text: r.reference_range_used || 'N/A', fontSize: 9, color: '#718096' },
          { text: r.flag?.toUpperCase() || 'PENDING', color, bold, alignment: 'center' }
        ]);
      });
    }

    return {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      header: {
        text: report.report_number || '',
        alignment: 'center',
        fontSize: 8,
        color: '#999',
        margin: [0, 10, 0, 0]
      },
      footer: (currentPage, pageCount) => ({
        text: `Page ${currentPage} of ${pageCount}`,
        alignment: 'center',
        fontSize: 8,
        color: '#999'
      }),
      content: [
        // Header
        {
          table: {
            widths: ['auto', '*'],
            body: [
              [
                { text: 'LOGO', width: 80, height: 80, alignment: 'center', color: '#999', fontSize: 10 },
                [
                  { text: labInfo.name || 'PATHOLOGY LABORATORY', fontSize: 18, bold: true, color: '#1a365d' },
                  { text: labInfo.address || '', fontSize: 9, color: '#666' },
                  { text: `Phone: ${labInfo.phone || 'N/A'} | Email: ${labInfo.email || 'N/A'}`, fontSize: 9, color: '#666' },
                  { text: 'NABL ACCREDITED', fontSize: 8, bold: true, color: 'white', background: '#c53030', margin: [0, 5, 0, 0] }
                ]
              ]
            ]
          },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
          margin: [0, 0, 0, 15]
        },
        // Patient info
        {
          table: {
            widths: ['*', '*', '*'],
            body: [
              [
                { text: `Patient: ${report.patient_name || 'N/A'}`, fontSize: 10 },
                { text: `Age/Gender: ${report.patient_age || 'N/A'} / ${report.patient_gender || 'N/A'}`, fontSize: 10 },
                { text: `Report: ${report.report_number}`, fontSize: 10, bold: true }
              ]
            ]
          },
          layout: { fillColor: '#f7fafc', hLineColor: '#e2e8f0', vLineColor: '#e2e8f0' },
          margin: [0, 0, 0, 15]
        },
        // Results table
        {
          table: {
            headerRows: 0,
            widths: ['*', 'auto', 'auto', 'auto', 'auto'],
            body: tableBody
          },
          layout: {
            hLineColor: '#e2e8f0',
            vLineColor: '#e2e8f0',
            fillColor: (rowIndex) => rowIndex % 2 === 0 ? '#f7fafc' : null
          }
        },
        // Signatures
        {
          columns: [
            { text: `_________________
Technician
Created By`, alignment: 'center', margin: [0, 40, 0, 0] },
            { text: `_________________
Senior Technician
Verified By`, alignment: 'center', margin: [0, 40, 0, 0] },
            { text: `_________________
Pathologist
Approved By`, alignment: 'center', margin: [0, 40, 0, 0] }
          ],
          margin: [0, 20, 0, 0]
        },
        // Disclaimer
        {
          text: 'This is a computer-generated report. Results should be clinically correlated.',
          fontSize: 8,
          color: '#a0aec0',
          alignment: 'center',
          margin: [0, 20, 0, 0]
        }
      ],
      styles: {
        sectionHeader: {
          fontSize: 12,
          bold: true,
          color: '#2c5282',
          fillColor: '#ebf8ff',
          margin: [0, 10, 0, 5]
        },
        tableHeader: {
          fontSize: 9,
          bold: true,
          color: 'white',
          fillColor: '#2c5282'
        }
      },
      defaultStyle: {
        fontSize: 10
      }
    };
  }
}

module.exports = PDFService;