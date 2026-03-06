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
        $(".tableSearch").on("keyup", function() {
            var value = $(this).val().toLowerCase();
            $(".tableBody tr").filter(function() {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });
    }
};
// Main Application Logic
$(document).ready(function () {
    // Initialize Modules
    FormValidation.init();
    TableSearch.init();
    
    // Constants and Configuration
    const CONFIG = {
        dateFormat: "dd-mm-yy",
        selectPickerOptions: { dropupAuto: false, container: "body" }
    };

    // Sidebar Management
    const Sidebar = {
        init() {
            this.restoreState();
            this.bindEvents();
        },
        restoreState() {
            const activeSection = localStorage.getItem("sidebar-active-section");
            const activeLink = localStorage.getItem("sidebar-active-link");
            if (activeSection) $(activeSection).addClass("show");
            if (activeLink) {
                $(".sidebar-link").removeClass("active");
                $(activeLink).addClass("active");
            }
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

    // UI Components Initialization
    const UIComponents = {
        init() {
            this.tooltips();
            this.selectPickers();
            this.datePickers();
            this.pagination();
            this.supplierProductFilter();
            this.setupCancelPatientModal();
            this.setupDeleteDocumentModal(); // Added new method
            this.setupImageZoom(); // Added new method
            this.openAssignRoleModel();//Added new modal for assigning the role to user 
        },
        tooltips() {
            const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));
        },
        selectPickers() {
            $("select").selectpicker(CONFIG.selectPickerOptions);
        },
        datePickers() {
            $("#FromDate, #ToDate, .expiryDate, #joiningDate, .mfgDate, #ChallanDate, #purchasePoDate, #invoicePoDate").datepicker({
                defaultDate: "0",
                changeMonth: true,
                numberOfMonths: 2,
                dateFormat: CONFIG.dateFormat
            });
            $("#FromDate").on("change", function () {
                $("#ToDate").datepicker("option", this.value);
            });
            $("#ToDate").on("change", function () {
                $("#FromDate").datepicker("option", this.value);
            });
        },
        pagination() {
            $(".pagination-loop").pageMe({
                pagerSelector: "#pagination_Number",
                showPrevNext: true,
                hidePageNumbers: false,
                perPage: 15
            });
        },
        supplierProductFilter() {
            const $supplierSelect = $("#supplier");
            const $productSelect = $("#product");

            if (!$productSelect.data("original-options")) {
                $productSelect.data("original-options", $productSelect.html());
            }

            $supplierSelect.on("change", function() {
                const supplierId = $(this).val();
                const originalOptions = $productSelect.data("original-options");

                $productSelect.html(originalOptions);
                $productSelect.selectpicker("destroy");

                if (supplierId) {
                    $productSelect.find("option").each(function() {
                        const $option = $(this);
                        if ($option.attr("data-supplier-id") !== supplierId && $option.val() !== "") {
                            $option.remove();
                        }
                    });
                }

                $productSelect.selectpicker(CONFIG.selectPickerOptions);
            });

            if ($supplierSelect.val()) {
                $supplierSelect.trigger("change");
            }
        },
        setupCancelPatientModal() {
            $("a[data-bs-target='#cancelPatient']").on("click", function () {
                let patientId = $(this).data("bs-patient-id");
                let patientName = $(this).data("bs-patient-name");
                $("#cancelPatientLabel").text(`Cancel Patient - ${patientName}`);
                $(".modal-cancel-patient-id").val(patientId);

                let searchedBillNo = $("#billNo").val();
                let searchedName = $("#name").val();
                let searchedFromDate = $("#FromDate").val();
                let searchedToDate = $("#ToDate").val();
                let searchedDoctor = $("#doctor").val();
                let searchedStatus = $("#status").val();

                $("#searchedBillNo").val(searchedBillNo);
                $("#searchedName").val(searchedName);
                $("#searchedFromDate").val(searchedFromDate);
                $("#searchedToDate").val(searchedToDate);
                $("#searchedDoctor").val(searchedDoctor);
                $("#searchedStatus").val(searchedStatus);
            });
        },
        openAssignRoleModel(){
            $("a[data-bs-target='#assignRole']").on("click", function () {
                let userName = $(this).data("bs-name");
                let userId=$(this).data("bs-user-id")
                $("#assignRoleLabel").text(`Assign A Role To  - ${userName}`);
                $("#userId").val(userId)

                
            });
        },
        setupDeleteDocumentModal() {
            document.querySelectorAll('.delete-document').forEach(button => {
                button.addEventListener('click', function() {
                    let docId = this.getAttribute('data-document-id');
                    document.getElementById('modalDocumentId').value = docId;
                });
            });
        },
        setupImageZoom() {
            $(".zoom").click(function () {
                let imgSrc = $(this).attr("src");
                $("#modalImage").attr("src", imgSrc);
            });
        }
    };

    // Test Management
    const TestManager = {
        tests: [],
        subTests: [],
        init() {
            this.bindEvents();
            this.loadExistingTests();
        },
        bindEvents() {
            $("#addTest").on("click", this.addTest.bind(this));
            $(document).on("click", ".removeTest", this.removeTest.bind(this));
            $("#test").on("change", this.updateTestFields.bind(this));
        },
        addTest() {
            const price = parseFloat($("#price").val()) || 0;
            const discount = parseInt($("#discount").val(), 10) || 0;
            const $selectedTest = $("#test").find(":selected");
            console.log($selectedTest.attr("id"))
           // const testId = parseInt($selectedTest.attr("id"), 10);
           const testId = parseInt($selectedTest.val(), 10)
            console.log(testId)
            const testName = $selectedTest.text();
            console.log(this.tests)

            if (price <= 0) return $("#price").addClass("is-invalid");
            if (this.tests.some(t => t.TestId === testId)) return this.showAlert("Test already added", "danger");
            if (discount < 0 || discount > price) return this.showAlert(
                discount < 0 ? "Discount cannot be negative" : "Discount exceeds price",
                "danger"
            );

            $("#price").removeClass("is-invalid");
            this.addTestRow({ testId, testName, price, discount });
            this.handleSubTests(testId);
            this.updateStorage();
        },
        removeTest(e) {
            const $btn = $(e.currentTarget);
            const testId = parseInt($btn.data("attr-id"), 10);
            const isSubTest = $btn.data("attr-issubtest") === true;
            const $row = $btn.closest("tr");
            const price = parseFloat($row.find("td:eq(1)").text());
            const discount = parseInt($row.find("td:eq(2)").text(), 10);

            $row.remove();
            this.updateTotals(-price, -discount);
            isSubTest ? this.removeSubTest(testId) : this.removeMainTest(testId);
            this.updateStorage();
        },
        addTestRow({ testId, testName, price, discount }) {
            $("#displayTest tbody").append(`
                <tr>
                    <td class="text-capitalize">${testName}</td>
                    <td>${price}</td>
                    <td>${discount}</td>
                    <td><button class="btn removeTest" data-attr-id="${testId}" data-attr-issubtest="false">Remove</button></td>
                </tr>
            `);
            this.tests.push({ TestId: testId, TestName: testName, Price: price, Discount: discount });
            this.updateTotals(price, discount);
        },
        handleSubTests(testId) {
            $(`.mainTest${testId}`).each((_, el) => {
                const $el = $(el);
                const subTest = {
                    TestId: testId,
                    SubTestId: parseInt($el.data("sub-test-id"), 10),
                    SubTestName: $el.data("sub-test-name"),
                    Price: parseFloat($el.data("sub-test-price")),
                    Discount: parseInt($el.data("sub-test-discount"), 10)
                };
                $("#displayTest tbody").append(`
                    <tr>
                        <td class="text-capitalize">${subTest.SubTestName}</td>
                        <td>${subTest.Price}</td>
                        <td>${subTest.Discount}</td>
                        <td><button class="btn removeTest" data-attr-id="${subTest.SubTestId}" data-attr-issubtest="true">Remove</button></td>
                    </tr>
                `);
                this.subTests.push(subTest);
                this.updateTotals(subTest.Price, subTest.Discount);
            });
        },
        updateTotals(price, discount) {
            const $finalDiscount = $("#finalDiscount");
            const $grossAmount = $("#grossAmount");
            $finalDiscount.val((parseInt($finalDiscount.val(), 10) || 0) + discount);
            $grossAmount.val((parseInt($grossAmount.val(), 10) || 0) + price - discount);
        },
        updateStorage() {
            $("#selectedTestDetails").val(JSON.stringify(this.tests));
            $("#selectedSubTestDetails").val(JSON.stringify(this.subTests));
            $("#testLength").val(this.tests.length ? 1 : 0);
            $("#subTestLength").val(this.subTests.length ? 1 : 0);
        },
        loadExistingTests() {
            ["patientTestDetails", "patientSubTestDetails"].forEach((id, isSubTest) => {
                const data = $(`#${id}`).val();
                if (data) {
                    const items = JSON.parse(data);
                    items.forEach(item => {
                        const test = {
                            TestId: item.TestId,
                            TestName: item.TestName,
                            Price: item.Price,
                            Discount: item.Discount,
                            ...(isSubTest && { SubTestId: item.SubTestId })
                        };
                        (isSubTest ? this.subTests : this.tests).push(test);
                        $("#displayTest tbody").append(`
                            <tr>
                                <td class="text-capitalize">${test.TestName}</td>
                                <td>${test.Price}</td>
                                <td>${test.Discount}</td>
                                <td><button class="btn removeTest" data-attr-id="${isSubTest ? test.SubTestId : test.TestId}" data-attr-issubtest="${isSubTest}">Remove</button></td>
                            </tr>
                        `);
                    });
                    this.updateStorage();
                }
            });
        },
        removeMainTest(testId) {
            this.tests = this.tests.filter(t => t.TestId !== testId);
        },
        removeSubTest(subTestId) {
            this.subTests = this.subTests.filter(t => t.SubTestId !== subTestId);
        },
        updateTestFields() {
            $("#discount").val("0");
            $("#price").val($("#test").find(":selected").data("price") || 0);
        },
        showAlert(message, type) {
            $("#liveErrorAlertPlaceholder").append(`
                <div class="alert alert-${type} alert-dismissible" role="alert">
                    <div>${message}</div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `);
        }
    };

   
    // Clinic and Doctor Management
    const ClinicDoctorManager = {
        init() {
            this.bindEvents();
            this.updateClinicPrescription();
        },
        bindEvents() {
            $("#clinic").on("change", this.handleClinicChange.bind(this));
            $("#doctor").on("change", this.handleDoctorChange.bind(this));
            $("#selectDoctorThanksCategory").on("change", this.handleThanksCategoryChange.bind(this));
            $("#category").on("change", this.handleCategoryChange.bind(this));
        },
        handleClinicChange() {
            const $selected = $("#clinic option:selected");
            const clinicId = $selected.val();
            $("#clinicPrescription").attr("src", `/${$selected.data("clinic")}_${clinicId}.jpg`);
            $("#address").text($selected.data("address"));

            $.ajax({
                type: "POST",
                url: "/patient/getListOfAttachedDoctorToClinic",
                data: { clinicId },
                success: doctors => {
                    const $doctorSelect = $("#doctor");
                    $doctorSelect.selectpicker("destroy");
                    $doctorSelect.empty();
                    $doctorSelect.append('<option value="0">Select a doctor</option>');
                    
                    doctors.forEach(d => {
                        $doctorSelect.append(
                            `<option value="${d.Id}" 
                                data-flat-discount="${d.FlatDiscount}" 
                                data-authorized-for-blood-test="${d.AuthorizedForBloodTest}">
                                ${d.FirstName} ${d.LastName} [${d.Degree1},${d.Degree2}]
                            </option>`
                        );
                    });
                    
                    $doctorSelect.selectpicker(CONFIG.selectPickerOptions);
                    this.handleDoctorChange();
                },
                error: (jqXHR, textStatus, errorThrown) => TestManager.showAlert(`Error: ${textStatus} - ${errorThrown}`, "danger")
            });
        },
        handleDoctorChange() {
            $(".alert").alert("close");
            const $selected = $("#doctor option:selected");
            const authBloodTest = $selected.data("authorized-for-blood-test");
            const flatDiscount = $selected.data("flat-discount");
            
            if (authBloodTest == 1) {
                TestManager.showAlert("Pathology test is applicable.", "success");
            } else if (authBloodTest == 0) {
                TestManager.showAlert("Pathology test is not applicable.", "danger");
            }
            
            if (flatDiscount > 0) {
                TestManager.showAlert(`Flat Discount of ${flatDiscount}% is applicable.`, "success");
            }
        },
        handleThanksCategoryChange() {
            const $selected = $("#selectDoctorThanksCategory option:selected");
            $("#doctorCategoryThanks").val($selected.val());
            $("#doctorThanksCategory").val($selected.data("thanks-category-id"));
        },
        handleCategoryChange() {
            const $category = $("#category option:selected");
            const selectedCategoryId = parseInt($category.data("category-id"), 10);
            const $testSelect = $("#test");
            
            if (!selectedCategoryId) {
                TestManager.showAlert("Please select a valid category", "warning");
                return;
            }

            if (!$testSelect.data("original-options")) {
                $testSelect.data("original-options", $testSelect.children().clone());
            }
            
            $testSelect.selectpicker("destroy");
            const $allOptions = $testSelect.data("original-options").clone();
            $testSelect.empty();
            
            let hasOptions = false;
            $allOptions.each(function() {
                const $option = $(this);
                const categoryId = parseInt($option.data("category-id"), 10);
                if (!categoryId || categoryId === selectedCategoryId) {
                    $testSelect.append($option.clone());
                    hasOptions = true;
                }
            });
            
            $testSelect.prop("disabled", false);
            $("#price, #discount").val("0");
            $testSelect.selectpicker(CONFIG.selectPickerOptions);
            
            if (!hasOptions) {
                TestManager.showAlert("No tests available for this category", "info");
            }
        },
        updateClinicPrescription() {
            const $selected = $("#clinic option:selected");
            $("#clinicPrescription").attr("src", `/${$selected.data("clinic")}_${$selected.val()}.jpg`);
        }
    };
    // Test Completion Manager on patient details
const TestCompletionManager = {
    init() {
        this.bindEvents();
    },
    bindEvents() {
        // ✅ Complete Button Logic
        $("#completeBtn").on("click", function () {
            
            const checkboxes = $("input[name='selectedTests[]']");
            if (checkboxes.length === 0) {
                console.log('do nothing')
                const completeBtn = document.getElementById('completeBtn');
    if (completeBtn) {
        completeBtn.outerHTML = `
          <div class="alert alert-success d-inline-flex align-items-center mt-3 mb-3" role="alert">
            <i class="bi bi-check2-circle me-2"></i>
            All tests completed.
          </div>
        `;
    }
                return;
            }
            const checked = checkboxes.filter(":checked");
            if (checked.length === 0) {
                // No checkbox selected → show warning modal
                $("#warningModal").modal("show");
            } else {
                // Some checkboxes selected → show confirm modal
                $("#completeConfirmModal").modal("show");
            }
        });

        // ✅ Confirm button → submit form
        $("#confirmComplete").on("click", function () {
            $("#completeTestsForm").submit();
        });

        // ✅ Select All Checkbox
        $("#selectAll").on("change", function () {
            $(".test-checkbox").prop("checked", this.checked);
        });

        
    }
};


    // Form Handlers
    const FormHandlers = {
        init() {
            function handleCategoryChange() {
                const selectedCategory = $("#mainCategory").find(":selected").text()?.trim().toLowerCase();
                const isPathology = selectedCategory === "pathology";

                console.log("Selected Category:", selectedCategory, "Is Pathology:", isPathology);

                $(".pathology").toggleClass("d-none", !isPathology).find("input").prop("required", isPathology);

                $("#noOfFilms, #filmRequired")
                    .prop("required", !isPathology)
                    .closest(".col-md-6, .col-12")
                    .toggle(!isPathology);

                $(".fr-box").closest(".col-md-6, .col-12").toggle(!isPathology).find("input, select, textarea").prop("required", !isPathology);
            }

            $("#mainCategory").on("change", handleCategoryChange);
            setTimeout(handleCategoryChange, 400);

            $("#attachDoctorToClinic").on("submit", e => {
                if (!$("#attachDoctorToClinic input:checked").length) {
                    TestManager.showAlert("No doctor selected.", "danger");
                    e.preventDefault();
                }
            });
        }
    };

    // Financial Year Handler
    const FinancialYearHandler = {
        init() {
            const currentYear = new Date().getFullYear();
            const financialYears = Array.from({ length: 6 }, (_, i) => `${currentYear - i - 1}-${currentYear - i}`);
            $("#financialYear").append(financialYears.map(year => `<option value="${year}">${year}</option>`)).selectpicker("refresh");

            $("#financialYear").on("change", function () {
                const [startYear, endYear] = $(this).val().split("-");
                $("#FromDate").val(`01-04-${startYear}`).datepicker("refresh");
                $("#ToDate").val(`31-03-${endYear}`).datepicker("refresh");
            });

            $(".quick-filter").on("click", function () {
                const filter = $(this).data("filter");
                if (filter === "currentFY") $("#financialYear").val(financialYears[0]).change();
                else if (filter === "lastFY") $("#financialYear").val(financialYears[1]).change();
                else if (filter === "last3Months") {
                    const today = new Date();
                    const last3Months = new Date(today.setMonth(today.getMonth() - 3));
                    $("#FromDate").val(last3Months.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-"));
                    $("#ToDate").val(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-"));
                }
            });
        }
    };
    // Challan Modal Module

    const ChallanModal = {
        init() {
            const $modal = $("#confirmModalChallan");
            const $modalTitle = $("#modalTitle");
            const $modalBody = $("#modalBody");
            const $hiddenChallanId = $("#hiddenChallanId");
            const $hiddenActionType = $("#hiddenActionType");
            const $modalConfirmBtn = $("#modalConfirmBtn");
            const $hiddenCustomerId=$("#hiddenCustomerId");
    
            // Use event delegation for dynamically added buttons
            $(".action-btn").on("click", function () {
                const $btn = $(this);
                const challanId = $btn.data("id");
                const customer = $btn.data("customer");
                const customerId = $btn.data("customer-id");
                const action = $btn.data("action"); // convert / delivery
    
                $hiddenChallanId.val(challanId);
                $hiddenCustomerId.val(customerId)
                $hiddenActionType.val(action);
               
    
                const actionsConfig = {
                    convert: {
                      title: "Confirm Conversion",
                      body: (challanId, customer) =>
                        `Are you sure you want to <strong>convert Challan ${challanId}</strong> for <strong>${customer}</strong>?`,
                      buttonText: "Yes, Convert",
                      buttonClass: "btn btn-success",
                       action:"/billing/convertToSale"
                    },
                    delivery: {
                      title: "Confirm Delivery",
                      body: (challanId, customer) =>
                        `Are you sure you want to <strong>mark delivery Challan ${challanId}</strong> for <strong>${customer}</strong>?`,
                      buttonText: "Yes, Deliver",
                      buttonClass: "btn btn-primary",
                       action:"/billing/deliver"
                    },
                    cancel: {
                      title: "Confirm Cancellation",
                      body: (challanId, customer) =>
                        `Are you sure you want to <strong>cancel Challan ${challanId}</strong> for <strong>${customer}</strong>?`,
                      buttonText: "Yes, Cancel",
                      buttonClass: "btn btn-danger",
                      action:"/billing/cancelChallan"
                    },
                  };
                  
                  // apply changes
                  const config = actionsConfig[action];
                  $modalTitle.text(config.title);
                  $modalBody.html(config.body(challanId, customer));
                  $modalConfirmBtn.text(config.buttonText).attr("class", config.buttonClass);
                  $("#actionForm").attr("action",config.action);
                  
                $modal.modal("show");
            });
        }
    };
    //move expired product
    // Move expired stock UI
const ExpiredStockUI = {
    modal: null,

    init() {
        const modalEl = document.getElementById('actionModal');

        // 🔒 SAFETY CHECKS (CRITICAL)
        if (!modalEl || typeof bootstrap === 'undefined') {
            console.warn('ExpiredStockUI: modal or bootstrap not available');
            return;
        }

        this.modal = new bootstrap.Modal(modalEl, {
            backdrop: 'static',
            keyboard: false
        });

        this.bindEvents();
    },

    bindEvents() {
        // Select all checkbox
        $('#selectAll').on('change', (e) => {
            $('.row-check')
                .prop('checked', e.target.checked)
                .trigger('change');
        });

        // Individual checkbox
        $(document).on('change', '.row-check', () => {
            const count = $('.row-check:checked').length;

            $('#moveSelectedBtn')
                .prop('disabled', count === 0)
                .text(
                    count > 0
                        ? `Move Selected (${count})`
                        : 'Move Selected'
                );
        });

        // Move button
        $('#moveSelectedBtn').on('click', (e) => {
            e.preventDefault();
            this.confirmMove();
        });

        // Modal confirm
        $('#actionModalConfirmBtn').on('click', () => {
            this.submitForm();
        });
    },

    confirmMove() {
        const count = $('.row-check:checked').length;
        if (count === 0) return;

        $('#actionModalTitle').text('Confirm Action');
        $('#actionModalBody').html(`
            <p class="mb-0">
                Are you sure you want to move 
                <strong>${count}</strong> item(s) to expired stock?
            </p>
        `);

        $('#actionModalConfirmBtn')
            .removeClass('btn-success')
            .addClass('btn-danger')
            .prop('disabled', false)
            .text('Yes, Move');

        this.modal.show();
    },

    submitForm() {
        $('#actionModalConfirmBtn')
            .prop('disabled', true)
            .text('Processing...');

        document.getElementById('expiredStockForm').submit();
    }
};

class ExpiredSettlementUI {

    constructor() {
        this.state = {
            modal: null,
            expiredId: null,
            supplierId: null,
            remainingAmount: 0,
            totalRecoverable: 0,
            selectedInvoiceId: null,
            creditBalance: 0
        };

        this.searchTimeout = null;
    }

    /* ================================
       INIT
    ================================= */

    init() {

        const modalEl = document.getElementById('settlementModal');

        if (!modalEl || typeof bootstrap === 'undefined') {
            console.warn('Modal or Bootstrap missing');
            return;
        }

        this.state.modal = new bootstrap.Modal(modalEl, {
            backdrop: 'static',
            keyboard: false
        });

        this.bindEvents();
    }

    /* ================================
       EVENTS
    ================================= */

    bindEvents() {

        $(document).on('click', '.open-settle-modal', (e) => this.openModal(e));

        $('#invoiceSearch').on('keyup', (e) => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.searchInvoice(e);
            }, 400);
        });

        $(document).on('click', '.select-invoice', (e) => this.selectInvoice(e));

        $(document).on('change', '.price-history', (e) => {
            const row = $(e.currentTarget).closest('.product-row');
            row.find('.old-price').val($(e.currentTarget).val());
            this.calculateRow(row);
        });

        $(document).on('keyup', '.old-price', (e) => {
            const row = $(e.currentTarget).closest('.product-row');
            this.calculateRow(row);
        });

        $('#confirmSettlement').on('click', () => this.submitSettlement());
    }

    /* ================================
       MODAL
    ================================= */

    openModal(e) {

        const btn = $(e.currentTarget);

        this.state.expiredId = btn.data('id');
        alert(this.state.expiredId)
        this.state.supplierId = btn.data('supplierid');
        this.state.remainingAmount = parseFloat(btn.data('remaining'));
        this.state.totalRecoverable = 0;
        this.state.creditBalance = 0;
        this.state.selectedInvoiceId = null;

        $('#modalProduct').text(btn.data('product'));
        $('#modalSupplier').text(btn.data('supplier'));
        $('#modalRemaining').text(`₹ ${this.state.remainingAmount.toFixed(2)}`);

        this.resetModal();
        this.state.modal.show();
    }

    resetModal() {
        $('#invoiceSearch').val('');
        $('#invoiceList').empty();
        $('#invoiceProducts').empty();
        $('#creditSection').remove();
        $('#totalRecoverable').text('0.00');
        $('#confirmSettlement').prop('disabled', true);
    }

    /* ================================
       SEARCH
    ================================= */

    searchInvoice(e) {

        const keyword = $(e.currentTarget).val();

        if (!keyword || keyword.length < 2) {
            $('#invoiceList').empty();
            return;
        }

        $.get('/billing/searchSupplierInvoice', {
            keyword,
            supplierId: this.state.supplierId
        }, (data) => {

            const list = $('#invoiceList');
            list.empty();

            if (!data.length) {
                list.html(`<div class="text-muted small p-2">No invoice found</div>`);
                return;
            }

            data.forEach(inv => {
                list.append(`
                    <a href="#" 
                       class="list-group-item list-group-item-action select-invoice"
                       data-id="${inv.Id}">
                        <div class="fw-semibold">${inv.SupplierInvoiceNo}</div>
                    </a>
                `);
            });
        });
    }

    /* ================================
       SELECT INVOICE
    ================================= */

    selectInvoice(e) {

        e.preventDefault();
        const invoiceId = $(e.currentTarget).data('id');
        this.state.selectedInvoiceId = invoiceId;

        $('#invoiceProducts').html(`
            <div class="text-center py-4">
                <div class="spinner-border text-primary"></div>
            </div>
        `);

        // Step 1: Check Credit
        $.get('/billing/checkInvoiceCredit', { invoiceId }, (creditData) => {

            this.renderCreditSection(creditData);

            // Step 2: Load Invoice Products
            $.get('/billing/getInvoiceProducts', { invoiceId }, 
                (products) => this.renderProducts(products)
            );
        });
    }

    loadPriceHistory(products) {

        if (!products || !products.length) return;
    
        const productIds = products.map(p => p.ProductId);
    
        $.get('/billing/getLastThreePricesBulk', {
            productIds: productIds.join(','),
            supplierId: this.state.supplierId
        }, (data) => {
    
            Object.keys(data).forEach(productId => {
    
                const card = $(`.product-row[data-product-id="${productId}"]`);
                const dropdown = card.find('.price-history');
    
                if (!dropdown.length) return;
    
                data[productId].forEach(price => {
    
                    dropdown.append(`
                        <option value="${price.PurchasePrice}">
                            ₹ ${price.PurchasePrice} (${price.InvoiceDate})
                        </option>
                    `);
                });
            });
    
        }).fail(() => {
            console.error('Failed to load price history');
        });
    }
    

    /* ================================
       CREDIT UI
    ================================= */

    renderCreditSection(creditData) {

        $('#creditSection').remove();
        this.state.creditBalance = 0;

        if (!creditData || !creditData.length) return;

        let html = `
            <div id="creditSection" class="alert alert-info">
                <h6 class="fw-bold mb-2">Available Credit</h6>
        `;

        creditData.forEach(c => {
            const amount = parseFloat(c.AvailableAmount);
            this.state.creditBalance += amount;

            html += `
                <div class="d-flex justify-content-between">
                    <span>${c.ProductName}</span>
                    <span>₹ ${amount.toFixed(2)}</span>
                </div>
            `;
        });

        html += `
                <hr>
                <div class="d-flex justify-content-between fw-bold">
                    <span>Total Credit</span>
                    <span>₹ ${this.state.creditBalance.toFixed(2)}</span>
                </div>
            </div>
        `;

        $('#invoiceProducts').before(html);
    }

    /* ================================
       RENDER PRODUCTS
    ================================= */

    renderProducts(products) {

        if (!products.length) {
            $('#invoiceProducts').html(`<div class="text-muted small">No products found.</div>`);
            return;
        }

        let html = `<div class="row g-3">`;

        products.forEach(p => {

            html += `
                <div class="col-12">
                    <div class="card shadow-sm product-row"
                         data-product-id="${p.ProductId}"
                         data-invoice-id="${p.InvoiceId}"
                         data-invoice-detail-id="${p.InvoiceDetailId}"
                         data-price="${p.PurchasePrice}"
                         data-qty="${p.Quantity}">

                        <div class="card-body">

                            <div class="d-flex justify-content-between mb-2">
                                <div>
                                    <h6 class="mb-1">${p.ProductName}</h6>
                                    <small class="text-muted">
                                        Qty: ${p.Quantity} | Current: ₹ ${p.PurchasePrice}
                                    </small>
                                </div>
                                <div class="text-success fw-bold fs-5">
                                    ₹ <span class="recoverable-amount">0.00</span>
                                </div>
                            </div>

                            <select class="form-select form-select-sm mb-2 price-history">
                                <option value="">Select from price history</option>
                            </select>

                            <input type="number"
                                   class="form-control form-control-sm old-price"
                                   placeholder="Enter old price">

                        </div>
                    </div>
                </div>
            `;
        });

        html += `
            </div>

            <div class="border-top mt-4 pt-3 d-flex justify-content-between">
                <h6>Total Recoverable</h6>
                <h5>
                    ₹ <span id="totalRecoverable">0.00</span>
                </h5>
            </div>
        `;

        $('#invoiceProducts').html(html);
      // load price history dropdown
        this.loadPriceHistory(products);
    }

    /* ================================
       CALCULATIONS
    ================================= */

    calculateRow(card) {

        const currentPrice = parseFloat(card.data('price'));
        const qty = parseFloat(card.data('qty'));
        const oldPrice = parseFloat(card.find('.old-price').val()) || 0;

        let amount = 0;

        if (oldPrice > currentPrice) {
            amount = Math.abs(currentPrice - oldPrice) * qty;
        }

        card.find('.recoverable-amount').text(amount.toFixed(2));
        this.calculateTotal();
    }

    calculateTotal() {

        let total = 0;

        $('.recoverable-amount').each(function () {
            total += parseFloat($(this).text()) || 0;
        });

        this.state.totalRecoverable = total;

        // Auto apply credit first
        let adjustedTotal = total - this.state.creditBalance;
        if (adjustedTotal < 0) adjustedTotal = 0;

        $('#totalRecoverable').text(adjustedTotal.toFixed(2));

        if (adjustedTotal > this.state.remainingAmount) {
            $('#totalRecoverable').addClass('text-danger').removeClass('text-primary');
        } else {
            $('#totalRecoverable').addClass('text-primary').removeClass('text-danger');
        }

        $('#confirmSettlement').prop('disabled', adjustedTotal <= 0);
    }

    /* ================================
       SUBMIT
    ================================= */

    submitSettlement() {

        const settlementType = $('#settlementType').val();

        if (this.state.totalRecoverable <= 0) {
            Swal.fire('Invalid', 'Recoverable amount must be greater than zero.', 'warning');
            return;
        }

        const settlements = [];

        $('.product-row').each(function () {

            const card = $(this);
            const recoverable = parseFloat(card.find('.recoverable-amount').text());

            if (recoverable > 0) {
                settlements.push({
                    invoiceId: card.data('invoice-id'),
                    invoiceDetailId: card.data('invoice-detail-id'),
                    productId: card.data('product-id'),
                    qty: card.data('qty'),
                    oldPrice: parseFloat(card.find('.old-price').val()),
                    settlementAmount: recoverable,
                    newPrice:  parseFloat(card.data('price'))
                });
            }
        });

        const btn = $('#confirmSettlement');
        btn.prop('disabled', true).html(
            `<span class="spinner-border spinner-border-sm me-2"></span>Processing`
        );

        $.ajax({
            url: '/billing/expiredStockSettle',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                expiredId: this.state.expiredId,
                invoiceId: this.state.selectedInvoiceId,
                settlementType,
                settlements
            }),
            success: () => {
                Swal.fire('Success', 'Settlement completed successfully.', 'success')
                    .then(() => location.reload());
            },
            error: () => {
                Swal.fire('Error', 'Settlement failed.', 'error');
                btn.prop('disabled', false).text('Confirm Settlement');
            }
        });
    }
}


      
    //to make changes in customer list with dues amount.this will change total dues amount 
    //it will add or remove customer to reflect their dues amount

    const CustomerLedgerHandler = {
        init() {
            const self = this;
    
            // Calculate totals on page load
            self.updateTotals();
    
            // Bind checkbox change events
            $('#customerLedgerTable').on('change', '.include-total', function () {
                self.updateTotals();
            });
        },
    
        updateTotals() {
            let totalSales = 0, totalPayments = 0, totalPending = 0;
    
            $('#customerLedgerTable tbody tr').each(function () {
                const $row = $(this);
                const include = $row.find('.include-total').is(':checked');
    
                if (include) {
                    const sales = parseFloat($row.find('[data-sales]').data('sales')) || 0;
                    const payments = parseFloat($row.find('[data-payments]').data('payments')) || 0;
                    const pending = parseFloat($row.find('[data-pending]').data('pending')) || 0;
    
                    totalSales += sales;
                    totalPayments += payments;
                    totalPending += pending;
                }
            });
    
            $('#totalsRow .total-sales').text('₹ ' + totalSales.toFixed(2));
            $('#totalsRow .total-payments').text('₹ ' + totalPayments.toFixed(2));
            $('#totalsRow .total-pending').text('₹ ' + totalPending.toFixed(2));
        }
    };

    // Initialize All Modules
    Sidebar.init();
    UIComponents.init();
    TestManager.init();
    ClinicDoctorManager.init();
    FormHandlers.init();
    FinancialYearHandler.init();
    TestCompletionManager.init();
    ChallanModal.init();
    CustomerLedgerHandler.init();
    ExpiredStockUI.init();
   // ExpiredSettlementUI.init()
   new ExpiredSettlementUI().init();

    // Set current date
    $("#date").val(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-"));

});