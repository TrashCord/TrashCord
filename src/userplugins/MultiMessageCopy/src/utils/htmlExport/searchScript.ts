/**
 * htmlExport/searchScript.ts
 *
 * Client-side JavaScript for the search/filter panel embedded in the
 * standalone HTML export. No external dependencies. Works offline.
 *
 * Security: all user content is accessed via DOM .textContent / dataset,
 * never injected as JS literals from the server side. Highlights are
 * built with document.createElement, never innerHTML.
 *
 * Features:
 *   - Text search across message content (debounced, 200 ms)
 *   - Filter by username
 *   - Filter: attachments only
 *   - Filter: links only
 *   - Filter: media only
 *   - Result count display
 *   - Next / Previous navigation
 *   - Clear button
 *   - CSS-class toggling (no DOM removal)
 *   - Keyboard shortcut: Escape clears search
 */

export const HTML_EXPORT_SEARCH_SCRIPT = `
(function () {

  /* ── Build search index from DOM ── */

  var messages = [];

  function buildIndex() {
    var articles = document.querySelectorAll(".message");
    messages = [];
    for (var i = 0; i < articles.length; i++) {
      var el = articles[i];
      var contentEl = el.querySelector(".message-content");
      var authorEl  = el.querySelector(".msg-author") || el.querySelector(".avatar");
      var text    = contentEl ? (contentEl.textContent || "").toLowerCase() : "";
      var author  = (authorEl ? (authorEl.textContent || authorEl.getAttribute("aria-label") || "") : "").toLowerCase();
      var userId  = el.getAttribute("data-author-id") || "";
      var hasAtt  = el.querySelector(".msg-attachments, .media-container") !== null;
      var hasMedia = el.querySelector(".media-img, .media-video, .gif-img, .gif-video, .sticker-img") !== null;
      var hasLink = el.querySelector("a.link:not(.missing-link), a.att-fallback-link") !== null;
      messages.push({ el: el, text: text, author: author, userId: userId, hasAtt: hasAtt, hasMedia: hasMedia, hasLink: hasLink });
    }
  }

  /* ── State ── */

  var currentResults = [];
  var currentIndex   = -1;
  var debounceTimer  = null;

  /* ── DOM refs ── */

  var searchInput    = document.getElementById("search-input");
  var userFilter     = document.getElementById("search-user-filter");
  var attFilter      = document.getElementById("filter-attachments");
  var linkFilter     = document.getElementById("filter-links");
  var mediaFilter    = document.getElementById("filter-media");
  var resultCount    = document.getElementById("search-result-count");
  var btnPrev        = document.getElementById("search-prev");
  var btnNext        = document.getElementById("search-next");
  var btnClear       = document.getElementById("search-clear");

  if (!searchInput) return; // search panel not present, skip

  /* ── Populate user dropdown ── */

  function populateUserDropdown() {
    var seen = {};
    for (var i = 0; i < messages.length; i++) {
      var uid   = messages[i].userId;
      var authorText = messages[i].author;
      if (uid && !seen[uid]) {
        seen[uid] = authorText;
        var opt = document.createElement("option");
        opt.value = uid;
        // Try to get a nicer display name from PARTICIPANTS data
        var p = (typeof PARTICIPANTS !== "undefined") ? PARTICIPANTS[uid] : null;
        opt.textContent = p ? p.displayName : authorText;
        userFilter.appendChild(opt);
      }
    }
  }

  /* ── Run filter ── */

  function runFilter() {
    var query       = (searchInput.value || "").toLowerCase().trim();
    var userId      = userFilter ? userFilter.value : "";
    var onlyAtt     = attFilter  ? attFilter.checked  : false;
    var onlyLink    = linkFilter ? linkFilter.checked  : false;
    var onlyMedia   = mediaFilter ? mediaFilter.checked : false;

    currentResults = [];
    currentIndex   = -1;

    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];

      // User filter
      if (userId && m.userId !== userId) {
        m.el.classList.add("search-hidden");
        continue;
      }

      // Attachment filter
      if (onlyAtt && !m.hasAtt) {
        m.el.classList.add("search-hidden");
        continue;
      }

      // Link filter
      if (onlyLink && !m.hasLink) {
        m.el.classList.add("search-hidden");
        continue;
      }

      // Media filter
      if (onlyMedia && !m.hasMedia) {
        m.el.classList.add("search-hidden");
        continue;
      }

      // Text query
      if (query && m.text.indexOf(query) === -1 && m.author.indexOf(query) === -1) {
        m.el.classList.add("search-hidden");
        continue;
      }

      m.el.classList.remove("search-hidden");
      currentResults.push(m);
    }

    updateResultCount();
    updateNavButtons();

    // Auto-navigate to first result when there are results
    if (currentResults.length > 0 && (query || userId || onlyAtt || onlyLink || onlyMedia)) {
      currentIndex = 0;
      scrollToResult(0);
    }
  }

  function clearFilter() {
    for (var i = 0; i < messages.length; i++) {
      messages[i].el.classList.remove("search-hidden");
      messages[i].el.classList.remove("search-current");
    }
    currentResults = [];
    currentIndex   = -1;
    updateResultCount();
    updateNavButtons();
  }

  /* ── Navigation ── */

  function scrollToResult(idx) {
    // Remove highlight from previous
    for (var i = 0; i < currentResults.length; i++) {
      currentResults[i].el.classList.remove("search-current");
    }
    if (idx < 0 || idx >= currentResults.length) return;
    var target = currentResults[idx];
    target.el.classList.add("search-current");
    target.el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ── Result count + nav button state ── */

  function updateResultCount() {
    if (!resultCount) return;
    var total = messages.length;
    var shown = currentResults.length;
    var isFiltered = searchInput.value.trim() ||
      (userFilter && userFilter.value) ||
      (attFilter && attFilter.checked) ||
      (linkFilter && linkFilter.checked) ||
      (mediaFilter && mediaFilter.checked);

    if (!isFiltered) {
      resultCount.textContent = total + " message" + (total === 1 ? "" : "s");
      resultCount.style.color = "";
    } else {
      resultCount.textContent = shown + " result" + (shown === 1 ? "" : "s") + " of " + total;
      resultCount.style.color = shown === 0 ? "var(--search-no-result-color, #ed4245)" : "";
    }
  }

  function updateNavButtons() {
    if (!btnPrev || !btnNext) return;
    var hasResults = currentResults.length > 0;
    btnPrev.disabled = !hasResults || currentIndex <= 0;
    btnNext.disabled = !hasResults || currentIndex >= currentResults.length - 1;
  }

  /* ── Event wiring ── */

  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runFilter, 200);
  });

  if (userFilter) {
    userFilter.addEventListener("change", runFilter);
  }

  function wireCheckbox(cb) {
    if (cb) cb.addEventListener("change", runFilter);
  }
  wireCheckbox(attFilter);
  wireCheckbox(linkFilter);
  wireCheckbox(mediaFilter);

  if (btnPrev) {
    btnPrev.addEventListener("click", function () {
      if (currentIndex > 0) {
        currentIndex--;
        scrollToResult(currentIndex);
        updateNavButtons();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", function () {
      if (currentIndex < currentResults.length - 1) {
        currentIndex++;
        scrollToResult(currentIndex);
        updateNavButtons();
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener("click", function () {
      searchInput.value = "";
      if (userFilter)  userFilter.value = "";
      if (attFilter)   attFilter.checked  = false;
      if (linkFilter)  linkFilter.checked  = false;
      if (mediaFilter) mediaFilter.checked = false;
      clearFilter();
    });
  }

  // Escape key closes / clears search
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    // Only act if nothing else (lightbox/popout) already consumed Escape
    var lightbox = document.getElementById("lightbox");
    var popout   = document.getElementById("popout");
    if (lightbox && !lightbox.hidden) return;
    if (popout   && !popout.hidden)   return;
    if (searchInput === document.activeElement || searchInput.value.trim()) {
      searchInput.value = "";
      if (userFilter)  userFilter.value = "";
      if (attFilter)   attFilter.checked  = false;
      if (linkFilter)  linkFilter.checked  = false;
      if (mediaFilter) mediaFilter.checked = false;
      clearFilter();
      e.preventDefault();
    }
  });

  /* ── Init ── */

  buildIndex();
  populateUserDropdown();
  updateResultCount();
  updateNavButtons();

})();
`
