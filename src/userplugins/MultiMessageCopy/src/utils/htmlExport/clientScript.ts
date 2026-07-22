/**
 * htmlExport/clientScript.ts
 *
 * Client-side JavaScript embedded in the standalone HTML export.
 * Handles:
 *   - Image lightbox
 *   - User profile popout + copy user ID
 *   - Missing/deleted media fallback (error event capture)
 *   - Custom emoji broken-image fallback (pill showing :name:)
 *
 * Security: no raw user content is ever injected as JS literals here.
 * All user data is read via the PARTICIPANTS JSON object that is
 * safely built server-side by buildPopoutDataScript().
 * The missing-content placeholder is built with DOM APIs (textContent /
 * createElement), never innerHTML with untrusted values.
 */

export const HTML_EXPORT_CLIENT_SCRIPT = `
(function () {

  /* ── Missing / deleted media fallback ── */

  var MISSING_TEXT = "This content was deleted from the hoster, original user & channel, or Discord itself.";

  function makeMissingCard(originalUrl) {
    var card = document.createElement("div");
    card.className = "missing-content-card";

    var iconWrap = document.createElement("div");
    iconWrap.className = "missing-content-icon";
    iconWrap.setAttribute("aria-hidden", "true");
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "20"); svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.5");
    var circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx","12"); circle.setAttribute("cy","12"); circle.setAttribute("r","10");
    var line1 = document.createElementNS(svgNS, "line");
    line1.setAttribute("x1","12"); line1.setAttribute("y1","8");
    line1.setAttribute("x2","12"); line1.setAttribute("y2","12");
    var line2 = document.createElementNS(svgNS, "line");
    line2.setAttribute("x1","12"); line2.setAttribute("y1","16");
    line2.setAttribute("x2","12.01"); line2.setAttribute("y2","16");
    svg.appendChild(circle); svg.appendChild(line1); svg.appendChild(line2);
    iconWrap.appendChild(svg);

    var body = document.createElement("div");
    body.className = "missing-content-body";
    var txt = document.createElement("span");
    txt.className = "missing-content-text";
    txt.textContent = MISSING_TEXT;
    body.appendChild(txt);

    if (originalUrl) {
      var br = document.createElement("br");
      body.appendChild(br);
      var a = document.createElement("a");
      a.className = "missing-link link";
      a.href = originalUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      // Truncate display label safely
      var label = originalUrl.length > 60 ? originalUrl.slice(0, 60) + "\\u2026" : originalUrl;
      a.textContent = label;
      body.appendChild(a);
    }

    card.appendChild(iconWrap);
    card.appendChild(body);
    return card;
  }

  /**
   * Replace a broken media element with the missing-content placeholder.
   * For custom emojis (<img data-emoji-name>): show an inline pill instead.
   */
  function handleMediaError(el) {
    if (!el || !el.getAttribute || !el.getAttribute("data-missing-fallback")) return;

    // Custom emoji: inline pill fallback
    if (el.tagName === "IMG" && el.getAttribute("data-emoji-name")) {
      var emojiName = el.getAttribute("data-emoji-name") || "?";
      var pill = document.createElement("span");
      pill.className = "emoji-fallback-pill";
      pill.title = el.title || (":" + emojiName + ":");
      pill.textContent = ":" + emojiName + ":";
      if (el.parentNode) el.parentNode.replaceChild(pill, el);
      return;
    }

    var originalUrl = el.getAttribute("data-original-url") || "";
    var card = makeMissingCard(originalUrl || undefined);

    // For sticker-wrap, replace the img inside it; show the fallback card sibling
    var stickerWrap = el.closest && el.closest(".sticker-wrap");
    if (stickerWrap) {
      var imgEl = stickerWrap.querySelector("img");
      var fallbackCard = stickerWrap.querySelector(".sticker-fallback-card");
      if (imgEl) imgEl.style.display = "none";
      if (fallbackCard) fallbackCard.style.display = "flex";
      return;
    }

    // Walk up to find a meaningful container to replace:
    // media-preview, video-wrap, audio-wrap, embed-thumbnail/image/video
    var container = (
      el.closest(".media-preview") ||
      el.closest(".video-wrap") ||
      el.closest(".audio-wrap") ||
      el.parentNode
    );

    if (container && container !== document.body) {
      container.parentNode && container.parentNode.replaceChild(card, container);
    } else {
      el.parentNode && el.parentNode.replaceChild(card, el);
    }
  }

  // Use capture-phase error listener to catch errors on all media elements
  document.addEventListener("error", function (e) {
    handleMediaError(e.target);
  }, true /* capture */);

  /* ── Lightbox ── */
  var lightbox = document.getElementById("lightbox");
  var lbImg    = document.getElementById("lightbox-img");
  var lbName   = document.getElementById("lightbox-filename");
  var lbOpen   = document.getElementById("lightbox-open");
  var lbClose  = document.getElementById("lightbox-close");

  function openLightbox(src, filename) {
    lbImg.src = src;
    lbImg.alt = filename;
    lbName.textContent = filename;
    lbOpen.href = src;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    lbClose.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbImg.src = "";
    document.body.style.overflow = "";
  }

  document.querySelectorAll(".media-preview[data-full-src]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      var filenameEl = el.querySelector(".media-filename");
      openLightbox(
        el.getAttribute("data-full-src"),
        el.getAttribute("data-filename") || (filenameEl ? filenameEl.textContent : "") || ""
      );
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLightbox(
          el.getAttribute("data-full-src"),
          el.getAttribute("data-filename") || ""
        );
      }
    });
  });

  lbClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  /* ── User profile popout ── */
  var popout        = document.getElementById("popout");
  var popoutOverlay = document.getElementById("popout-overlay");
  var popoutAvatar  = document.getElementById("popout-avatar");
  var popoutBanner  = document.getElementById("popout-banner");
  var popoutName    = document.getElementById("popout-display-name");
  var popoutUser    = document.getElementById("popout-username");
  var popoutId      = document.getElementById("popout-user-id");
  var popoutCopy    = document.getElementById("popout-copy-id");
  var popoutCount   = document.getElementById("popout-msg-count");

  function openPopout(triggerEl) {
    var userId = triggerEl.getAttribute("data-user-id");
    if (!userId) return;
    var p = PARTICIPANTS[userId];
    if (!p) return;

    popoutAvatar.src = p.avatarUrl;
    popoutAvatar.alt = p.displayName;
    popoutAvatar.onerror = function () {
      this.onerror = null;
      this.src = p.fallbackUrl;
    };

    popoutBanner.style.background = "#5865f2";

    popoutName.textContent = p.displayName;
    popoutUser.textContent = p.discriminator && p.discriminator !== "0"
      ? p.username + "#" + p.discriminator
      : "@" + p.username;
    popoutId.textContent = p.id;
    popoutCount.textContent =
      p.msgCount + " message" + (p.msgCount === 1 ? "" : "s") + " in this export";
    popoutCopy.classList.remove("copied");
    popoutCopy.textContent = "";

    var svgNS2 = "http://www.w3.org/2000/svg";
    var svg2 = document.createElementNS(svgNS2, "svg");
    svg2.setAttribute("width", "12"); svg2.setAttribute("height", "12");
    svg2.setAttribute("viewBox", "0 0 24 24"); svg2.setAttribute("fill", "none");
    svg2.setAttribute("stroke", "currentColor"); svg2.setAttribute("stroke-width", "2");
    var r = document.createElementNS(svgNS2, "rect");
    r.setAttribute("x", "9"); r.setAttribute("y", "9");
    r.setAttribute("width", "13"); r.setAttribute("height", "13"); r.setAttribute("rx", "2");
    var path = document.createElementNS(svgNS2, "path");
    path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
    svg2.appendChild(r); svg2.appendChild(path);
    popoutCopy.appendChild(svg2);
    popoutCopy.appendChild(document.createTextNode(" Copy"));

    var rect = triggerEl.getBoundingClientRect();
    var pw = 260;
    var left = rect.right + 8;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8;
    if (left < 8) left = 8;
    var top = Math.min(rect.top, window.innerHeight - 380);
    if (top < 8) top = 8;

    popout.style.left = left + "px";
    popout.style.top  = top + "px";
    popout.hidden = false;
    popoutOverlay.hidden = false;
  }

  window.openPopout = openPopout;

  function closePopout() {
    popout.hidden = true;
    popoutOverlay.hidden = true;
  }

  popoutOverlay.addEventListener("click", closePopout);

  popoutCopy.addEventListener("click", function () {
    var id = popoutId.textContent;
    if (!id) return;
    navigator.clipboard.writeText(id).then(function () {
      popoutCopy.classList.add("copied");
      popoutCopy.textContent = " Copied!";
    }).catch(function () {
      var ta = document.createElement("textarea");
      ta.value = id;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
      popoutCopy.classList.add("copied");
      popoutCopy.textContent = " Copied!";
    });
  });

  /* ── Global ESC handler ── */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!lightbox.hidden) { closeLightbox(); return; }
      if (!popout.hidden)   { closePopout();   return; }
    }
  });

  /* ── Click outside popout ── */
  document.addEventListener("click", function (e) {
    if (
      !popout.hidden &&
      !popout.contains(e.target) &&
      !e.target.closest(".avatar") &&
      !e.target.closest(".msg-author")
    ) {
      closePopout();
    }
  });

  /* ── Spoiler reveal ── */
  document.addEventListener("click", function (e) {
    var el = e.target.closest(".spoiler");
    if (!el) return;
    el.classList.toggle("revealed");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = document.activeElement;
    if (!el || !el.classList.contains("spoiler")) return;
    e.preventDefault();
    el.classList.toggle("revealed");
  });
})();
`
