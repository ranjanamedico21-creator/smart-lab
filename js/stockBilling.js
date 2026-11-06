// ═══════════════════════════════════════════════════════════════════
// stockBilling.js  —  Stock & supplier billing pages only
// Depends on: common.js
// Contains: ExportExcel, CustomerLedgerHandler, ChallanModal,
//           FinancialYearHandler, SupplierProductFilter,
//           ExpiredStockUI, ExpiryReturnManager, ExpiredSettlementUI
// ═══════════════════════════════════════════════════════════════════
"use strict";

$(document).ready(function () {

    // ── Export Excel ──────────────────────────────────────────────
    const ExportExcel = {
        init() {
            $(document).on("click", "[data-export-table]", function () {
                const tableId  = $(this).data("export-table");
                const fileName = $(this).data("export-name") || "export";
                const table    = document.getElementById(tableId);
                if (!table) { console.error("Table not found:", tableId); return; }
                XLSX.writeFile(XLSX.utils.table_to_book(table, { sheet: "Sheet1" }), fileName + ".xlsx");
            });
        }
    };

    // ── Customer Ledger Handler ───────────────────────────────────
    const CustomerLedgerHandler = {
        init() {
            if (!document.getElementById('customerLedgerTable')) return;
            this.updateTotals();
            $("#customerLedgerTable").on("change", ".include-total", () => this.updateTotals());
        },
        updateTotals() {
            let s = 0, p = 0, pe = 0;
            $("#customerLedgerTable tbody tr").each(function () {
                const $r = $(this);
                if ($r.find(".include-total").is(":checked")) {
                    s  += parseFloat($r.find("[data-sales]").data("sales"))       || 0;
                    p  += parseFloat($r.find("[data-payments]").data("payments")) || 0;
                    pe += parseFloat($r.find("[data-pending]").data("pending"))   || 0;
                }
            });
            $("#totalsRow .total-sales").text("₹ " + s.toFixed(2));
            $("#totalsRow .total-payments").text("₹ " + p.toFixed(2));
            $("#totalsRow .total-pending").text("₹ " + pe.toFixed(2));
        }
    };

    // ── Challan Modal ─────────────────────────────────────────────
    const ChallanModal = {
        init() {
            const $modal = $("#confirmModalChallan");
            if (!$modal.length) return;
            $(".action-btn").on("click", function () {
                const $btn      = $(this);
                const challanId = $btn.data("id");
                const customer  = $btn.data("customer");
                const action    = $btn.data("action");
                $("#hiddenChallanId").val(challanId);
                $("#hiddenCustomerId").val($btn.data("customer-id"));
                $("#hiddenActionType").val(action);
                const cfg = {
                    convert:  { title:"Confirm Conversion",   body:(id,c) => `Are you sure you want to <strong>convert Challan ${id}</strong> for <strong>${c}</strong>?`,       text:"Yes, Convert", cls:"btn btn-success", action:"/billing/convertToSale" },
                    delivery: { title:"Confirm Delivery",     body:(id,c) => `Are you sure you want to <strong>mark delivery Challan ${id}</strong> for <strong>${c}</strong>?`, text:"Yes, Deliver", cls:"btn btn-primary",  action:"/billing/deliver" },
                    cancel:   { title:"Confirm Cancellation", body:(id,c) => `Are you sure you want to <strong>cancel Challan ${id}</strong> for <strong>${c}</strong>?`,        text:"Yes, Cancel",  cls:"btn btn-danger",   action:"/billing/cancelChallan" }
                }[action];
                if (!cfg) return;
                $("#modalTitle").text(cfg.title);
                $("#modalBody").html(cfg.body(challanId, customer));
                $("#modalConfirmBtn").text(cfg.text).attr("class", cfg.cls);
                $("#actionForm").attr("action", cfg.action);
                $modal.modal("show");
            });
        }
    };

    // ── Financial Year Handler ────────────────────────────────────
    const FinancialYearHandler = {
        init() {
            const fyEl = document.getElementById('financialYear');
            if (!fyEl) return;

            // Guard against double-init
            if (fyEl.dataset.fyInitialised === "1") return;
            fyEl.dataset.fyInitialised = "1";

            // ── Dynamic FY Calculation (April → March) ──
            const now = new Date();
            const currentMonth = now.getMonth();      // 0-11
            const currentYear  = now.getFullYear();

            // If month >= April (3), FY starts this year, else last year
            const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;

            const financialYears = Array.from({ length: 6 }, (_, i) => {
                const start = fyStartYear - i;
                const end   = start + 1;
                return `${start}-${end}`;
            });

            // ── CRITICAL FIX: Always populate raw <select> options BEFORE touching TomSelect ──
            const preSelected = fyEl.getAttribute('data-selected') || '';
            
            // Build options HTML
            let optionsHtml = '<option value=""></option>';
            financialYears.forEach(y => {
                const selected = (y === preSelected) ? ' selected' : '';
                optionsHtml += `<option value="${y}"${selected}>${y}</option>`;
            });
            fyEl.innerHTML = optionsHtml;

            // ── Destroy any existing TomSelect instance so we can recreate it cleanly ──
            let ts = fyEl.tomselect;
            if (ts) {
                ts.destroy();
                // After destroy, re-inject options because destroy() reverts to original HTML
                fyEl.innerHTML = optionsHtml;
            }

            // ── Init TomSelect with dropdownParent:'body' so it floats above everything ──
            if (typeof TomSelect !== 'undefined') {
                ts = new TomSelect(fyEl, {
                    create: false,
                    allowEmptyOption: true,
                    plugins: ['dropdown_input'],
                    controlInput: null,
                    dropdownParent: 'body',          // ← FIX: append to body so nothing can clip it
                    // FIX: constrain dropdown width to match input and prevent horizontal scroll
                    onDropdownOpen: function() {
                        const controlRect = this.control.getBoundingClientRect();
                        const dropdown = this.dropdown;
                        if (dropdown) {
                            dropdown.style.maxWidth = controlRect.width + 'px';
                            dropdown.style.width = controlRect.width + 'px';
                            dropdown.style.minWidth = controlRect.width + 'px';
                        }
                    },
                    render: {
                        option: function(data, escape) {
                            return `<div class="py-2 px-3 fw-medium text-truncate" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;">${escape(data.text)}</div>`;
                        },
                        item: function(data, escape) {
                            return `<div class="fw-medium text-truncate" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;">${escape(data.text)}</div>`;
                        }
                    }
                });
            }

            // ── Helper: set Flatpickr dates from FY string ──
            const setFYDates = (fyValue) => {
                if (!fyValue) return;
                const [startYear, endYear] = fyValue.split("-");
                const fp = document.querySelector("#FromDate")?._flatpickr;
                const tp = document.querySelector("#ToDate")?._flatpickr;

                const fromDate = new Date(parseInt(startYear), 3, 1);   // 1-Apr
                const toDate   = new Date(parseInt(endYear), 2, 31);    // 31-Mar

                // FIX: setTimeout ensures flatpickr UI reliably updates
                if (fp) {
                    setTimeout(() => fp.setDate(fromDate, true), 0);
                }
                if (tp) {
                    setTimeout(() => tp.setDate(toDate, true), 0);
                }
            };

            // ── Infer FY from dates if server didn't send financialYear ──
            const inferFYFromDates = () => {
                const fromVal = document.querySelector("#FromDate")?.value;
                const toVal   = document.querySelector("#ToDate")?.value;
                if (!fromVal || !toVal) return null;

                const [fd, fm, fy] = fromVal.split('-').map(Number);
                const [td, tm, ty] = toVal.split('-').map(Number);

                // Standard FY: 1-Apr to 31-Mar
                if (fd === 1 && fm === 4 && td === 31 && tm === 3) {
                    const fyStr = `${fy}-${ty}`;
                    if (financialYears.includes(fyStr)) return fyStr;
                }
                return null;
            };

            // ── Determine initial value ──
            const hasPrepopulatedDates = document.querySelector("#FromDate")?.value &&
                                         document.querySelector("#ToDate")?.value;

            const inferredFY = inferFYFromDates();
            const initialFY  = (preSelected && financialYears.includes(preSelected))
                                ? preSelected
                                : (inferredFY || (hasPrepopulatedDates ? '' : financialYears[0]));

            if (initialFY) {
                if (ts) {
                    ts.setValue(initialFY, true);
                } else {
                    fyEl.value = initialFY;
                }
                // Only auto-fill dates on fresh load (no dates from server)
                if (!hasPrepopulatedDates) {
                    setFYDates(initialFY);
                }
            } else if (ts) {
                ts.clear(true);
            }

            // ── Change handler ──
            if (ts) {
                ts.on('change', (value) => setFYDates(value));
            } else {
                $("#financialYear").on("change", function () {
                    setFYDates($(this).val());
                });
            }

            // ── Quick Filters ──
            // FIX: Use a flag to prevent double-clicks and handle active state properly
            let isProcessing = false;
            
            $(".quick-filter").on("click", function () {
                // Prevent double-fire if already processing
                if (isProcessing) return;
                
                const $btn = $(this);
                const filter = $btn.data("filter");
                
                // Don't re-process if already active (unless it's last3Months which can be re-applied)
                if ($btn.hasClass("active") && filter !== "last3Months") return;
                
                isProcessing = true;
                
                const fp = document.querySelector("#FromDate")?._flatpickr;
                const tp = document.querySelector("#ToDate")?._flatpickr;

                // Visual active state - remove from all, add to clicked
                $(".quick-filter").removeClass("active");
                $btn.addClass("active");

                if (filter === "currentFY") {
                    const fy = financialYears[0];
                    if (ts) ts.setValue(fy, true);
                    else    $("#financialYear").val(fy).trigger('change');
                    setFYDates(fy);
                    // Release lock after dates settle
                    setTimeout(() => { isProcessing = false; }, 100);
                }
                else if (filter === "lastFY") {
                    const fy = financialYears[1];
                    if (ts) ts.setValue(fy, true);
                    else    $("#financialYear").val(fy).trigger('change');
                    setFYDates(fy);
                    setTimeout(() => { isProcessing = false; }, 100);
                }
                else if (filter === "last3Months") {
                    const to   = new Date();
                    const from = new Date();
                    from.setMonth(from.getMonth() - 3);

                    // Clear FY dropdown (custom range ≠ FY)
                    if (ts) ts.clear(true);
                    else    $("#financialYear").val('').trigger('change');

                    // FIX: Set dates and release lock after flatpickr settles
                    let pending = 0;
                    const done = () => {
                        pending--;
                        if (pending <= 0) {
                            isProcessing = false;
                        }
                    };
                    
                    if (fp) {
                        pending++;
                        setTimeout(() => { fp.setDate(from, true); done(); }, 0);
                    }
                    if (tp) {
                        pending++;
                        setTimeout(() => { tp.setDate(to, true); done(); }, 0);
                    }
                    
                    // Safety release if no datepickers
                    if (pending === 0) {
                        isProcessing = false;
                    }
                } else {
                    isProcessing = false;
                }
            });
        }
    };

    // ── Supplier Product Filter ───────────────────────────────────
    const SupplierProductFilter = {
        init() {
            const $supplierSelect = $("#supplier");
            const $productSelect  = $("#product");
            if (!$productSelect.length) return;

            if (!$productSelect.data("original-options"))
                $productSelect.data("original-options", $productSelect.find('option').clone());

            $supplierSelect.on("change", function () {
                const supplierId = $(this).val();
                const productEl  = document.getElementById('product');
                if (productEl?.tomselect) productEl.tomselect.destroy();
                $productSelect.empty().append('<option value="">Select product</option>');
                const $allOpts = $productSelect.data("original-options");
                if (supplierId) {
                    $allOpts.each(function () {
                        const $o = $(this);
                        if ($o.attr("data-supplier-id") === supplierId || $o.val() === "")
                            $productSelect.append($o.clone());
                    });
                } else {
                    $productSelect.append($allOpts.clone());
                }
                TomSelectManager.init(productEl, { allowEmptyOption: true, minLength: 0 });
            });

            if ($supplierSelect.val()) $supplierSelect.trigger("change");
        }
    };

    // ── Expired Stock UI ──────────────────────────────────────────
    const ExpiredStockUI = {
        modal: null,
        init() {
            const modalEl = document.getElementById("actionModal");
            if (!modalEl || typeof bootstrap === "undefined") return;
            this.modal = new bootstrap.Modal(modalEl, { backdrop: "static", keyboard: false });
            this.bindEvents();
        },
        bindEvents() {
            $("#selectAll").on("change", e => { $(".row-check").prop("checked", e.target.checked).trigger("change"); });
            $(document).on("change", ".row-check", () => {
                const count = $(".row-check:checked").length;
                $("#moveSelectedBtn").prop("disabled", count === 0).text(count > 0 ? `Move Selected (${count})` : "Move Selected");
            });
            $("#moveSelectedBtn").on("click", e => { e.preventDefault(); this.confirmMove(); });
            $("#actionModalConfirmBtn").on("click", () => this.submitForm());
        },
        confirmMove() {
            const count = $(".row-check:checked").length;
            if (!count) return;
            $("#actionModalTitle").text("Confirm Action");
            $("#actionModalBody").html(`<p class="mb-0">Are you sure you want to move <strong>${count}</strong> item(s) to expired stock?</p>`);
            $("#actionModalConfirmBtn").removeClass("btn-success").addClass("btn-danger").prop("disabled", false).text("Yes, Move");
            this.modal.show();
        },
        submitForm() {
            $("#actionModalConfirmBtn").prop("disabled", true).text("Processing...");
            document.getElementById("expiredStockForm").submit();
        }
    };

    // ── Expiry Return Manager ─────────────────────────────────────
    const ExpiryReturnManager = {
        init() { this.bindEvents(); },
        bindEvents() {
            $(".selectRow").on("change",        this.handleRowSelection.bind(this));
            $("#selectAllExpired").on("change", this.handleSelectAll.bind(this));
            $(".sendQty").on("input",           this.calculateRow.bind(this));
            $("#expiryReturnForm").on("submit", this.validateForm.bind(this));
            $("#expiryReturnForm").on("submit", this.validateSubmission.bind(this));
        },
        calculateRow(e) {
            const row     = $(e.target).closest("tr");
            const qty     = parseFloat(row.find(".sendQty").val()) || 0;
            const rate    = parseFloat(row.find(".rate").text())   || 0;
            const gst     = parseFloat(row.find(".gst").text())    || 0;
            const taxable = qty * rate, gstAmt = taxable * gst / 100, total = taxable + gstAmt;
            row.find(".taxable").text(taxable.toFixed(2));
            row.find(".gstAmount").text(gstAmt.toFixed(2));
            row.find(".total").text(total.toFixed(2));
            this.calculateTotals();
        },
        calculateTotals() {
            let t = 0, g = 0, gr = 0;
            $(".taxable").each(function ()   { t  += parseFloat($(this).text()) || 0; });
            $(".gstAmount").each(function () { g  += parseFloat($(this).text()) || 0; });
            $(".total").each(function ()     { gr += parseFloat($(this).text()) || 0; });
            $("#totalTaxable").text(t.toFixed(2));
            $("#totalGST").text(g.toFixed(2));
            $("#grandTotal").text(gr.toFixed(2));
        },
        validateForm(e) {
            let hasError = false;
            $(".selectRow:checked").each(function () {
                const qtyInput = $(this).closest("tr").find(".sendQty");
                const value    = qtyInput.val();
                const max      = parseInt(qtyInput.attr("max"), 10) || 0;
                if (!value || parseInt(value, 10) <= 0) {
                    hasError = true; qtyInput.addClass("is-invalid");
                    if (!qtyInput.next(".invalid-feedback").length) qtyInput.after(`<div class="invalid-feedback">Please enter a valid quantity</div>`);
                } else if (parseInt(value, 10) > max) {
                    hasError = true; qtyInput.addClass("is-invalid");
                    if (!qtyInput.next(".invalid-feedback").length) qtyInput.after(`<div class="invalid-feedback">Quantity exceeds remaining stock</div>`);
                } else { qtyInput.removeClass("is-invalid"); qtyInput.next(".invalid-feedback").remove(); }
            });
            if (hasError) e.preventDefault();
        },
        handleRowSelection(e) {
            const qi = $(e.target).closest("tr").find(".sendQty");
            $(e.target).is(":checked")
                ? qi.prop("disabled", false).focus()
                : qi.prop("disabled", true).val("").removeClass("is-invalid").next(".invalid-feedback").remove();
        },
        handleSelectAll(e) {
            const checked = $(e.target).is(":checked");
            $(".selectRow").each(function () { $(this).prop("checked", checked).trigger("change"); });
        },
        validateSubmission(e) {
            let valid = true;
            $(".selectRow:checked").each(function () {
                const qi      = $(this).closest("tr").find(".sendQty");
                const max     = parseFloat(qi.attr("max"));
                const entered = parseFloat(qi.val());
                if (!entered || entered <= 0 || entered > max) { valid = false; return false; }
            });
            if (!valid) e.preventDefault();
        }
    };

    // ── Expired Settlement UI ─────────────────────────────────────
    class ExpiredSettlementUI {
        constructor() {
            this.state = { modal:null, expiredId:null, supplierId:null, remainingAmount:0, totalRecoverable:0, selectedInvoiceId:null, creditBalance:0 };
            this.searchTimeout = null;
        }
        init() {
            const modalEl = document.getElementById("settlementModal");
            if (!modalEl || typeof bootstrap === "undefined") return;
            this.state.modal = new bootstrap.Modal(modalEl, { backdrop:"static", keyboard:false });
            this.bindEvents();
        }
        bindEvents() {
            $(document).on("click", ".open-settle-modal", e => this.openModal(e));
            $("#invoiceSearch").on("keyup", e => { clearTimeout(this.searchTimeout); this.searchTimeout = setTimeout(() => this.searchInvoice(e), 400); });
            $(document).on("click",  ".select-invoice", e => this.selectInvoice(e));
            $(document).on("change", ".price-history",  e => { const row = $(e.currentTarget).closest(".product-row"); row.find(".old-price").val($(e.currentTarget).val()); this.calculateRow(row); });
            $(document).on("keyup",  ".old-price",      e => this.calculateRow($(e.currentTarget).closest(".product-row")));
            $("#confirmSettlement").on("click", () => this.submitSettlement());
        }
        openModal(e) {
            const btn = $(e.currentTarget);
            Object.assign(this.state, { expiredId:btn.data("id"), supplierId:btn.data("supplierid"), remainingAmount:parseFloat(btn.data("remaining")), totalRecoverable:0, creditBalance:0, selectedInvoiceId:null });
            $("#modalProduct").text(btn.data("product")); $("#modalSupplier").text(btn.data("supplier"));
            $("#modalRemaining").text(`₹ ${this.state.remainingAmount.toFixed(2)}`);
            this.resetModal(); this.state.modal.show();
        }
        resetModal() { $("#invoiceSearch").val(""); $("#invoiceList,#invoiceProducts").empty(); $("#creditSection").remove(); $("#totalRecoverable").text("0.00"); $("#confirmSettlement").prop("disabled", true); }
        searchInvoice(e) {
            const kw = $(e.currentTarget).val();
            if (!kw || kw.length < 2) { $("#invoiceList").empty(); return; }
            $.get("/billing/searchSupplierInvoice", { keyword:kw, supplierId:this.state.supplierId }, data => {
                const list = $("#invoiceList").empty();
                if (!data.length) { list.html(`<div class="text-muted small p-2">No invoice found</div>`); return; }
                data.forEach(inv => list.append(`<a href="#" class="list-group-item list-group-item-action select-invoice" data-id="${inv.Id}"><div class="fw-semibold">${inv.SupplierInvoiceNo}</div></a>`));
            });
        }
        selectInvoice(e) {
            e.preventDefault();
            const invoiceId = $(e.currentTarget).data("id"); this.state.selectedInvoiceId = invoiceId;
            $("#invoiceProducts").html(`<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`);
            $.get("/billing/checkInvoiceCredit", { invoiceId }, creditData => {
                this.renderCreditSection(creditData);
                $.get("/billing/getInvoiceProducts", { invoiceId }, products => this.renderProducts(products));
            });
        }
        loadPriceHistory(products) {
            if (!products?.length) return;
            $.get("/billing/getLastThreePricesBulk", { productIds:products.map(p => p.ProductId).join(","), supplierId:this.state.supplierId }, data => {
                Object.keys(data).forEach(pid => {
                    const dd = $(`.product-row[data-product-id="${pid}"]`).find(".price-history");
                    if (dd.length) data[pid].forEach(p => dd.append(`<option value="${p.PurchasePrice}">₹ ${p.PurchasePrice} (${p.InvoiceDate})</option>`));
                });
            });
        }
        renderCreditSection(creditData) {
            $("#creditSection").remove(); this.state.creditBalance = 0;
            if (!creditData?.length) return;
            let html = `<div id="creditSection" class="alert alert-info"><h6 class="fw-bold mb-2">Available Credit</h6>`;
            creditData.forEach(c => { const a = parseFloat(c.AvailableAmount); this.state.creditBalance += a; html += `<div class="d-flex justify-content-between"><span>${c.ProductName}</span><span>₹ ${a.toFixed(2)}</span></div>`; });
            html += `<hr><div class="d-flex justify-content-between fw-bold"><span>Total Credit</span><span>₹ ${this.state.creditBalance.toFixed(2)}</span></div></div>`;
            $("#invoiceProducts").before(html);
        }
        renderProducts(products) {
            if (!products.length) { $("#invoiceProducts").html(`<div class="text-muted small">No products found.</div>`); return; }
            let html = `<div class="row g-3">`;
            products.forEach(p => { html += `<div class="col-12"><div class="card shadow-sm product-row" data-product-id="${p.ProductId}" data-invoice-id="${p.InvoiceId}" data-invoice-detail-id="${p.InvoiceDetailId}" data-price="${p.PurchasePrice}" data-qty="${p.Quantity}"><div class="card-body"><div class="d-flex justify-content-between mb-2"><div><h6 class="mb-1">${p.ProductName}</h6><small class="text-muted">Qty: ${p.Quantity} | Current: ₹ ${p.PurchasePrice}</small></div><div class="text-success fw-bold fs-5">₹ <span class="recoverable-amount">0.00</span></div></div><select class="form-select form-select-sm mb-2 price-history"><option value="">Select from price history</option></select><input type="number" class="form-control form-control-sm old-price" placeholder="Enter old price"></div></div></div>`; });
            html += `</div><div class="border-top mt-4 pt-3 d-flex justify-content-between"><h6>Total Recoverable</h6><h5>₹ <span id="totalRecoverable">0.00</span></h5></div>`;
            $("#invoiceProducts").html(html); this.loadPriceHistory(products);
        }
        calculateRow(card) {
            const cp = parseFloat(card.data("price")), qty = parseFloat(card.data("qty")), op = parseFloat(card.find(".old-price").val()) || 0;
            card.find(".recoverable-amount").text((op > cp ? Math.abs(cp - op) * qty : 0).toFixed(2));
            this.calculateTotal();
        }
        calculateTotal() {
            let total = 0; $(".recoverable-amount").each(function () { total += parseFloat($(this).text()) || 0; });
            this.state.totalRecoverable = total;
            const adj = Math.max(0, total - this.state.creditBalance);
            $("#totalRecoverable").text(adj.toFixed(2));
            adj > this.state.remainingAmount ? $("#totalRecoverable").addClass("text-danger").removeClass("text-primary") : $("#totalRecoverable").addClass("text-primary").removeClass("text-danger");
            $("#confirmSettlement").prop("disabled", adj <= 0);
        }
        submitSettlement() {
            if (this.state.totalRecoverable <= 0) { Swal.fire("Invalid", "Recoverable amount must be greater than zero.", "warning"); return; }
            const settlements = [];
            $(".product-row").each(function () {
                const card = $(this), rec = parseFloat(card.find(".recoverable-amount").text());
                if (rec > 0) settlements.push({ invoiceId:card.data("invoice-id"), invoiceDetailId:card.data("invoice-detail-id"), productId:card.data("product-id"), qty:card.data("qty"), oldPrice:parseFloat(card.find(".old-price").val()), settlementAmount:rec, newPrice:parseFloat(card.data("price")) });
            });
            const btn = $("#confirmSettlement").prop("disabled", true).html(`<span class="spinner-border spinner-border-sm me-2"></span>Processing`);
            $.ajax({
                url:"/billing/expiredStockSettle", type:"POST", contentType:"application/json",
                data:JSON.stringify({ expiredId:this.state.expiredId, invoiceId:this.state.selectedInvoiceId, settlementType:$("#settlementType").val(), settlements }),
                success: () => Swal.fire("Success","Settlement completed.","success").then(() => location.reload()),
                error:   () => { Swal.fire("Error","Settlement failed.","error"); btn.prop("disabled",false).text("Confirm Settlement"); }
            });
        }
    }

    // ── Init ──────────────────────────────────────────────────────
    // Flatpickr (NO altInput — prevents the "missing from-date" ghost bug)
    $(".datepicker").flatpickr({
        dateFormat: "d-m-Y",
        allowInput: true
    });

    ExportExcel.init();
    CustomerLedgerHandler.init();
    ChallanModal.init();
    FinancialYearHandler.init();   // ← called ONCE now (was double-called before)
    SupplierProductFilter.init();
    ExpiredStockUI.init();
    ExpiryReturnManager.init();
    new ExpiredSettlementUI().init();
});