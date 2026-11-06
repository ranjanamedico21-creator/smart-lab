// Form Validation Module
const FormValidation = (() => {
    "use strict";
    const init = () => {
        const forms = document.querySelectorAll(".needs-validation");
        forms.forEach(form => {
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

// Table Search Module
const TableSearch = {
    init() {
        $(".tableSearch").on("keyup", function () {
            var value = $(this).val().toLowerCase();
            $(".tableBody tr").filter(function () {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });
    }
};

// ── Tom Select Manager ────────────────────────────────────────────────────
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
            try {
                new TomSelect(el, Object.assign({}, this.defaultConfig, opts || {}));
            } catch(e) {
                console.warn('TomSelect init failed for', el, e);
            }
        });
    },

    reinit(selector, opts) {
        const els = typeof selector === 'string'
            ? document.querySelectorAll(selector)
            : [selector];
        els.forEach(el => {
            if (!el) return;
            if (el.tomselect) el.tomselect.destroy();
            try {
                new TomSelect(el, Object.assign({}, this.defaultConfig, opts || {}));
            } catch(e) {
                console.warn('TomSelect reinit failed for', el, e);
            }
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


// ── Inject global Tom Select styles ──────────────────────────────────────
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
                            .ts-dropdown .option[data-value=""] {
                                color:#94a3b8!important; font-style:italic!important; text-transform:none!important;
                            }
                            .ts-wrapper .item { font-size:13px!important; color:#1a202c!important; text-transform:capitalize!important; }
                            .ts-wrapper.single .ts-control::after { border-color:#94a3b8 transparent transparent!important; }
                            .ts-wrapper.disabled .ts-control { background:#f8fafc!important; cursor:not-allowed!important; opacity:.65!important; }
                            
                            `;
    document.head.appendChild(style);
})();

// ── Main Application ──────────────────────────────────────────────────────
$(document).ready(function () {

    FormValidation.init();
    TableSearch.init();

    const CONFIG = { dateFormat: "dd-mm-yy" };

    // ── Sidebar ───────────────────────────────────────────────────────────
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

    // ── UI Components ─────────────────────────────────────────────────────
    const UIComponents = {
        init() {
            this.tooltips();
            this.initAllSelects();   // Tom Select — must run BEFORE datePickers
            this.datePickers();
            this.pagination();
            this.supplierProductFilter();
            this.setupCancelPatientModal();
            this.setupDeleteDocumentModal();
            this.setupImageZoom();
            this.openAssignRoleModel();
        },

        tooltips() {
            document.querySelectorAll('[data-bs-toggle="tooltip"]')
                .forEach(el => new bootstrap.Tooltip(el));
        },

        // ── THIS is the only place initAllSelects lives ───────────────────
       /* initAllSelects() {
            // All selects except #test
            document.querySelectorAll('select:not(#test)').forEach(el => {
                if (el.tomselect) return;
                TomSelectManager.init(el, {
                    allowEmptyOption: true,
                    minLength:        0,
                });
            });*/

            initAllSelects() {
                // All selects except #test (we init #test separately with custom render)
                document.querySelectorAll('select:not(#test)').forEach(el => {
                    if (el.tomselect) return;
                    TomSelectManager.init(el, {
                        allowEmptyOption: true,
                        minLength: 0,
                    })
                });
                // #test is initialized separately in the EJS page script with custom render
            // #test — live search
            const testEl = document.getElementById('test');
            if (testEl && !testEl.tomselect) {
                TomSelectManager.init(testEl, {
                    allowEmptyOption: true,
                    minLength:        0,
                    placeholder:      'Type to search tests...',
                });
            }
        },

        datePickers() {
            if (document.getElementById("dateDisplay")) {
                flatpickr("#dateDisplay", {
                    defaultDate:   "today",
                    dateFormat:    "d-m-Y",
                    disableMobile: true,
                    onChange(selectedDates, dateStr) {
                        $("#registrationDate").val(dateStr);
                        $("#dateLabel").text(dateStr);
                    },
                    onReady(selectedDates, dateStr) {
                        $("#registrationDate").val(dateStr);
                        $("#dateLabel").text(dateStr);
                    }
                });
            }

            const dateFieldIds = [
                "#FromDate", "#ToDate",
                "#drFromDate", "#drToDate",
                ".expiryDate", "#joiningDate",
                ".mfgDate", "#ChallanDate",
                "#purchasePoDate", "#invoicePoDate"
            ];

            dateFieldIds.forEach(selector => {
                const els = document.querySelectorAll(selector);
                if (!els.length) return;
                els.forEach(el => flatpickr(el, {
                    dateFormat:    "d-m-Y",
                    allowInput:    true,
                    disableMobile: true
                }));
            });

            const fromEl = document.querySelector("#FromDate");
            const toEl   = document.querySelector("#ToDate");
            if (fromEl && toEl) {
                fromEl.addEventListener("change", () => {
                    if (toEl._flatpickr) toEl._flatpickr.set("minDate", fromEl.value);
                });
                toEl.addEventListener("change", () => {
                    if (fromEl._flatpickr) fromEl._flatpickr.set("maxDate", toEl.value);
                });
            }

            const drFromEl = document.querySelector("#drFromDate");
            const drToEl   = document.querySelector("#drToDate");
            if (drFromEl && drToEl) {
                drFromEl.addEventListener("change", () => {
                    if (drToEl._flatpickr) drToEl._flatpickr.set("minDate", drFromEl.value);
                });
                drToEl.addEventListener("change", () => {
                    if (drFromEl._flatpickr) drFromEl._flatpickr.set("maxDate", drToEl.value);
                });
            }
        },

        pagination() {
            $(".pagination-loop").pageMe({
                pagerSelector:   "#pagination_Number",
                showPrevNext:    true,
                hidePageNumbers: false,
                perPage:         15
            });
        },

        supplierProductFilter() {
            const $supplierSelect = $("#supplier");
            const $productSelect  = $("#product");
            if (!$productSelect.length) return;

            if (!$productSelect.data("original-options")) {
                $productSelect.data("original-options", $productSelect.find('option').clone());
            }

            $supplierSelect.on("change", function () {
                const supplierId = $(this).val();
                const productEl  = document.getElementById('product');
                if (productEl && productEl.tomselect) productEl.tomselect.destroy();

                $productSelect.empty().append('<option value="">Select product</option>');
                const $allOpts = $productSelect.data("original-options");

                if (supplierId) {
                    $allOpts.each(function () {
                        const $o = $(this);
                        if ($o.attr("data-supplier-id") === supplierId || $o.val() === "") {
                            $productSelect.append($o.clone());
                        }
                    });
                } else {
                    $productSelect.append($allOpts.clone());
                }
                TomSelectManager.init(productEl, { allowEmptyOption: true, minLength: 0 });
            });

            if ($supplierSelect.val()) $supplierSelect.trigger("change");
        },

        setupCancelPatientModal() {
            $("a[data-bs-target='#cancelPatient']").on("click", function () {
                const patientId   = $(this).data("bs-patient-id");
                const patientName = $(this).data("bs-patient-name");
                $("#cancelPatientLabel").text(`Cancel Patient - ${patientName}`);
                $(".modal-cancel-patient-id").val(patientId);
                $("#searchedBillNo").val($("#billNo").val());
                $("#searchedName").val($("#name").val());
                $("#searchedFromDate").val($("#FromDate").val());
                $("#searchedToDate").val($("#ToDate").val());
                $("#searchedDoctor").val(TomSelectManager.getValue('#doctor'));
                $("#searchedStatus").val(TomSelectManager.getValue('#status'));
            });
        },

        openAssignRoleModel() {
            $("a[data-bs-target='#assignRole']").on("click", function () {
                $("#assignRoleLabel").text(`Assign A Role To  - ${$(this).data("bs-name")}`);
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
        },

        setupImageZoom() {
            $(".zoom").click(function () {
                $("#modalImage").attr("src", $(this).attr("src"));
            });
        }
    };

    // ── Patient Module ────────────────────────────────────────────────────
    const PatientModule = {
        tests:       [],
        subTests:    [],
        _alertTimer: null,

        init() {
            this.cacheDOM();
            this.bindEvents();
            this.loadExistingTests();
            this.updatePaymentDisplay();
        },

        cacheDOM() {
            this.$test          = $("#test");
            this.$price         = $("#price");
            this.$discount      = $("#discount");
            this.$tbody         = $("#testTbody");
            this.$finalDiscount = $("#finalDiscount");
            this.$grossAmount   = $("#grossAmount");
            this.$tableWrap     = $("#testTableWrap");
            this.$noTests       = $("#noTestsPlaceholder");
        },

        bindEvents() {
            $("#addTest").on("click", this.addTest.bind(this));
            $(document).on("click", ".removeTest", this.removeTest.bind(this));
            $(document).on("change", "#test", this.updateTestFields.bind(this));
            $("#cashPayment, #onlinePayment").on("input", this.updatePaymentDisplay.bind(this));
            $("#registerForm").on("submit", this.validateBeforeSubmit.bind(this));

            $(document).on("focus", "#cashPayment, #onlinePayment, #discount", function () {
                if ($(this).val() == 0) $(this).val("");
            });
            $(document).on("blur", "#cashPayment, #onlinePayment, #discount", function () {
                if ($(this).val() === "") $(this).val(0);
            });

            $(document).on("change", ".pm-radio", function () {
                $("#onlinePaymentMethod").val($(this).data("source-id"));
                $(".pm-radio").each(function () {
                    const $label = $(`label[for="${$(this).attr("id")}"]`);
                    if ($(this).prop("checked")) {
                        $label.css({ borderColor:"var(--primary)", background:"var(--primary-light)", color:"var(--primary)" });
                    } else {
                        $label.css({ borderColor:"", background:"", color:"" });
                    }
                });
            });

            $(document).on("input", ".sub-discount-input", function () {
                const $input   = $(this);
                const price    = parseFloat($input.data("price")) || 0;
                let   discount = parseFloat($input.val())         || 0;
                if (discount > price) { discount = price; $input.val(price.toFixed(2)); }
                $input.closest("tr").find(".sub-net-cell").text((price - discount).toFixed(2));
                const subTestId = parseInt($input.closest("tr").find(".removeTest").data("attr-id"));
                const sub = PatientModule.subTests.find(s => s.SubTestId === subTestId);
                if (sub) {
                    const oldDiscount = sub.Discount;
                    sub.Discount = discount;
                    PatientModule.$finalDiscount.val(
                        (parseFloat(PatientModule.$finalDiscount.val()) - oldDiscount + discount).toFixed(2)
                    );
                    PatientModule.$grossAmount.val(
                        (parseFloat(PatientModule.$grossAmount.val()) + oldDiscount - discount).toFixed(2)
                    );
                    PatientModule.updatePaymentDisplay();
                    PatientModule.updateStorage();
                }
            });
            $(document).on("focus", ".sub-discount-input", function () { if ($(this).val() == 0) $(this).val(""); });
            $(document).on("blur",  ".sub-discount-input", function () { if ($(this).val() === "") $(this).val(0); });
        },

        /*addTest() {
            const testEl    = document.getElementById('test');
            const tsInst    = testEl && testEl.tomselect;
            const testId    = tsInst ? parseInt(tsInst.getValue(), 10) : parseInt(this.$test.val(), 10);
            const $selected = this.$test.find(':selected');
            const testName  = $selected.text().split("—")[0].trim();
            const price     = parseFloat(this.$price.val())    || 0;
            const discount  = parseFloat(this.$discount.val()) || 0;

            if (!testId) return this.showAlert("Please select a test before adding.", "warning");
            if (this.tests.some(t => t.TestId === testId)) {
                this.$tbody.find(`button[data-attr-id="${testId}"][data-attr-issubtest="false"]`)
                    .closest("tr").addClass("table-warning");
                setTimeout(() => this.$tbody.find(`button[data-attr-id="${testId}"]`).closest("tr").removeClass("table-warning"), 1500);
                return this.showAlert(`<strong>${testName}</strong> is already in the list.`, "danger");
            }
            if (discount > price) return this.showAlert("Discount cannot exceed the test price.", "danger");

            this.addMainTestRow({ testId, testName, price, discount });
            this.attachSubTests(testId);
            this.updateStorage();
            this.resetFields();
            this.toggleTable();
            $("#liveErrorAlertPlaceholder").empty();
        },*/

        addTest() {
            const testEl    = document.getElementById('test');
            const tsInst    = testEl && testEl.tomselect;
            const testId    = tsInst ? parseInt(tsInst.getValue(), 10) : parseInt(this.$test.val(), 10);
            const $selected = this.$test.find(':selected');
            const testName  = $selected.text().split("—")[0].trim();
            const price     = parseFloat(this.$price.val())    || 0;
            const discount  = parseFloat(this.$discount.val()) || 0;
        
            if (!testId) return this.showAlert("Please select a test before adding.", "warning");
            
            // ✅ CHECK: Is this test already in the list?
            if (this.tests.some(t => t.TestId === testId)) {
                this.$tbody.find(`button[data-attr-id="${testId}"][data-attr-issubtest="false"]`)
                    .closest("tr").addClass("table-warning");
                setTimeout(() => this.$tbody.find(`button[data-attr-id="${testId}"]`).closest("tr").removeClass("table-warning"), 1500);
                return this.showAlert(`<strong>${testName}</strong> is already in the list.`, "danger");
            }
        
            // ✅ CHECK: Are any subtests of this test already added to OTHER tests?
            const newSubTests = (window.subTestMap || {})[testId] || [];
            const alreadyAddedSubTestNames = new Set();
            
            // Collect all subtest names currently in the table
            this.subTests.forEach(function(s) {
                alreadyAddedSubTestNames.add(s.SubTestName.trim().toLowerCase());
            });
            
            // Check for duplicates
            var duplicateSubTests = [];
            newSubTests.forEach(function(s) {
                var subName = s.SubTestName.trim().toLowerCase();
                if (alreadyAddedSubTestNames.has(subName)) {
                    duplicateSubTests.push(s.SubTestName);
                }
            });
        
            if (duplicateSubTests.length > 0) {
                var msg = duplicateSubTests.length === 1
                    ? 'Subtest "' + duplicateSubTests[0] + '" is already added with another test. You cannot add it twice.'
                    : 'Subtests "' + duplicateSubTests.join('", "') + '" are already added with other tests. You cannot add them twice.';
                return this.showAlert(msg, "warning");
            }
        
            if (discount > price) return this.showAlert("Discount cannot exceed the test price.", "danger");
        
            this.addMainTestRow({ testId, testName, price, discount });
            this.attachSubTests(testId);
            this.updateStorage();
            this.resetFields();
            this.toggleTable();
            $("#liveErrorAlertPlaceholder").empty();
        },

        addMainTestRow({ testId, testName, price, discount }) {
            const net = Math.max(0, price - discount);
            this.$tbody.append(`
                <tr data-main-test-id="${testId}">
                    <td><span class="test-badge-main">TEST</span> ${testName}</td>
                    <td>${price.toFixed(2)}</td>
                    <td>${discount.toFixed(2)}</td>
                    <td><strong>${net.toFixed(2)}</strong></td>
                    <td>
                        <button class="btn-remove-test removeTest"
                            data-attr-id="${testId}" data-attr-issubtest="false" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`);
            this.tests.push({ TestId: testId, TestName: testName, Price: price, Discount: discount });
            this.updateTotals(price, discount);
        },

        attachSubTests(mainTestId) {
            const subtests = (window.subTestMap || {})[mainTestId] || [];
            subtests.forEach(s => this.addSubTestRow({
                mainTestId:  mainTestId,
                subTestId:   s.SubTestId,
                subTestName: s.SubTestName,
                price:       parseFloat(s.Price)    || 0,
                discount:    parseFloat(s.Discount) || 0
            }));
        },

        addSubTestRow({ mainTestId, subTestId, subTestName, price, discount }) {
            const net = Math.max(0, price - discount);
            this.$tbody.append(`
                <tr class="subtest-row" ${mainTestId > 0 ? `data-sub-of="${mainTestId}"` : ""}>
                    <td><span class="test-badge-sub">SUB</span> ${subTestName}</td>
                    <td>${price.toFixed(2)}</td>
                    <td>
                        <input type="number" class="sub-discount-input"
                            value="${discount.toFixed(2)}" min="0" max="${price}" data-price="${price}"
                            style="width:80px;height:28px;border:1px solid var(--border,#e2e8f0);
                                   border-radius:6px;padding:0 8px;font-size:12px;
                                   font-family:'DM Mono',monospace;text-align:right">
                    </td>
                    <td class="sub-net-cell">${net.toFixed(2)}</td>
                    <td>
                        <button class="btn-remove-test removeTest"
                            data-attr-id="${subTestId}" data-attr-issubtest="true"
                            data-parent-test-id="${mainTestId}" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`);
            this.subTests.push({ TestId: mainTestId, SubTestId: subTestId, SubTestName: subTestName, Price: price, Discount: discount });
            this.updateTotals(price, discount);
        },

        removeTest(e) {
            const $btn     = $(e.currentTarget);
            const id       = parseInt($btn.data("attr-id"), 10);
            const isSub    = String($btn.data("attr-issubtest")) === "true";
            const $row     = $btn.closest("tr");
            const price    = parseFloat($row.find("td:eq(1)").text()) || 0;
            const $di      = $row.find(".sub-discount-input");
            const discount = $di.length ? parseFloat($di.val()) || 0 : parseFloat($row.find("td:eq(2)").text()) || 0;

            $row.remove();
            this.updateTotals(-price, -discount);

            if (isSub) {
                this.subTests = this.subTests.filter(s => s.SubTestId !== id);
            } else {
                this.tests = this.tests.filter(t => t.TestId !== id);
                this.$tbody.find(`tr[data-sub-of="${id}"]`).each((_, row) => {
                    const sp  = parseFloat($(row).find("td:eq(1)").text()) || 0;
                    const $sdi = $(row).find(".sub-discount-input");
                    const sd  = $sdi.length ? parseFloat($sdi.val()) || 0 : parseFloat($(row).find("td:eq(2)").text()) || 0;
                    this.updateTotals(-sp, -sd);
                });
                this.$tbody.find(`tr[data-sub-of="${id}"]`).remove();
                this.subTests = this.subTests.filter(s => s.TestId !== id);
            }
            this.updateStorage();
            this.toggleTable();
        },

        updateTotals(price, discount) {
            this.$finalDiscount.val((parseFloat(this.$finalDiscount.val()) || 0) + discount).val(
                parseFloat(this.$finalDiscount.val()).toFixed(2));
            this.$grossAmount.val((parseFloat(this.$grossAmount.val()) || 0) + price).val(
                parseFloat(this.$grossAmount.val()).toFixed(2));
            this.updatePaymentDisplay();
        },

        updatePaymentDisplay() {
            const gross    = parseFloat($("#grossAmount").val())   || 0;
            const discount = parseFloat($("#finalDiscount").val()) || 0;
            const net      = Math.max(0, gross - discount);
            const cash     = parseFloat($("#cashPayment").val())   || 0;
            const online   = parseFloat($("#onlinePayment").val()) || 0;
            const paid     = cash + online;
            const due      = Math.max(0, net - paid);
            const change   = Math.max(0, paid - net);

            $("#paidDisplay").text("₹" + paid.toFixed(2));
            $("#dueDisplay").text("₹" + due.toFixed(2));

            if (change > 0) { $("#changeDisplay").text("₹" + change.toFixed(2)); $("#changeRow").show(); }
            else            { $("#changeRow").hide(); }
            $("#changeAmount").val(change);

            if (online > 0) {
                $("#paymentMethods").addClass("show");
            } else {
                $("#paymentMethods").removeClass("show");
                $(".pm-radio").prop("checked", false).each(function () {
                    $(`label[for="${$(this).attr("id")}"]`).css({ borderColor:"", background:"", color:"" });
                });
                $("#onlinePaymentMethod").val("");
            }
        },

        updateStorage() {
            $("#selectedTestDetails").val(JSON.stringify(this.tests));
            $("#selectedSubTestDetails").val(JSON.stringify(this.subTests));
            $("#testLength").val(this.tests.length);
            $("#subTestLength").val(this.subTests.length);
        },

        loadExistingTests() {
            const mainData = $("#patientTestDetails").val();
            const subData  = $("#patientSubTestDetails").val();
            if (mainData) {
                try { JSON.parse(mainData).forEach(t => this.addMainTestRow({ testId:t.TestId, testName:t.TestName, price:parseFloat(t.Price)||0, discount:parseFloat(t.Discount)||0 })); }
                catch (err) { console.error("loadExistingTests:", err); }
            }
            if (subData) {
                try { JSON.parse(subData).forEach(s => this.addSubTestRow({ mainTestId:s.TestId, subTestId:s.SubTestId, subTestName:s.SubTestName, price:parseFloat(s.Price)||0, discount:parseFloat(s.Discount)||0 })); }
                catch (err) { console.error("loadExistingSubTests:", err); }
            }
            this.toggleTable();
        },

        updateTestFields() {
            const testEl    = document.getElementById('test');
            const val       = testEl && testEl.tomselect ? testEl.tomselect.getValue() : this.$test.val();
            const $selected = this.$test.find(`option[value="${val}"]`);
            const basePrice  = parseFloat($selected.data("price"))       || 0;
            const grandTotal = parseFloat($selected.data("grand-total")) || basePrice;
            const hasSubs    = $selected.data("has-subtests") == 1;

            this.$discount.val(0);
            this.$price.val(basePrice);

            if (hasSubs) {
                $("#testPriceInfo").html(
                    `<span style="font-size:11px;color:#185FA5;font-weight:600">Base ₹${basePrice.toLocaleString("en-IN")} · Total with sub-tests: <strong>₹${grandTotal.toLocaleString("en-IN")}</strong></span>`
                );
            } else {
                $("#testPriceInfo").empty();
            }
        },

        resetFields() {
            const testEl = document.getElementById('test');
            if (testEl && testEl.tomselect) testEl.tomselect.clear(true);
            this.$price.val(0);
            this.$discount.val(0);
            $("#testPriceInfo").empty();
        },

        toggleTable() {
            const hasRows = this.$tbody.find("tr").length > 0;
            this.$tableWrap.toggle(hasRows);
            this.$noTests.toggle(!hasRows);
        },

        validateBeforeSubmit(e) {
            const form = document.getElementById("registerForm");
            if (!form.checkValidity()) {
                e.preventDefault(); e.stopPropagation();
                form.classList.add("was-validated");
                const first = form.querySelector(":invalid");
                if (first) { first.scrollIntoView({ behavior:"smooth", block:"center" }); first.focus(); }
                this.showAlert("Please fill in all required fields.", "danger");
                return false;
            }
            form.classList.add("was-validated");

            const clinicVal = TomSelectManager.getValue('#clinic') || $("#clinic").val() || '';
            const doctorVal = TomSelectManager.getValue('#doctor') || $("#doctor").val() || '';

            const checks = [
                [!$("#patientName").val().trim(),                                   "Patient name is required.",            "#patientName"],
                [!$("#age").val() || parseInt($("#age").val()) < 0,                 "Please enter a valid age.",            "#age"],
                [!$("#phoneNumber").val() || $("#phoneNumber").val().length !== 10,  "Enter a valid 10-digit phone number.", "#phoneNumber"],
                [!clinicVal || clinicVal === "0",                                   "Please select a clinic.",              null],
                [!doctorVal || doctorVal === "0",                                   "Please select a doctor.",              null]
            ];

            for (const [condition, msg, focusId] of checks) {
                if (condition) {
                    e.preventDefault();
                    if (focusId) $(focusId).focus();
                    return this.showAlert(msg, "danger");
                }
            }

            if (this.tests.length === 0) {
                e.preventDefault();
                return this.showAlert("Please add at least one test before registering.", "danger");
            }

            const gross  = parseFloat(this.$grossAmount.val()) || 0;
            const cash   = parseFloat($("#cashPayment").val())  || 0;
            const online = parseFloat($("#onlinePayment").val()) || 0;
            if ((cash + online) > gross) {
                e.preventDefault();
                return this.showAlert(`Total payment cannot exceed gross amount (₹${gross}).`, "danger");
            }
            if (online > 0 && !$("#onlinePaymentMethod").val()) {
                e.preventDefault();
                return this.showAlert("Please select a payment source for online payment.", "warning");
            }
        },

        showAlert(msg, type) {
            const iconMap = { danger:"exclamation-triangle-fill", warning:"exclamation-circle-fill", success:"check-circle-fill", info:"info-circle-fill" };
            const $el = $("#liveErrorAlertPlaceholder");
            $el.html(`<div class="alert alert-${type} alert-dismissible fade show d-flex align-items-center gap-2 mb-0" role="alert">
                <i class="bi bi-${iconMap[type]||"info-circle-fill"} flex-shrink-0"></i>
                <span>${msg}</span>
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
            </div>`);
            $el[0].scrollIntoView({ behavior:"smooth", block:"center" });
            clearTimeout(this._alertTimer);
            this._alertTimer = setTimeout(() => $el.find(".alert").alert("close"), 4000);
        }
    };

    // ── Clinic & Doctor Manager ───────────────────────────────────────────
    const ClinicDoctorManager = {
        init() { this.bindEvents(); this.updateClinicPrescription(); },
        bindEvents() {
            $("#clinic").on("change", this.handleClinicChange.bind(this));
            $("#doctor").on("change", this.handleDoctorChange.bind(this));
            $("#selectDoctorThanksCategory").on("change", this.handleThanksCategoryChange.bind(this));
            $("#category").on("change", this.handleCategoryChange.bind(this));
        },
        handleClinicChange() {
            const $selected = $("#clinic option:selected");
            const clinicId  = $selected.val();
            $("#clinicAddress").text($selected.data("address") || "—");
            $("#clinicInfoStrip").show();
            $("#clinicPrescription").attr("src", `/${$selected.data("clinic")}_${clinicId}.jpg`);
    
            $.ajax({
                type: "POST", url: "/patient/getListOfAttachedDoctorToClinic", data: { clinicId },
                success: doctors => {
                    const doctorEl = document.getElementById('doctor');
                    if (doctorEl && doctorEl.tomselect) doctorEl.tomselect.destroy();
                    const $doc = $("#doctor");
                    $doc.empty().append('<option value="0">Select a doctor</option>');
                    doctors.forEach(d => {
                        $doc.append(`<option value="${d.Id}"
                            data-flat-discount="${d.FlatDiscount}"
                            data-authorized-for-blood-test="${d.AuthorizedForBloodTest}">
                            ${d.FirstName} ${d.LastName} [${d.Degree1},${d.Degree2}]
                        </option>`);
                    });
                    TomSelectManager.init(doctorEl, { allowEmptyOption: true, minLength: 0 });
                    this.handleDoctorChange();
                },
                error: (jqXHR, textStatus, errorThrown) => {
                    PatientModule.showAlert(`Error loading doctors: ${textStatus} - ${errorThrown}`, "danger");
                }
            });
        },
        handleDoctorChange() {
            $(".alert").alert("close");
            const $sel = $("#doctor option:selected");
            const auth = $sel.data("authorized-for-blood-test");
            const flat = $sel.data("flat-discount");
            $("#doctorName").text($sel.text().trim() || "—");
            if (auth == 1) PatientModule.showAlert("Pathology test is applicable.", "success");
            else if (auth == 0) PatientModule.showAlert("Pathology test is not applicable.", "danger");
            if (flat > 0) PatientModule.showAlert(`Flat Discount of ${flat}% is applicable.`, "success");
        },
        handleThanksCategoryChange() {
            const $sel = $("#selectDoctorThanksCategory option:selected");
            $("#doctorCategoryThanks").val($sel.val());
            $("#doctorThanksCategory").val($sel.data("thanks-category-id"));
        },
    
        // ✅ FIXED: handleCategoryChange now uses your custom Tom Select init
        handleCategoryChange() {
            const $cat = $("#category option:selected");
            const selCategoryId = parseInt($cat.data("category-id"), 10);
            const testEl = document.getElementById('test');
        
            if (!selCategoryId) { 
                PatientModule.showAlert("Please select a valid category", "warning"); 
                return; 
            }
        
            if (!$(testEl).data("original-options")) {
                $(testEl).data("original-options", $(testEl).find('option').clone());
            }
        
            if (testEl && testEl.tomselect) testEl.tomselect.destroy();
        
            const $allOptions = $(testEl).data("original-options").clone();
            $(testEl).empty();
        
            let hasOptions = false;
            $allOptions.each(function () {
                const $o = $(this);
                const catId = parseInt($o.data("category-id"), 10);
                if (!catId || catId === selCategoryId) { 
                    $(testEl).append($o.clone()); 
                    hasOptions = true; 
                }
            });
        
            $(testEl).prop("disabled", false);
            $("#price, #discount").val("0");
            $("#testPriceInfo").empty();
        
            // ✅ Use custom init instead of TomSelectManager.init()
            if (typeof initTestTomSelect === 'function') {
                initTestTomSelect();
            } else {
                console.error('initTestTomSelect() not found! Falling back to default.');
                TomSelectManager.init(testEl, { allowEmptyOption: true, minLength: 0, placeholder: 'Type to search tests...' });
            }
        
            if (!hasOptions) PatientModule.showAlert("No tests available for this category", "info");
        },
        updateClinicPrescription() {
            const $sel = $("#clinic option:selected");
            $("#clinicPrescription").attr("src", `/${$sel.data("clinic")}_${$sel.val()}.jpg`);
        }
    }

    // ── Test Completion Manager ───────────────────────────────────────────
    const TestCompletionManager = {
        init() { this.bindEvents(); },
        bindEvents() {
            $("#completeBtn").on("click", function () {
                const checkboxes = $("input[name='selectedTests[]']");
                if (checkboxes.length === 0) {
                    const btn = document.getElementById("completeBtn");
                    if (btn) btn.outerHTML = `<div class="alert alert-success d-inline-flex align-items-center mt-3 mb-3" role="alert"><i class="bi bi-check2-circle me-2"></i>All tests completed.</div>`;
                    return;
                }
                checkboxes.filter(":checked").length === 0
                    ? $("#warningModal").modal("show")
                    : $("#completeConfirmModal").modal("show");
            });
            $("#confirmComplete").on("click", function () { $("#completeTestsForm").submit(); });
            $("#selectAll").on("change", function () { $(".test-checkbox").prop("checked", this.checked); });
        }
    };

    // ── Form Handlers ─────────────────────────────────────────────────────
    const FormHandlers = {
        init() {
            function handleCategoryChange() {
                const sel = $("#mainCategory").find(":selected").text()?.trim().toLowerCase();
                const isPathology = sel === "pathology";
                $(".pathology").toggleClass("d-none", !isPathology).find("input").prop("required", isPathology);
                $("#noOfFilms, #filmRequired").prop("required", !isPathology).closest(".col-md-6, .col-12").toggle(!isPathology);
                $(".fr-box").closest(".col-md-6, .col-12").toggle(!isPathology).find("input, select, textarea").prop("required", !isPathology);
            }
            $("#mainCategory").on("change", handleCategoryChange);
            setTimeout(handleCategoryChange, 400);
            $("#attachDoctorToClinic").on("submit", e => {
                if (!$("#attachDoctorToClinic input:checked").length) {
                    PatientModule.showAlert("No doctor selected.", "danger");
                    e.preventDefault();
                }
            });
        }
    };

    // ── Financial Year Handler ────────────────────────────────────────────
    const FinancialYearHandler = {
        init() {
            if (!document.getElementById('financialYear')) return;
            const currentYear    = new Date().getFullYear();
            const financialYears = Array.from({ length: 6 }, (_, i) => `${currentYear-i-1}-${currentYear-i}`);
            const fyEl           = document.getElementById('financialYear');
            financialYears.forEach(y => {
                const opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                fyEl.appendChild(opt);
            });
            if (fyEl.tomselect) fyEl.tomselect.sync();

            $("#financialYear").on("change", function () {
                const [startYear, endYear] = $(this).val().split("-");
                const fp = document.querySelector("#FromDate")?._flatpickr;
                const tp = document.querySelector("#ToDate")?._flatpickr;
                if (fp) fp.setDate(`01-04-${startYear}`, true);
                if (tp) tp.setDate(`31-03-${endYear}`,   true);
            });

            $(".quick-filter").on("click", function () {
                const filter = $(this).data("filter");
                const fp     = document.querySelector("#FromDate")?._flatpickr;
                const tp     = document.querySelector("#ToDate")?._flatpickr;
                if (filter === "currentFY")       { $("#financialYear").val(financialYears[0]).change(); }
                else if (filter === "lastFY")     { $("#financialYear").val(financialYears[1]).change(); }
                else if (filter === "last3Months") {
                    const to = new Date(), from = new Date();
                    from.setMonth(from.getMonth() - 3);
                    if (fp) fp.setDate(from, true);
                    if (tp) tp.setDate(to,   true);
                }
            });
        }
    };

    // ── Challan Modal ─────────────────────────────────────────────────────
    const ChallanModal = {
        init() {
            const $modal = $("#confirmModalChallan");
            $(".action-btn").on("click", function () {
                const $btn      = $(this);
                const challanId = $btn.data("id");
                const customer  = $btn.data("customer");
                const action    = $btn.data("action");
                $("#hiddenChallanId").val(challanId);
                $("#hiddenCustomerId").val($btn.data("customer-id"));
                $("#hiddenActionType").val(action);
                const cfg = {
                    convert:  { title:"Confirm Conversion",   body:(id,c)=>`Are you sure you want to <strong>convert Challan ${id}</strong> for <strong>${c}</strong>?`,       text:"Yes, Convert", cls:"btn btn-success", action:"/billing/convertToSale" },
                    delivery: { title:"Confirm Delivery",     body:(id,c)=>`Are you sure you want to <strong>mark delivery Challan ${id}</strong> for <strong>${c}</strong>?`, text:"Yes, Deliver", cls:"btn btn-primary",  action:"/billing/deliver" },
                    cancel:   { title:"Confirm Cancellation", body:(id,c)=>`Are you sure you want to <strong>cancel Challan ${id}</strong> for <strong>${c}</strong>?`,        text:"Yes, Cancel",  cls:"btn btn-danger",   action:"/billing/cancelChallan" }
                }[action];
                $("#modalTitle").text(cfg.title);
                $("#modalBody").html(cfg.body(challanId, customer));
                $("#modalConfirmBtn").text(cfg.text).attr("class", cfg.cls);
                $("#actionForm").attr("action", cfg.action);
                $modal.modal("show");
            });
        }
    };

    // ── Expired Stock UI ──────────────────────────────────────────────────
    const ExpiredStockUI = {
        modal: null,
        init() {
            const modalEl = document.getElementById("actionModal");
            if (!modalEl || typeof bootstrap === "undefined") return;
            this.modal = new bootstrap.Modal(modalEl, { backdrop:"static", keyboard:false });
            this.bindEvents();
        },
        bindEvents() {
            $("#selectAll").on("change", e => { $(".row-check").prop("checked", e.target.checked).trigger("change"); });
            $(document).on("change", ".row-check", () => {
                const count = $(".row-check:checked").length;
                $("#moveSelectedBtn").prop("disabled", count===0).text(count>0 ? `Move Selected (${count})` : "Move Selected");
            });
            $("#moveSelectedBtn").on("click", e => { e.preventDefault(); this.confirmMove(); });
            $("#actionModalConfirmBtn").on("click", () => this.submitForm());
        },
        confirmMove() {
            const count = $(".row-check:checked").length;
            if (!count) return;
            $("#actionModalTitle").text("Confirm Action");
            $("#actionModalBody").html(`<p class="mb-0">Are you sure you want to move <strong>${count}</strong> item(s) to expired stock?</p>`);
            $("#actionModalConfirmBtn").removeClass("btn-success").addClass("btn-danger").prop("disabled",false).text("Yes, Move");
            this.modal.show();
        },
        submitForm() {
            $("#actionModalConfirmBtn").prop("disabled",true).text("Processing...");
            document.getElementById("expiredStockForm").submit();
        }
    };

    // ── Expiry Return Manager ─────────────────────────────────────────────
    const ExpiryReturnManager = {
        init() { this.bindEvents(); },
        bindEvents() {
            $(".selectRow").on("change", this.handleRowSelection.bind(this));
            $("#selectAllExpired").on("change", this.handleSelectAll.bind(this));
            $(".sendQty").on("input", this.calculateRow.bind(this));
            $("#expiryReturnForm").on("submit", this.validateSubmission.bind(this));
            $("#expiryReturnForm").on("submit", this.validateForm.bind(this));
        },
        calculateRow(e) {
            const row = $(e.target).closest("tr");
            const qty = parseFloat(row.find(".sendQty").val()) || 0;
            const rate = parseFloat(row.find(".rate").text()) || 0;
            const gst  = parseFloat(row.find(".gst").text())  || 0;
            const taxable = qty*rate, gstAmt = taxable*gst/100, total = taxable+gstAmt;
            row.find(".taxable").text(taxable.toFixed(2));
            row.find(".gstAmount").text(gstAmt.toFixed(2));
            row.find(".total").text(total.toFixed(2));
            this.calculateTotals();
        },
        calculateTotals() {
            let t=0, g=0, gr=0;
            $(".taxable").each(function(){ t  += parseFloat($(this).text())||0; });
            $(".gstAmount").each(function(){ g  += parseFloat($(this).text())||0; });
            $(".total").each(function(){ gr += parseFloat($(this).text())||0; });
            $("#totalTaxable").text(t.toFixed(2));
            $("#totalGST").text(g.toFixed(2));
            $("#grandTotal").text(gr.toFixed(2));
        },
        validateForm(e) {
            let hasError = false;
            $(".selectRow:checked").each(function () {
                const qtyInput = $(this).closest("tr").find(".sendQty");
                const value = qtyInput.val(), max = parseInt(qtyInput.attr("max"),10)||0;
                if (value===""||parseInt(value,10)<=0) {
                    hasError=true; qtyInput.addClass("is-invalid");
                    if (!qtyInput.next(".invalid-feedback").length) qtyInput.after(`<div class="invalid-feedback">Please enter a valid quantity</div>`);
                } else if (parseInt(value,10)>max) {
                    hasError=true; qtyInput.addClass("is-invalid");
                    if (!qtyInput.next(".invalid-feedback").length) qtyInput.after(`<div class="invalid-feedback">Quantity exceeds remaining stock</div>`);
                } else { qtyInput.removeClass("is-invalid"); qtyInput.next(".invalid-feedback").remove(); }
            });
            if (hasError) { e.preventDefault(); PatientModule.showAlert("Please correct the highlighted fields.","danger"); }
        },
        handleRowSelection(e) {
            const cb=$(e.target), qi=cb.closest("tr").find(".sendQty");
            cb.is(":checked") ? qi.prop("disabled",false).focus() : qi.prop("disabled",true).val("").removeClass("is-invalid").next(".invalid-feedback").remove();
        },
        handleSelectAll(e) {
            const checked=$(e.target).is(":checked");
            $(".selectRow").each(function(){ $(this).prop("checked",checked).trigger("change"); });
        },
        validateSubmission(e) {
            let valid=true;
            $(".selectRow:checked").each(function () {
                const qi=$(this).closest("tr").find(".sendQty");
                const max=parseFloat(qi.attr("max")), entered=parseFloat(qi.val());
                if (!entered||entered<=0) { PatientModule.showAlert("Please enter quantity for selected item.","danger"); valid=false; return false; }
                if (entered>max) { PatientModule.showAlert("Send quantity cannot exceed remaining quantity.","danger"); valid=false; return false; }
            });
            if (!valid) e.preventDefault();
        }
    };

    // ── Arrived Modal ─────────────────────────────────────────────────────
    const ArrivedModal = {
        init() { this.bindEvents(); },
        bindEvents() {
            $(document).on("click", ".btn-arrived", function () {
                const dues = parseFloat($(this).data("dues"))||0;
                $("#arrivedPatientId").val($(this).data("patient-id"));
                $("#arrivedPatientName").text($(this).data("patient-name"));
                $("#arrivedApptDate").text($(this).data("advance-date"));
                $("#arrivedCash, #arrivedOnline").val(0);
                $("#arrivedOnlineSourceWrap").hide();
                $("#arrivedRemainingDues").text("₹"+dues.toFixed(2));
                if (dues>0) { $("#arrivedNoDues").hide(); $("#arrivedDuesSection").show(); $("#arrivedDuesAmount").text("₹"+dues.toFixed(2)); }
                else { $("#arrivedDuesSection").hide(); $("#arrivedNoDues").show(); }
            });
            $("#arrivedOnline").on("input", function () {
                const val = parseFloat($(this).val())||0;
                val>0 ? $("#arrivedOnlineSourceWrap").show() : ($("#arrivedOnlineSourceWrap").hide(), $("#arrivedOnlineSource").val(""));
                ArrivedModal.updateRemaining();
            });
            $("#arrivedCash").on("input", function () { ArrivedModal.updateRemaining(); });
            $("#arrivedCash, #arrivedOnline")
                .on("focus", function () { if($(this).val()==0) $(this).val(""); })
                .on("blur",  function () { if($(this).val()==="") $(this).val(0); });
        },
        updateRemaining() {
            const dues = parseFloat($("#arrivedDuesAmount").text().replace("₹",""))||0;
            const rem  = Math.max(0, dues-(parseFloat($("#arrivedCash").val())||0)-(parseFloat($("#arrivedOnline").val())||0));
            $("#arrivedRemainingDues").text("₹"+rem.toFixed(2))
                .css("color", rem===0&&dues>0 ? "#0c9474" : "#e53e3e");
        }
    };

    // ── Expired Settlement UI ─────────────────────────────────────────────
    class ExpiredSettlementUI {
        constructor() {
            this.state = { modal:null, expiredId:null, supplierId:null, remainingAmount:0, totalRecoverable:0, selectedInvoiceId:null, creditBalance:0 };
            this.searchTimeout = null;
        }
        init() {
            const modalEl = document.getElementById("settlementModal");
            if (!modalEl||typeof bootstrap==="undefined") return;
            this.state.modal = new bootstrap.Modal(modalEl,{backdrop:"static",keyboard:false});
            this.bindEvents();
        }
        bindEvents() {
            $(document).on("click",".open-settle-modal",e=>this.openModal(e));
            $("#invoiceSearch").on("keyup",e=>{ clearTimeout(this.searchTimeout); this.searchTimeout=setTimeout(()=>this.searchInvoice(e),400); });
            $(document).on("click",".select-invoice",e=>this.selectInvoice(e));
            $(document).on("change",".price-history",e=>{ const row=$(e.currentTarget).closest(".product-row"); row.find(".old-price").val($(e.currentTarget).val()); this.calculateRow(row); });
            $(document).on("keyup",".old-price",e=>this.calculateRow($(e.currentTarget).closest(".product-row")));
            $("#confirmSettlement").on("click",()=>this.submitSettlement());
        }
        openModal(e) {
            const btn=$(e.currentTarget);
            Object.assign(this.state,{expiredId:btn.data("id"),supplierId:btn.data("supplierid"),remainingAmount:parseFloat(btn.data("remaining")),totalRecoverable:0,creditBalance:0,selectedInvoiceId:null});
            $("#modalProduct").text(btn.data("product")); $("#modalSupplier").text(btn.data("supplier"));
            $("#modalRemaining").text(`₹ ${this.state.remainingAmount.toFixed(2)}`);
            this.resetModal(); this.state.modal.show();
        }
        resetModal() { $("#invoiceSearch").val(""); $("#invoiceList,#invoiceProducts").empty(); $("#creditSection").remove(); $("#totalRecoverable").text("0.00"); $("#confirmSettlement").prop("disabled",true); }
        searchInvoice(e) {
            const kw=$(e.currentTarget).val();
            if (!kw||kw.length<2) { $("#invoiceList").empty(); return; }
            $.get("/billing/searchSupplierInvoice",{keyword:kw,supplierId:this.state.supplierId},data=>{
                const list=$("#invoiceList").empty();
                if (!data.length) { list.html(`<div class="text-muted small p-2">No invoice found</div>`); return; }
                data.forEach(inv=>list.append(`<a href="#" class="list-group-item list-group-item-action select-invoice" data-id="${inv.Id}"><div class="fw-semibold">${inv.SupplierInvoiceNo}</div></a>`));
            });
        }
        selectInvoice(e) {
            e.preventDefault();
            const invoiceId=$(e.currentTarget).data("id"); this.state.selectedInvoiceId=invoiceId;
            $("#invoiceProducts").html(`<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`);
            $.get("/billing/checkInvoiceCredit",{invoiceId},creditData=>{
                this.renderCreditSection(creditData);
                $.get("/billing/getInvoiceProducts",{invoiceId},products=>this.renderProducts(products));
            });
        }
        loadPriceHistory(products) {
            if (!products?.length) return;
            $.get("/billing/getLastThreePricesBulk",{productIds:products.map(p=>p.ProductId).join(","),supplierId:this.state.supplierId},data=>{
                Object.keys(data).forEach(pid=>{
                    const dd=$(`.product-row[data-product-id="${pid}"]`).find(".price-history");
                    if (dd.length) data[pid].forEach(p=>dd.append(`<option value="${p.PurchasePrice}">₹ ${p.PurchasePrice} (${p.InvoiceDate})</option>`));
                });
            });
        }
        renderCreditSection(creditData) {
            $("#creditSection").remove(); this.state.creditBalance=0;
            if (!creditData?.length) return;
            let html=`<div id="creditSection" class="alert alert-info"><h6 class="fw-bold mb-2">Available Credit</h6>`;
            creditData.forEach(c=>{ const a=parseFloat(c.AvailableAmount); this.state.creditBalance+=a; html+=`<div class="d-flex justify-content-between"><span>${c.ProductName}</span><span>₹ ${a.toFixed(2)}</span></div>`; });
            html+=`<hr><div class="d-flex justify-content-between fw-bold"><span>Total Credit</span><span>₹ ${this.state.creditBalance.toFixed(2)}</span></div></div>`;
            $("#invoiceProducts").before(html);
        }
        renderProducts(products) {
            if (!products.length) { $("#invoiceProducts").html(`<div class="text-muted small">No products found.</div>`); return; }
            let html=`<div class="row g-3">`;
            products.forEach(p=>{ html+=`<div class="col-12"><div class="card shadow-sm product-row" data-product-id="${p.ProductId}" data-invoice-id="${p.InvoiceId}" data-invoice-detail-id="${p.InvoiceDetailId}" data-price="${p.PurchasePrice}" data-qty="${p.Quantity}"><div class="card-body"><div class="d-flex justify-content-between mb-2"><div><h6 class="mb-1">${p.ProductName}</h6><small class="text-muted">Qty: ${p.Quantity} | Current: ₹ ${p.PurchasePrice}</small></div><div class="text-success fw-bold fs-5">₹ <span class="recoverable-amount">0.00</span></div></div><select class="form-select form-select-sm mb-2 price-history"><option value="">Select from price history</option></select><input type="number" class="form-control form-control-sm old-price" placeholder="Enter old price"></div></div></div>`; });
            html+=`</div><div class="border-top mt-4 pt-3 d-flex justify-content-between"><h6>Total Recoverable</h6><h5>₹ <span id="totalRecoverable">0.00</span></h5></div>`;
            $("#invoiceProducts").html(html); this.loadPriceHistory(products);
        }
        calculateRow(card) {
            const cp=parseFloat(card.data("price")), qty=parseFloat(card.data("qty"));
            const op=parseFloat(card.find(".old-price").val())||0;
            card.find(".recoverable-amount").text((op>cp ? Math.abs(cp-op)*qty : 0).toFixed(2));
            this.calculateTotal();
        }
        calculateTotal() {
            let total=0; $(".recoverable-amount").each(function(){ total+=parseFloat($(this).text())||0; });
            this.state.totalRecoverable=total;
            const adj=Math.max(0,total-this.state.creditBalance);
            $("#totalRecoverable").text(adj.toFixed(2));
            adj>this.state.remainingAmount ? $("#totalRecoverable").addClass("text-danger").removeClass("text-primary") : $("#totalRecoverable").addClass("text-primary").removeClass("text-danger");
            $("#confirmSettlement").prop("disabled",adj<=0);
        }
        submitSettlement() {
            if (this.state.totalRecoverable<=0) { Swal.fire("Invalid","Recoverable amount must be greater than zero.","warning"); return; }
            const settlements=[];
            $(".product-row").each(function(){
                const card=$(this), rec=parseFloat(card.find(".recoverable-amount").text());
                if (rec>0) settlements.push({invoiceId:card.data("invoice-id"),invoiceDetailId:card.data("invoice-detail-id"),productId:card.data("product-id"),qty:card.data("qty"),oldPrice:parseFloat(card.find(".old-price").val()),settlementAmount:rec,newPrice:parseFloat(card.data("price"))});
            });
            const btn=$("#confirmSettlement").prop("disabled",true).html(`<span class="spinner-border spinner-border-sm me-2"></span>Processing`);
            $.ajax({url:"/billing/expiredStockSettle",type:"POST",contentType:"application/json",
                data:JSON.stringify({expiredId:this.state.expiredId,invoiceId:this.state.selectedInvoiceId,settlementType:$("#settlementType").val(),settlements}),
                success:()=>Swal.fire("Success","Settlement completed.","success").then(()=>location.reload()),
                error:()=>{ Swal.fire("Error","Settlement failed.","error"); btn.prop("disabled",false).text("Confirm Settlement"); }
            });
        }
    }

    // ── Export Excel ──────────────────────────────────────────────────────
    class ExportExcel {
        constructor() {}
        init() {
            $(document).on("click","[data-export-table]",function(){
                const tableId=$(this).data("export-table"), fileName=$(this).data("export-name")||"export";
                const table=document.getElementById(tableId);
                if (!table) { console.error("Table not found:",tableId); return; }
                XLSX.writeFile(XLSX.utils.table_to_book(table,{sheet:"Sheet1"}),fileName+".xlsx");
            });
        }
    }

    // ── Customer Ledger Handler ───────────────────────────────────────────
    const CustomerLedgerHandler = {
        init() {
            this.updateTotals();
            $("#customerLedgerTable").on("change",".include-total",()=>this.updateTotals());
        },
        updateTotals() {
            let s=0, p=0, pe=0;
            $("#customerLedgerTable tbody tr").each(function(){
                const $r=$(this);
                if ($r.find(".include-total").is(":checked")) {
                    s  += parseFloat($r.find("[data-sales]").data("sales"))||0;
                    p  += parseFloat($r.find("[data-payments]").data("payments"))||0;
                    pe += parseFloat($r.find("[data-pending]").data("pending"))||0;
                }
            });
            $("#totalsRow .total-sales").text("₹ "+s.toFixed(2));
            $("#totalsRow .total-payments").text("₹ "+p.toFixed(2));
            $("#totalsRow .total-pending").text("₹ "+pe.toFixed(2));
        }
    };

    // ── Initialize All Modules ────────────────────────────────────────────
    Sidebar.init();
    UIComponents.init();
    ClinicDoctorManager.init();
    FormHandlers.init();
    FinancialYearHandler.init();
    TestCompletionManager.init();
    ChallanModal.init();
    CustomerLedgerHandler.init();
    ExpiredStockUI.init();
    ExpiryReturnManager.init();
    PatientModule.init();
    ArrivedModal.init();
    new ExpiredSettlementUI().init();
    new ExportExcel().init();

    // ── Date Setup (register patient page only) ───────────────────────────
    const today    = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const formatDisplay   = d => d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
    const formatForServer = d => d.toLocaleDateString("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" }).replace(/\//g, "-");

    $("#dateDisplay").text(formatDisplay(today));
    $("#registrationDate").val(formatForServer(today));
    $("#date").val(formatForServer(today));

    const advancePickerEl = document.getElementById("advanceDatePicker");
    const advancePicker   = advancePickerEl ? flatpickr(advancePickerEl, {
        minDate: "today", dateFormat: "d-m-Y", disableMobile: true,
        onChange(selectedDates) {
            if (!selectedDates.length) return;
            const picked = selectedDates[0];
            $("#advanceBookingDate").val(formatForServer(picked));
            $("#advanceDatePicker").attr("data-display", formatDisplay(picked));
        }
    }) : null;

    $("#advanceBookingToggle").on("change", function () {
        if (!advancePicker) return;
        if (this.checked) {
            $("#advanceDateWrap").show();
            advancePicker.setDate(tomorrow, false);
            $("#advanceBookingDate").val(formatForServer(tomorrow));
            $("#isAdvanceBooking").val("1");
        } else {
            $("#advanceDateWrap").hide();
            advancePicker.clear();
            $("#advanceBookingDate").val("");
            $("#isAdvanceBooking").val("0");
        }
    });

});