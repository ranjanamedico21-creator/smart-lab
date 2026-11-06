// ═══════════════════════════════════════════════════════════════════
// common.js  —  Loaded on EVERY page
// Contains: FormValidation, TableSearch, TomSelectManager,
//           injectTomSelectStyles, Sidebar, UIComponents (core),
//           datePickers, tooltips, pagination, imageZoom,
//           assignRoleModal, deleteDocumentModal
// ═══════════════════════════════════════════════════════════════════
"use strict";

// ── Form Validation ───────────────────────────────────────────────
const FormValidation = (() => {
    const init = () => {
        document.querySelectorAll(".needs-validation").forEach(form => {
            form.addEventListener("submit", (event) => {
                if (!form.checkValidity()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                form.classList.add("was-validated");
            }, false);
        });
    };
    return { init };
})();

// ── Table Search ──────────────────────────────────────────────────
const TableSearch = {
    init() {
        $(".tableSearch").on("keyup", function () {
            const value = $(this).val().toLowerCase();
            $(".tableBody tr").filter(function () {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });
    }
};

// ── Tom Select Manager ────────────────────────────────────────────
const TomSelectManager = {
    defaultConfig: {
        allowEmptyOption: true,
        maxOptions:       300,
        minLength:        0,
        plugins:          {},
        render: {
            option: function(data, escape) {
                return '<div>' + escape(data.text) + '</div>';
            }
        }
    },

    init(selector, opts) {
        const els = typeof selector === 'string'
            ? document.querySelectorAll(selector)
            : [selector];
        els.forEach(el => {
            if (!el || el.tomselect) return;
            try { new TomSelect(el, Object.assign({}, this.defaultConfig, opts || {})); }
            catch(e) { console.warn('TomSelect init failed for', el, e); }
        });
    },

    reinit(selector, opts) {
        const els = typeof selector === 'string'
            ? document.querySelectorAll(selector)
            : [selector];
        els.forEach(el => {
            if (!el) return;
            if (el.tomselect) el.tomselect.destroy();
            try { new TomSelect(el, Object.assign({}, this.defaultConfig, opts || {})); }
            catch(e) { console.warn('TomSelect reinit failed for', el, e); }
        });
    },

    refresh(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (el && el.tomselect) el.tomselect.sync();
    },

    setValue(selector, value) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (el && el.tomselect) el.tomselect.setValue(value, true);
    },

    getValue(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return '';
        return el.tomselect ? el.tomselect.getValue() : el.value;
    },

    disable(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (el && el.tomselect) el.tomselect.disable();
    },

    enable(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (el && el.tomselect) el.tomselect.enable();
    }
};

// ── Inject global Tom Select + Flatpickr styles ───────────────────
(function injectTomSelectStyles() {
    if (document.getElementById('ts-global-styles')) return;
    const style = document.createElement('style');
    style.id = 'ts-global-styles';
    style.textContent = `
        .ts-wrapper { padding:0!important; }
        .ts-wrapper.single .ts-control {
            border:1.5px solid #e2e8f0!important; border-radius:8px!important;
            padding:7px 12px!important; font-size:13px!important;
            font-family:inherit!important; background:#fff!important;
            color:#1a202c!important; box-shadow:none!important;
            cursor:pointer!important; min-height:unset!important; line-height:1.5!important;
        }
        .ts-wrapper.single:focus-within .ts-control {
            border-color:#1a56e8!important;
            box-shadow:0 0 0 3px rgba(26,86,232,.1)!important; outline:none!important;
        }
        .ts-dropdown {
            border:1.5px solid #e2e8f0!important; border-radius:8px!important;
            box-shadow:0 8px 24px rgba(0,0,0,.1)!important; font-size:13px!important;
            font-family:inherit!important; margin-top:3px!important;
            overflow:hidden!important; z-index:9999!important;
        }
        .ts-dropdown input {
            border:none!important; border-bottom:1.5px solid #f1f5f9!important;
            border-radius:0!important; padding:8px 12px!important;
            font-size:12.5px!important; font-family:inherit!important;
            width:100%!important; outline:none!important;
            color:#1a202c!important; background:#f8fafc!important; box-shadow:none!important;
        }
        .ts-dropdown input::placeholder { color:#94a3b8!important; }
        .ts-dropdown .option {
            padding:8px 12px!important; font-size:13px!important;
            color:#1a202c!important; cursor:pointer!important;
            text-transform:capitalize!important; transition:background .1s!important;
        }
        .ts-dropdown .option:hover,
        .ts-dropdown .option.active { background:#eff6ff!important; color:#1a56e8!important; }
        .ts-dropdown .option[data-value=""] { color:#94a3b8!important; font-style:italic!important; text-transform:none!important; }
        .ts-wrapper .item { font-size:13px!important; color:#1a202c!important; text-transform:capitalize!important; }
        .ts-wrapper.single .ts-control::after { border-color:#94a3b8 transparent transparent!important; }
        .ts-wrapper.disabled .ts-control { background:#f8fafc!important; cursor:not-allowed!important; opacity:.65!important; }

        /* Flatpickr — prevent global input styles bleeding into calendar */
        .flatpickr-calendar input,
        .flatpickr-calendar input.cur-year,
        .flatpickr-calendar .numInputWrapper input {
            all:unset!important; font-size:14px!important; color:#fff!important;
            background:transparent!important; width:4ch!important;
            display:inline-block!important; text-align:center!important; cursor:default!important;
        }
        .flatpickr-calendar .numInputWrapper {
            width:auto!important; height:auto!important;
            display:inline-flex!important; align-items:center!important;
            padding:0!important; border:none!important; background:transparent!important;
        }
        .flatpickr-calendar .flatpickr-day {
            height:38px!important; line-height:38px!important;
            border:none!important; background:transparent!important;
            box-shadow:none!important; padding:0!important; width:auto!important;
        }
        .flatpickr-calendar { z-index:99999!important; }
    `;
    document.head.appendChild(style);
})();

// ─────────────────────────────────────────────────────────────────
// DOM-ready
// ─────────────────────────────────────────────────────────────────
$(document).ready(function () {

    FormValidation.init();
    TableSearch.init();

    // ── Sidebar ───────────────────────────────────────────────────
    const Sidebar = {
        init() { this.restoreState(); this.bindEvents(); },
        restoreState() {
            const activeSection = localStorage.getItem("sidebar-active-section");
            const activeLink    = localStorage.getItem("sidebar-active-link");
            if (activeSection) $(activeSection).addClass("show");
            if (activeLink) { $(".sidebar-link").removeClass("active"); $(activeLink).addClass("active"); }
        },
        bindEvents() {
            $(".btn-toggle").on("click", function () {
                const target = $(this).data("bs-target");
                localStorage.setItem("sidebar-active-section", $(target).hasClass("show") ? "" : target);
            });
            $(".sidebar-link").on("click", function () {
                $(".sidebar-link").removeClass("active");
                $(this).addClass("active");
                localStorage.setItem("sidebar-active-link", this);
            });
        }
    };

    // ── Core UI — runs everywhere ─────────────────────────────────
    const UIComponents = {
        init() {
            this.tooltips();
            this.initAllSelects();
            this.datePickers();
            this.pagination();
            this.setupImageZoom();
            this.openAssignRoleModel();
            this.setupDeleteDocumentModal();
        },

        tooltips() {
            document.querySelectorAll('[data-bs-toggle="tooltip"]')
                .forEach(el => new bootstrap.Tooltip(el));
        },

        // All selects except #test (initialised separately in patientBilling.js)
        initAllSelects() {
            document.querySelectorAll('select:not(#test)').forEach(el => {
                if (el.tomselect) return;
                TomSelectManager.init(el, { allowEmptyOption: true, minLength: 0 });
            });
        },

        datePickers() {
            if (document.getElementById("dateDisplay")) {
                flatpickr("#dateDisplay", {
                    defaultDate: "today", dateFormat: "d-m-Y", disableMobile: true,
                    onChange(_, dateStr) { $("#registrationDate").val(dateStr); $("#dateLabel").text(dateStr); },
                    onReady(_,  dateStr) { $("#registrationDate").val(dateStr); $("#dateLabel").text(dateStr); }
                });
            }

            [
                "#FromDate", "#ToDate", "#drFromDate", "#drToDate",
                ".expiryDate", "#joiningDate", ".mfgDate", "#ChallanDate",
                "#purchasePoDate", "#invoicePoDate"
            ].forEach(selector => {
                document.querySelectorAll(selector).forEach(el => {
                    flatpickr(el, { dateFormat: "d-m-Y", allowInput: true, disableMobile: true });
                });
            });

            const fromEl = document.querySelector("#FromDate");
            const toEl   = document.querySelector("#ToDate");
            if (fromEl && toEl) {
                fromEl.addEventListener("change", () => { if (toEl._flatpickr)   toEl._flatpickr.set("minDate", fromEl.value); });
                toEl.addEventListener("change",   () => { if (fromEl._flatpickr) fromEl._flatpickr.set("maxDate", toEl.value); });
            }
            const drFromEl = document.querySelector("#drFromDate");
            const drToEl   = document.querySelector("#drToDate");
            if (drFromEl && drToEl) {
                drFromEl.addEventListener("change", () => { if (drToEl._flatpickr)   drToEl._flatpickr.set("minDate", drFromEl.value); });
                drToEl.addEventListener("change",   () => { if (drFromEl._flatpickr) drFromEl._flatpickr.set("maxDate", drToEl.value); });
            }
        },

        pagination() {
            $(".pagination-loop").pageMe({
                pagerSelector: "#pagination_Number", showPrevNext: true,
                hidePageNumbers: false, perPage: 15
            });
        },

        setupImageZoom() {
            $(".zoom").click(function () { $("#modalImage").attr("src", $(this).attr("src")); });
        },

        openAssignRoleModel() {
            $("a[data-bs-target='#assignRole']").on("click", function () {
                $("#assignRoleLabel").text(`Assign A Role To - ${$(this).data("bs-name")}`);
                $("#userId").val($(this).data("bs-user-id"));
            });
        },

        setupDeleteDocumentModal() {
            document.querySelectorAll(".delete-document").forEach(button => {
                button.addEventListener("click", function () {
                    document.getElementById("modalDocumentId").value =
                        this.getAttribute("data-document-id");
                });
            });
        }
    };

    Sidebar.init();
    UIComponents.init();
});