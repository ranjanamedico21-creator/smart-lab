/*$.fn.pageMe = function (opts) {
  var $this = this,
    defaults = {
      perPage: 7,
      showPrevNext: false,
      hidePageNumbers: false,
    },
    settings = $.extend(defaults, opts);

  var listElement = $this;
  var perPage = settings.perPage;
  var children = listElement.children();
  var pager = $(".pager");

  if (typeof settings.childSelector != "undefined") {
    children = listElement.find(settings.childSelector);
  }

  if (typeof settings.pagerSelector != "undefined") {
    pager = $(settings.pagerSelector);
  }

  var numItems = children.length;
  var numPages = Math.ceil(numItems / perPage);

  pager.data("curr", 0);

  if (settings.showPrevNext) {
    $(
      '<li class="page-item"><a href="#" class="prev_link page-link" aria-label="Previous">«</a></li>'
    ).appendTo(pager);
  }

  var curr = 0;
  while (numPages > curr && settings.hidePageNumbers == false) {
    $(
      '<li class="page-item"><a href="#" class="page_link page-link" >' +
        (curr + 1) +
        "</a></li>"
    ).appendTo(pager);
    curr++;
  }

  if (settings.showPrevNext) {
    $(
      '<li class="page-item"><a href="#" class="next_link page-link" aria-label="Next">»</a></li>'
    ).appendTo(pager);
  }

  pager.find(".page_link:first").addClass("active");
  pager.find(".prev_link").hide();
  if (numPages <= 1) {
    pager.find(".next_link").hide();
  }
  pager.children().eq(1).addClass("active");

  children.hide();
  children.slice(0, perPage).show();

  pager.find("li .page_link").click(function () {
    var clickedPage = $(this).html().valueOf() - 1;
    goTo(clickedPage, perPage);
    return false;
  });
  pager.find("li .prev_link").click(function () {
    previous();
    return false;
  });
  pager.find("li .next_link").click(function () {
    next();
    return false;
  });

  function previous() {
    var goToPage = parseInt(pager.data("curr")) - 1;
    goTo(goToPage);
  }

  function next() {
    goToPage = parseInt(pager.data("curr")) + 1;
    goTo(goToPage);
  }

  function goTo(page) {
    var startAt = page * perPage,
      endOn = startAt + perPage;

    children.css("display", "none").slice(startAt, endOn).show();

    if (page >= 1) {
      pager.find(".prev_link").show();
    } else {
      pager.find(".prev_link").hide();
    }

    if (page < numPages - 1) {
      pager.find(".next_link").show();
    } else {
      pager.find(".next_link").hide();
    }

    pager.data("curr", page);
    pager.find(".page_link:first").removeClass("active");
    pager.children().removeClass("active");
    pager
      .children()
      .eq(page + 1)
      .addClass("active");
  }
};
*/


$.fn.pageMe = function (opts) {
  var $this = this,
    defaults = {
      perPage: 7,
      showPrevNext: true,  // Ensure prev/next buttons are visible
      hidePageNumbers: false,
    },
    settings = $.extend(defaults, opts);

  var listElement = $this;
  var perPage = settings.perPage;
  var children = listElement.children();
  var pager = $("#pagination_Number");

  if (typeof settings.childSelector != "undefined") {
    children = listElement.find(settings.childSelector);
  }

  var numItems = children.length;
  var numPages = Math.ceil(numItems / perPage);
  pager.data("curr", 0);

  // Reset pagination to prevent duplication
  pager.html(`
    <li class="page-item disabled"><a class="page-link rounded-pill px-3" href="#">Previous</a></li>
    <li class="page-item"><a class="page-link rounded-pill px-3" href="#">Next</a></li>
  `);

  if (!settings.hidePageNumbers) {
    for (var i = 0; i < numPages; i++) {
      $(
        `<li class="page-item"><a class="page-link rounded-pill px-3 page_link" href="#">${i + 1}</a></li>`
      ).insertBefore(pager.find(".page-item:last")); // Insert before "Next"
    }
  }

  pager.find(".page_link:first").addClass("active");
  pager.find(".page-item:first").addClass("disabled"); // Disable "Previous" initially

  children.hide();
  children.slice(0, perPage).show();

  pager.find(".page_link").click(function () {
    var clickedPage = parseInt($(this).text()) - 1;
    goTo(clickedPage, perPage);
    return false;
  });

  pager.find(".page-item:first").click(function () {
    previous();
    return false;
  });

  pager.find(".page-item:last").click(function () {
    next();
    return false;
  });

  function previous() {
    var goToPage = parseInt(pager.data("curr")) - 1;
    goTo(goToPage);
  }

  function next() {
    var goToPage = parseInt(pager.data("curr")) + 1;
    goTo(goToPage);
  }

  function goTo(page) {
    if (page < 0 || page >= numPages) return;
  
    var startAt = page * perPage,
      endOn = startAt + perPage;
  
    children.hide().slice(startAt, endOn).show();
  
    pager.data("curr", page);
    pager.find(".page_link").removeClass("active");
    let activePage = pager.find(".page_link").eq(page);
    activePage.addClass("active");
  
    // **Smooth Scrolling Adjustment**
    let container = document.getElementById("pagination_Number");
    let activeElement = activePage[0];
    if (activeElement) {
      container.scrollTo({
        left: activeElement.offsetLeft - container.offsetWidth / 2, // Center active page
        behavior: "smooth",
      });
    }
  
    // Enable/Disable prev-next buttons
    pager.find(".prev_link").parent().toggleClass("disabled", page === 0);
    pager.find(".next_link").parent().toggleClass("disabled", page === numPages - 1);
  }
  
  
  /*function goTo(page) {
    if (page < 0 || page >= numPages) return;

    var startAt = page * perPage,
      endOn = startAt + perPage;

    children.hide().slice(startAt, endOn).show();

    pager.data("curr", page);
    pager.find(".page_link").removeClass("active");
    pager.find(".page_link").eq(page).addClass("active");

    if (page === 0) {
      pager.find(".page-item:first").addClass("disabled"); // Disable "Previous"
    } else {
      pager.find(".page-item:first").removeClass("disabled");
    }

    if (page === numPages - 1) {
      pager.find(".page-item:last").addClass("disabled"); // Disable "Next"
    } else {
      pager.find(".page-item:last").removeClass("disabled");
    }
  }*/
};
