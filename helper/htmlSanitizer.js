'use strict';
/**
 * helper/htmlSanitizer.js — one place that decides which HTML may be stored and shown
 * (report templates, patient reports). Needs: npm install sanitize-html@2
 *
 * Keeps what Word → HTML (mammoth) and the report editor produce: headings, paragraphs, bold/italic,
 * lists, tables, images (data: URIs / http(s)), inline styles without url()/expression().
 * Removes <script>, <iframe>, <svg>, <style>, on* handlers, javascript: links, forms …
 * {{placeholders}} are plain text and stay untouched.
 */
const sanitizeHtml = require('sanitize-html');

const SAFE_STYLE = [/^[^()<>]*$/];                    // no url(...), expression(...)
const STYLES = ['width', 'height', 'max-width', 'min-width', 'border', 'border-collapse', 'border-top', 'border-bottom', 'border-left',
    'border-right', 'border-color', 'border-width', 'border-style', 'padding', 'padding-left', 'padding-right', 'padding-top',
    'padding-bottom', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'font-size', 'font-weight',
    'font-style', 'font-family', 'text-align', 'vertical-align', 'line-height', 'color', 'background', 'background-color',
    'text-decoration', 'text-transform', 'white-space', 'letter-spacing', 'text-indent', 'list-style-type', 'page-break-after',
    'page-break-before', 'page-break-inside', 'break-after', 'break-before', 'break-inside', 'float', 'display'];

const OPTIONS = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span', 'u', 's', 'sup', 'sub', 'font', 'center', 'hr', 'br']),
    allowedAttributes: {
        '*':   ['style', 'class', 'align', 'dir'],
        img:   ['src', 'alt', 'width', 'height'],
        td:    ['colspan', 'rowspan', 'width', 'valign'], th: ['colspan', 'rowspan', 'width', 'valign'],
        table: ['width', 'border', 'cellpadding', 'cellspacing'],
        col:   ['width', 'span'], colgroup: ['width', 'span'],
        a:     ['href', 'target'], font: ['color', 'size', 'face'],
        ol:    ['start', 'type'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data', 'http', 'https'] },     // Word images arrive as data: URIs
    allowedStyles: { '*': Object.fromEntries(STYLES.map(p => [p, SAFE_STYLE])) },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
};

/** Clean HTML for storing / showing. Returns '' for empty input. */
const cleanHtml = (html) => {
    if (html === undefined || html === null) return '';
    const s = String(html);
    return s.trim() ? sanitizeHtml(s, OPTIONS).trim() : '';
};

/** Plain text only (pathology values, names): all tags removed. */
const plainText = (v, max = 500) =>
    sanitizeHtml(String(v === undefined || v === null ? '' : v), { allowedTags: [], allowedAttributes: {} }).trim().slice(0, max);

module.exports = { cleanHtml, plainText, SANITIZE_OPTIONS: OPTIONS };