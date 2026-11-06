// ═══════════════════════════════════════════════════════════════════════════════
// patientBilling.js  —  Patient registration & billing pages ONLY
// Depends on: common.js (TomSelectManager, FormValidation)
// 
// FIXES APPLIED:
//   1. Single Tom Select init for #test with score-based category filtering
//   2. Duplicate sub-test detection: skips duplicate, keeps main test, adjusts price
//   3. No DOM manipulation for category filter — uses Tom Select native methods
//   4. Proper grand total calculation accounting for skipped sub-tests
// ═══════════════════════════════════════════════════════════════════════════════
"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════════
let _testTomSelectInstance = null;  // Reference to the single Tom Select instance

// ═══════════════════════════════════════════════════════════════════════════════
// TEST TOM SELECT — Single initialization, score-based category filtering
// ═══════════════════════════════════════════════════════════════════════════════
function initTestTomSelect() {
    const testEl = document.getElementById('test');
    if (!testEl) return;

    // Destroy existing if any
    if (testEl.tomselect) {
        testEl.tomselect.destroy();
    }

    // Parse all options from the DOM <select>
    const optionsData = [];
    Array.from(testEl.options).forEach(opt => {
        const entry = { value: opt.value, text: opt.text.trim() };

        if (opt.value) {
            entry._price       = parseFloat(opt.dataset.price || 0);
            entry._grandTotal  = parseFloat(opt.dataset.grandTotal || entry._price);
            entry._hasSubs     = opt.dataset.hasSubtests === '1';
            entry._categoryId  = String(opt.dataset.categoryId || '0');

            // Parse sub-tests JSON
            let subs = [];
            try {
                const raw = (opt.dataset.subtests || '[]')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&amp;/g, '&');
                subs = JSON.parse(raw);
            } catch (e) {
                console.warn('Sub-test JSON parse error:', e, opt.dataset.subtests);
            }
            entry._subsArray = subs;
            entry._tokens = opt.text.trim() + ' ' + subs.map(s => s.name).join(' ');
        }
        optionsData.push(entry);
    });

    // Create Tom Select with score-based category filtering
    _testTomSelectInstance = new TomSelect(testEl, {
        allowEmptyOption: true,
        maxOptions:       300,
        minLength:        0,
        plugins:          {},
        dropdownParent:   'body',
        valueField:       'value',
        labelField:       'text',
        searchField:      ['text', '_tokens'],
        options:          optionsData,

        // ═══════════════════════════════════════════════════════════════════════
        // KEY: Custom score function filters by category internally
        // This avoids destroying/recreating the instance when category changes
        // ═══════════════════════════════════════════════════════════════════════
        score: function(search) {
            const categoryFilter = this._categoryFilter || '';
            const self = this;
            return function(item) {
                // If category filter is active, exclude non-matching items
                if (categoryFilter && item._categoryId !== categoryFilter) {
                    return 0;
                }
                // Use default scoring for matching items
                return self.getScoreFunction(search)(item);
            };
        },

        render: {
            option: function(data, escape) {
                if (!data.value) {
                    return '<div style="color:#94a3b8;font-style:italic;padding:8px 12px">Select Test</div>';
                }

                const price       = parseFloat(data._price || 0);
                const grandTotal  = parseFloat(data._grandTotal || price);
                const hasSubs     = data._hasSubs === true;
                const subs        = data._subsArray || [];

                let subRows = '';
                let totalDiscount = 0;

                subs.forEach(s => {
                    const sp = parseFloat(s.price || 0);
                    const sd = parseFloat(s.discount || 0);
                    const snet = sp - sd;
                    totalDiscount += sd;

                    const discHtml = sd > 0
                        ? '<span class="dp-sub-disc">-₹' + sd.toLocaleString('en-IN') + '</span>' +
                          '<span class="dp-sub-net">₹' + snet.toLocaleString('en-IN') + '</span>'
                        : '<span class="dp-sub-price">₹' + sp.toLocaleString('en-IN') + '</span>';

                    subRows +=
                        '<div class="dp-sub-item">' +
                            '<span class="dp-sub-arrow">↳</span>' +
                            '<span class="dp-sub-name">' + escape(s.name) + '</span>' +
                            discHtml +
                        '</div>';
                });

                const finalTotal = grandTotal - totalDiscount;

                return '<div class="dp-test-item">' +
                    '<div class="dp-test-name">' + escape(data.text) + '</div>' +
                    '<div class="dp-test-prices">' +
                        (hasSubs
                            ? '<span class="dp-base-price">₹' + price.toLocaleString('en-IN') + ' base</span>' +
                              '<span class="dp-plus">&nbsp;+&nbsp;</span>' +
                              '<span class="dp-sub-total">₹' + finalTotal.toLocaleString('en-IN') + ' total</span>' +
                              (totalDiscount > 0 ? '<span class="dp-total-disc"> (saved ₹' + totalDiscount.toLocaleString('en-IN') + ')</span>' : '')
                            : '<span class="dp-total-price">₹' + price.toLocaleString('en-IN') + '</span>'
                        ) +
                    '</div>' +
                    (subRows ? '<div class="dp-subtests">' + subRows + '</div>' : '') +
                '</div>';
            },

            item: function(data, escape) {
                if (!data.value) return '<div>' + escape(data.text) + '</div>';
                
                const grandTotal  = parseFloat(data._grandTotal || 0);
                const subs        = data._subsArray || [];
                const totalDiscount = subs.reduce((sum, s) => sum + parseFloat(s.discount || 0), 0);
                const finalTotal  = grandTotal - totalDiscount;
                
                return '<div>' + escape(data.text) +
                    ' <span style="color:#6B7280;font-size:11px;font-weight:500">' +
                    '₹' + finalTotal.toLocaleString('en-IN') + '</span></div>';
            }
        }
    });

    return _testTomSelectInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET CATEGORY FILTER on existing Tom Select instance
// Called by ClinicDoctorManager when category changes
// ═══════════════════════════════════════════════════════════════════════════════
function setTestCategoryFilter(categoryId) {
    if (!_testTomSelectInstance) return;

    const filterValue = (!categoryId || categoryId === '' || categoryId === '0') ? '' : String(categoryId);
    
    // Set filter on instance
    _testTomSelectInstance._categoryFilter = filterValue;
    
    // Clear current selection
    _testTomSelectInstance.clear(true);
    
    // Refresh options to re-apply score filter
    _testTomSelectInstance.refreshOptions(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSS for sub-test dropdown rows
// ═══════════════════════════════════════════════════════════════════════════════
(function injectTestDropdownStyles() {
    if (document.getElementById('dp-test-styles')) return;
    const s = document.createElement('style');
    s.id = 'dp-test-styles';
    s.textContent = `
        .dp-test-item   { padding:4px 0; line-height:1.4; }
        .dp-test-name   { font-weight:600; font-size:13px; color:#111827; }
        .dp-test-prices { font-size:11.5px; margin-top:2px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .dp-base-price  { color:#6B7280; }
        .dp-plus        { color:#CBD5E1; }
        .dp-sub-total   { color:#185FA5; font-weight:600; }
        .dp-total-price { color:#185FA5; font-weight:600; }
        .dp-subtests    { margin-top:5px; padding:4px 0 2px 10px; border-left:2px solid #e5e7eb; }
        .dp-sub-item    { display:flex; align-items:center; gap:5px; font-size:11px; padding:2px 0; }
        .dp-sub-arrow   { color:#CBD5E1; flex-shrink:0; }
        .dp-sub-name    { flex:1; color:#374151; font-weight:500; }
        .dp-sub-price   { color:#185FA5; font-weight:600; }
        .dp-sub-disc    { color:#dc2626; font-size:10px; text-decoration:line-through; }
        .dp-sub-net     { color:#16a34a; font-weight:700; margin-left:2px; }
    `;
    document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// DOM-READY — All modules initialize here
// ═══════════════════════════════════════════════════════════════════════════════
$(document).ready(function () {

    // ═══════════════════════════════════════════════════════════════════════════
    // PATIENT MODULE — Test management, billing, payment
    // ═══════════════════════════════════════════════════════════════════════════
    const PatientModule = {
        tests: [],           // [{TestId, TestName, Price, Discount, AddedSubTests[]}]
        subTests: [],        // [{TestId, SubTestId, SubTestName, Price, Discount}]
        skippedSubTests: [], // Track skipped duplicates for display
        _alertTimer: null,

        init() {
            if (!document.getElementById('registerForm')) return;
            this.cacheDOM();
            this.bindEvents();
            this.loadExistingTests();
            this.updatePaymentDisplay();
            
            // Initialize Tom Select for #test — SINGLE SOURCE OF TRUTH
            initTestTomSelect();
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
            $("#addTest").on("click",   this.addTest.bind(this));
            $(document).on("click",    ".removeTest",               this.removeTest.bind(this));
            
            // Use Tom Select's change event instead of native select change
            $(document).on("change",   "#test",                     this.updateTestFields.bind(this));
            
            $("#cashPayment, #onlinePayment").on("input",          this.updatePaymentDisplay.bind(this));
            $("#registerForm").on("submit",                          this.validateBeforeSubmit.bind(this));

            $(document).on("focus", "#cashPayment, #onlinePayment, #discount", function () {
                if ($(this).val() == 0) $(this).val("");
            });
            $(document).on("blur", "#cashPayment, #onlinePayment, #discount", function () {
                if ($(this).val() === "") $(this).val(0);
            });

            $(document).on("change", ".pm-radio", function () {
                $("#onlinePaymentMethod").val($(this).data("source-id"));
                $(".pm-radio").each(function () {
                    const $lbl = $(`label[for="${$(this).attr("id")}"]`);
                    $(this).prop("checked")
                        ? $lbl.css({ borderColor:"var(--primary)", background:"var(--primary-light)", color:"var(--primary)" })
                        : $lbl.css({ borderColor:"", background:"", color:"" });
                });
            });

            // Sub-test discount input handlers
            $(document).on("input", ".sub-discount-input", function () {
                const $input   = $(this);
                const price    = parseFloat($input.data("price")) || 0;
                let   discount = parseFloat($input.val())         || 0;
                
                if (discount > price) { 
                    discount = price; 
                    $input.val(price.toFixed(2)); 
                }
                
                $input.closest("tr").find(".sub-net-cell").text((price - discount).toFixed(2));
                
                const subTestId = parseInt($input.closest("tr").find(".removeTest").data("attr-id"));
                const sub = PatientModule.subTests.find(s => s.SubTestId === subTestId);
                
                if (sub) {
                    const old = sub.Discount;
                    sub.Discount = discount;
                    PatientModule.$finalDiscount.val((parseFloat(PatientModule.$finalDiscount.val()) - old + discount).toFixed(2));
                    PatientModule.$grossAmount.val((parseFloat(PatientModule.$grossAmount.val()) + old - discount).toFixed(2));
                    PatientModule.updatePaymentDisplay();
                    PatientModule.updateStorage();
                }
            });
            
            $(document).on("focus", ".sub-discount-input", function () { 
                if ($(this).val() == 0) $(this).val(""); 
            });
            $(document).on("blur",  ".sub-discount-input", function () { 
                if ($(this).val() === "") $(this).val(0); 
            });
        },

        // ═══════════════════════════════════════════════════════════════════════
        // ADD TEST — With smart duplicate sub-test handling
        // ═══════════════════════════════════════════════════════════════════════
        addTest() {
            const testEl    = document.getElementById('test');
            const tsInst    = testEl && testEl.tomselect;
            const testId    = tsInst ? parseInt(tsInst.getValue(), 10) : parseInt(this.$test.val(), 10);
            
            if (!testId) {
                return this.showAlert("Please select a test before adding.", "warning");
            }

            // Get selected option data from Tom Select
            const selectedOption = tsInst ? tsInst.options[testId] : null;
            const testName  = selectedOption ? selectedOption.text : this.$test.find(':selected').text().split("—")[0].trim();
            const price     = parseFloat(this.$price.val())    || 0;
            const discount  = parseFloat(this.$discount.val()) || 0;

            // Check if main test already exists
            if (this.tests.some(t => t.TestId === testId)) {
                this.$tbody.find(`button[data-attr-id="${testId}"][data-attr-issubtest="false"]`)
                    .closest("tr").addClass("table-warning");
                setTimeout(() => this.$tbody.find(`button[data-attr-id="${testId}"]`).closest("tr").removeClass("table-warning"), 1500);
                return this.showAlert(`<strong>${testName}</strong> is already in the list.`, "danger");
            }

            if (discount > price) {
                return this.showAlert("Discount cannot exceed the test price.", "danger");
            }

            // ═══════════════════════════════════════════════════════════════════
            // DUPLICATE SUB-TEST HANDLING
            // Check each sub-test against already-added sub-tests
            // If duplicate: skip it, but still add main test
            // ═══════════════════════════════════════════════════════════════════
            const allSubs      = (window.subTestMap || {})[testId] || [];
            const existingNames = new Set(this.subTests.map(s => s.SubTestName.trim().toLowerCase()));
            const skippedNames = [];
            const addedSubs    = [];

            allSubs.forEach(s => {
                const subName = s.SubTestName.trim().toLowerCase();
                if (existingNames.has(subName)) {
                    skippedNames.push(s.SubTestName);
                } else {
                    addedSubs.push(s);
                }
            });

            // Add main test row
            this.addMainTestRow({ testId, testName, price, discount, skippedNames });

            // Attach sub-tests (only non-duplicates)
            this.attachSubTests(testId, addedSubs);

            // Show info about skipped sub-tests
            if (skippedNames.length > 0) {
                const skipMsg = skippedNames.length === 1 
                    ? `Sub-test "<strong>${skippedNames[0]}</strong>" was already added with another test — skipped to avoid double charging.`
                    : `Sub-tests "<strong>${skippedNames.join('", "')}</strong>" were already added with other tests — skipped to avoid double charging.`;
                this.showAlert(skipMsg, "info");
            }

            this.updateStorage();
            this.resetFields();
            this.toggleTable();
            $("#liveErrorAlertPlaceholder .alert-danger, #liveErrorAlertPlaceholder .alert-warning").remove();
        },

        addMainTestRow({ testId, testName, price, discount, skippedNames }) {
            const net = Math.max(0, price - discount);
            let skipBadge = '';
            
            if (skippedNames && skippedNames.length > 0) {
                skipBadge = `<span class="subtest-skipped-badge">
                    <i class="bi bi-info-circle"></i>
                    ${skippedNames.length} sub-test${skippedNames.length > 1 ? 's' : ''} skipped (already added)
                </span>`;
            }

            this.$tbody.append(`
                <tr data-main-test-id="${testId}">
                    <td>
                        <span class="test-badge-main">TEST</span> 
                        ${testName}
                        ${skipBadge}
                    </td>
                    <td>${price.toFixed(2)}</td>
                    <td>${discount.toFixed(2)}</td>
                    <td><strong>${net.toFixed(2)}</strong></td>
                    <td>
                        <button class="btn-remove-test removeTest" data-attr-id="${testId}" data-attr-issubtest="false" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`);
            
            this.tests.push({ 
                TestId: testId, 
                TestName: testName, 
                Price: price, 
                Discount: discount,
                skippedSubTests: skippedNames || []
            });
            
            this.updateTotals(price, discount);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // ATTACH SUB-TESTS — Only adds non-duplicate sub-tests
        // ═══════════════════════════════════════════════════════════════════════
        attachSubTests(mainTestId, subsToAdd) {
            subsToAdd.forEach(s => {
                this.addSubTestRow({ 
                    mainTestId, 
                    subTestId: s.SubTestId, 
                    subTestName: s.SubTestName, 
                    price: parseFloat(s.Price) || 0, 
                    discount: parseFloat(s.Discount) || 0 
                });
            });
        },

        addSubTestRow({ mainTestId, subTestId, subTestName, price, discount }) {
            const net = Math.max(0, price - discount);
            
            this.$tbody.append(`
                <tr class="subtest-row" ${mainTestId > 0 ? `data-sub-of="${mainTestId}"` : ""}>
                    <td><span class="test-badge-sub">SUB</span> ${subTestName}</td>
                    <td>${price.toFixed(2)}</td>
                    <td>
                        <input type="number" class="sub-discount-input" value="${discount.toFixed(2)}" min="0" max="${price}" data-price="${price}"
                            style="width:80px;height:28px;border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:0 8px;font-size:12px;font-family:'DM Mono',monospace;text-align:right">
                    </td>
                    <td class="sub-net-cell">${net.toFixed(2)}</td>
                    <td>
                        <button class="btn-remove-test removeTest" data-attr-id="${subTestId}" data-attr-issubtest="true" data-parent-test-id="${mainTestId}" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`);
            
            this.subTests.push({ 
                TestId: mainTestId, 
                SubTestId: subTestId, 
                SubTestName: subTestName, 
                Price: price, 
                Discount: discount 
            });
            
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
                
                // Remove associated sub-tests and adjust totals
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
            this.$finalDiscount.val(((parseFloat(this.$finalDiscount.val()) || 0) + discount).toFixed(2));
            this.$grossAmount.val(((parseFloat(this.$grossAmount.val()) || 0) + price).toFixed(2));
            this.updatePaymentDisplay();
        },

        updatePaymentDisplay() {
            const gross  = parseFloat($("#grossAmount").val())   || 0;
            const disc   = parseFloat($("#finalDiscount").val()) || 0;
            const net    = Math.max(0, gross - disc);
            const cash   = parseFloat($("#cashPayment").val())   || 0;
            const online = parseFloat($("#onlinePayment").val()) || 0;
            const paid   = cash + online;
            const due    = Math.max(0, net - paid);
            const change = Math.max(0, paid - net);

            $("#paidDisplay").text("₹" + paid.toFixed(2));
            $("#dueDisplay").text("₹" + due.toFixed(2));
            
            if (change > 0) { 
                $("#changeDisplay").text("₹" + change.toFixed(2)); 
                $("#changeRow").show(); 
            } else { 
                $("#changeRow").hide(); 
            }
            
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
                try { 
                    JSON.parse(mainData).forEach(t => {
                        // For existing tests, we don't know skipped sub-tests, so pass empty
                        this.addMainTestRow({ 
                            testId: t.TestId, 
                            testName: t.TestName, 
                            price: parseFloat(t.Price) || 0, 
                            discount: parseFloat(t.Discount) || 0,
                            skippedNames: t.skippedSubTests || []
                        });
                    }); 
                } catch(err) { 
                    console.error("loadExistingTests:", err); 
                }
            }
            
            if (subData) {
                try { 
                    JSON.parse(subData).forEach(s => {
                        this.addSubTestRow({ 
                            mainTestId: s.TestId, 
                            subTestId: s.SubTestId, 
                            subTestName: s.SubTestName, 
                            price: parseFloat(s.Price) || 0, 
                            discount: parseFloat(s.Discount) || 0 
                        });
                    }); 
                } catch(err) { 
                    console.error("loadExistingSubTests:", err); 
                }
            }
            
            this.toggleTable();
        },

        updateTestFields() {
            const testEl     = document.getElementById('test');
            const val        = testEl?.tomselect ? testEl.tomselect.getValue() : this.$test.val();
            const $selected  = this.$test.find(`option[value="${val}"]`);
            const basePrice  = parseFloat($selected.data("price"))      || 0;
            const grandTotal = parseFloat($selected.data("grand-total")) || basePrice;
            const hasSubs    = $selected.data("has-subtests") == 1;
            
            this.$discount.val(0);
            this.$price.val(basePrice);
            
            if (hasSubs) {
                $("#testPriceInfo").html(
                    `<span style="font-size:11px;color:#185FA5;font-weight:600">
                        Base ₹${basePrice.toLocaleString("en-IN")} · Total with sub-tests: 
                        <strong>₹${grandTotal.toLocaleString("en-IN")}</strong>
                    </span>`
                );
            } else {
                $("#testPriceInfo").empty();
            }
        },

        resetFields() {
            const testEl = document.getElementById('test');
            if (testEl?.tomselect) {
                testEl.tomselect.clear(true);
            }
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
                e.preventDefault(); 
                e.stopPropagation();
                form.classList.add("was-validated");
                const first = form.querySelector(":invalid");
                if (first) { 
                    first.scrollIntoView({ behavior:"smooth", block:"center" }); 
                    first.focus(); 
                }
                return this.showAlert("Please fill in all required fields.", "danger");
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
            const iconMap = { 
                danger:"exclamation-triangle-fill", 
                warning:"exclamation-circle-fill", 
                success:"check-circle-fill", 
                info:"info-circle-fill" 
            };
            const $el = $("#liveErrorAlertPlaceholder");
            
            if (!$el.length) return;
            
            $el.html(
                `<div class="alert alert-${type} alert-dismissible fade show d-flex align-items-center gap-2 mb-0" role="alert">
                    <i class="bi bi-${iconMap[type]||"info-circle-fill"} flex-shrink-0"></i>
                    <span>${msg}</span>
                    <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
                </div>`
            );
            
            $el[0].scrollIntoView({ behavior:"smooth", block:"center" });
            clearTimeout(this._alertTimer);
            this._alertTimer = setTimeout(() => $el.find(".alert").alert("close"), 4000);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // CLINIC & DOCTOR MANAGER — Fixed category change handler
    // ═══════════════════════════════════════════════════════════════════════════════
    const ClinicDoctorManager = {
        init() { 
            this.bindEvents(); 
            this.updateClinicPrescription(); 
        },
        
        bindEvents() {
            $("#clinic").on("change",   this.handleClinicChange.bind(this));
            $("#doctor").on("change",   this.handleDoctorChange.bind(this));
            $("#selectDoctorThanksCategory").on("change", this.handleThanksCategoryChange.bind(this));
            $("#category").on("change", this.handleCategoryChange.bind(this));
        },
        
        handleClinicChange() {
            const $sel     = $("#clinic option:selected");
            const clinicId = $sel.val();
            
            $("#clinicAddress").text($sel.data("address") || "—");
            $("#clinicInfoStrip").show();
            $("#clinicPrescription").attr("src", `/${$sel.data("clinic")}_${clinicId}.jpg`);
            
            $.ajax({
                type: "POST", 
                url: "/patient/getListOfAttachedDoctorToClinic", 
                data: { clinicId },
                success: doctors => {
                    const doctorEl = document.getElementById('doctor');
                    if (doctorEl?.tomselect) doctorEl.tomselect.destroy();
                    
                    const $doc = $("#doctor");
                    $doc.empty().append('<option value="0">Select a doctor</option>');
                    
                    doctors.forEach(d => $doc.append(
                        `<option value="${d.Id}" data-flat-discount="${d.FlatDiscount}" data-authorized-for-blood-test="${d.AuthorizedForBloodTest}">
                            ${d.FirstName} ${d.LastName} [${d.Degree1},${d.Degree2}]
                        </option>`
                    ));
                    
                    TomSelectManager.init(doctorEl, { allowEmptyOption: true, minLength: 0 });
                    this.handleDoctorChange();
                },
                error: (_, textStatus, err) => PatientModule.showAlert(`Error loading doctors: ${textStatus} - ${err}`, "danger")
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
        
        // ═══════════════════════════════════════════════════════════════════════
        // FIXED: Category change uses setTestCategoryFilter() 
        // instead of destroying/rebuilding Tom Select
        // ═══════════════════════════════════════════════════════════════════════
        handleCategoryChange() {
            const $cat          = $("#category option:selected");
            const selCategoryId = $cat.val(); // Use val() not data attribute
            
            if (!selCategoryId || selCategoryId === '0') {
                // Reset filter — show all tests
                setTestCategoryFilter('');
                return;
            }

            // Apply category filter using the global function
            setTestCategoryFilter(selCategoryId);
            
            // Reset price fields
            $("#price, #discount").val("0");
            $("#testPriceInfo").empty();
        },
        
        updateClinicPrescription() {
            const $sel = $("#clinic option:selected");
            if ($sel.length) {
                $("#clinicPrescription").attr("src", `/${$sel.data("clinic")}_${$sel.val()}.jpg`);
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // SETUP CANCEL PATIENT MODAL
    // ═══════════════════════════════════════════════════════════════════════════════
    const SetupCancelPatientModal = {
        init() {
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
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // FORM HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════════
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
                if (!$("#attachDoctorToClinic input:checked").length) e.preventDefault();
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // TEST COMPLETION MANAGER
    // ═══════════════════════════════════════════════════════════════════════════════
    const TestCompletionManager = {
        init() {
            if (!document.getElementById("completeBtn")) return;
            
            $("#completeBtn").on("click", function () {
                const checkboxes = $("input[name='selectedTests[]']");
                
                if (!checkboxes.length) {
                    const btn = document.getElementById("completeBtn");
                    if (btn) {
                        btn.outerHTML = `<div class="alert alert-success d-inline-flex align-items-center mt-3 mb-3" role="alert">
                            <i class="bi bi-check2-circle me-2"></i>All tests completed.
                        </div>`;
                    }
                    return;
                }
                
                checkboxes.filter(":checked").length === 0
                    ? $("#warningModal").modal("show")
                    : $("#completeConfirmModal").modal("show");
            });
            
            $("#confirmComplete").on("click", () => $("#completeTestsForm").submit());
            $("#selectAll").on("change", function () { 
                $(".test-checkbox").prop("checked", this.checked); 
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // ARRIVED MODAL
    // ═══════════════════════════════════════════════════════════════════════════════
    const ArrivedModal = {
        init() { 
            this.bindEvents(); 
        },
        
        bindEvents() {
            $(document).on("click", ".btn-arrived", function () {
                const dues = parseFloat($(this).data("dues")) || 0;
                
                $("#arrivedPatientId").val($(this).data("patient-id"));
                $("#arrivedPatientName").text($(this).data("patient-name"));
                $("#arrivedApptDate").text($(this).data("advance-date"));
                $("#arrivedCash, #arrivedOnline").val(0);
                $("#arrivedOnlineSourceWrap").hide();
                $("#arrivedRemainingDues").text("₹" + dues.toFixed(2));
                
                dues > 0
                    ? ($("#arrivedNoDues").hide(), $("#arrivedDuesSection").show(), $("#arrivedDuesAmount").text("₹" + dues.toFixed(2)))
                    : ($("#arrivedDuesSection").hide(), $("#arrivedNoDues").show());
            });
            
            $("#arrivedOnline").on("input", function () {
                parseFloat($(this).val()) > 0
                    ? $("#arrivedOnlineSourceWrap").show()
                    : ($("#arrivedOnlineSourceWrap").hide(), $("#arrivedOnlineSource").val(""));
                ArrivedModal.updateRemaining();
            });
            
            $("#arrivedCash").on("input", () => ArrivedModal.updateRemaining());
            
            $("#arrivedCash, #arrivedOnline")
                .on("focus", function () { if ($(this).val() == 0) $(this).val(""); })
                .on("blur",  function () { if ($(this).val() === "") $(this).val(0); });
        },
        
        updateRemaining() {
            const dues = parseFloat($("#arrivedDuesAmount").text().replace("₹", "")) || 0;
            const rem  = Math.max(0, dues - (parseFloat($("#arrivedCash").val()) || 0) - (parseFloat($("#arrivedOnline").val()) || 0));
            
            $("#arrivedRemainingDues").text("₹" + rem.toFixed(2))
                .css("color", rem === 0 && dues > 0 ? "#0c9474" : "#e53e3e");
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // DATE SETUP (register patient page only)
    // ═══════════════════════════════════════════════════════════════════════════════
    if (document.getElementById("dateDisplay")) {
        const today    = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        
        const fmtDisplay = d => d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
        const fmtServer  = d => d.toLocaleDateString("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" }).replace(/\//g, "-");

        $("#dateDisplay").text(fmtDisplay(today));
        $("#registrationDate").val(fmtServer(today));
        $("#date").val(fmtServer(today));

        const advEl     = document.getElementById("advanceDatePicker");
        const advPicker = advEl ? flatpickr(advEl, {
            minDate: "today", 
            dateFormat: "d-m-Y", 
            disableMobile: true,
            onChange(selectedDates) {
                if (!selectedDates.length) return;
                $("#advanceBookingDate").val(fmtServer(selectedDates[0]));
            }
        }) : null;

        $("#advanceBookingToggle").on("change", function () {
            if (!advPicker) return;
            
            if (this.checked) {
                $("#advanceDateWrap").show();
                advPicker.setDate(tomorrow, false);
                $("#advanceBookingDate").val(fmtServer(tomorrow));
                $("#isAdvanceBooking").val("1");
            } else {
                $("#advanceDateWrap").hide();
                advPicker.clear();
                $("#advanceBookingDate").val("");
                $("#isAdvanceBooking").val("0");
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INITIALIZE ALL MODULES
    // ═══════════════════════════════════════════════════════════════════════════════
    PatientModule.init();
    ClinicDoctorManager.init();
    SetupCancelPatientModal.init();
    FormHandlers.init();
    TestCompletionManager.init();
    ArrivedModal.init();
});