// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Blinds Nisa "Free Estimate" lead form, embeddable on any page.
 *
 * Paste into an Elementor HTML widget (or any HTML block):
 *
 *   <div id="bn-lead-form"
 *        data-api="https://<api-worker-host>"   (omit = demo mode, nothing is sent)
 *        data-sitekey="<turnstile site key>"     (omit = no bot check, dev only)
 *        data-phone="613-699-1837"
 *        data-email="info@blindsnisa.com"></div>
 *   <script src="https://<web-worker-host>/embed/lead-form.js" defer></script>
 *
 * Four steps: (1) contact details, (2) window coverings + window count,
 * (3) review + SMS/email consent + Confirm, (4) confirmation and next steps.
 * The form renders inside a shadow root with its own stylesheet
 * (lead-form.css, resolved next to this script), so the host theme cannot
 * restyle it. The scene beside the form is a window whose shade rises as
 * the visitor progresses and previews the covering type they picked. Step
 * changes play a venetian-slat close/open transition. Everything honours
 * prefers-reduced-motion.
 *
 * On Confirm it POSTs JSON to `${data-api}/intake/lead` (see
 * knowledge/plans/2026-10-05-website-lead-capture.md). Validation here is
 * only for the visitor's convenience. The Worker re-validates everything
 * strictly. On success it dispatches a `bn:lead-submitted` event on the
 * host element and, when Google Analytics is on the page, a
 * `generate_lead` gtag event.
 */
(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  var BASE = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^/?#]*([?#].*)?$/, '') : '';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Shade position per step: 1 = fully down, 0 = fully open. */
  var DROP = { 1: 0.85, 2: 0.6, 3: 0.32, 4: 0 };
  /** Upper bound on transition slats; the visible count follows the step height. */
  var SLAT_MAX = 28;
  /** Target slat height in px, so slats look like real blind slats at any size. */
  var SLAT_PX = 44;

  var ICON_FRAME = '<rect x="5" y="4" width="22" height="24" rx="2"/>';
  var FILL = ' fill="currentColor" stroke="none" opacity=".22"';

  /** Covering types offered on blindsnisa.com, in the site menu's order. */
  var COVERS = [
    { id: 'zebra', label: 'Zebra', icon: ICON_FRAME + '<path d="M8 8h16v3H8zM8 14h16v3H8zM8 20h16v3H8z"' + FILL + '/><path d="M8 11h16M8 17h16M8 23h16"/>' },
    { id: 'roller', label: 'Roller', icon: ICON_FRAME + '<path d="M8 8h16v11H8z"' + FILL + '/><path d="M5 8h22M8 19h16M16 19v3"/>' },
    { id: 'solar', label: 'Solar', icon: ICON_FRAME + '<path d="M8 8h16v17H8z"' + FILL + '/><circle cx="20" cy="13" r="3"/><path d="M8 25l6-6 4 3 6-5"/>' },
    { id: 'honeycomb', label: 'Honeycomb', icon: ICON_FRAME + '<path d="M8 10l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5M8 15l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5M8 20l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5"/>' },
    { id: 'roman', label: 'Roman', icon: ICON_FRAME + '<path d="M8 8h16v8H8z"' + FILL + '/><path d="M8 16q8 4 16 0M8 20q8 4 16 0"/>' },
    { id: 'shutters', label: 'Shutters', icon: ICON_FRAME + '<path d="M16 4v24M8 9h5M8 13h5M8 17h5M8 21h5M19 9h5M19 13h5M19 17h5M19 21h5"/>' },
    { id: 'drapery', label: 'Drapery', icon: '<path d="M4 5h24"/><path d="M7 5c1 8 3 15 1 23h5c-2-8 0-15 0-23M25 5c-1 8-3 15-1 23h-5c2-8 0-15 0-23"' + FILL + '/><path d="M7 5c1 8 3 15 1 23h5c-2-8 0-15 0-23M25 5c-1 8-3 15-1 23h-5c2-8 0-15 0-23"/>' },
    { id: 'smart', label: 'Smart / Motorized', icon: ICON_FRAME + '<path d="M8 8h16v6H8z"' + FILL + '/><path d="M5 8h22M12 21.5a5.5 5.5 0 0 1 8 0M9.5 18.5a9 9 0 0 1 13 0"/><circle cx="16" cy="24" r="1" fill="currentColor"/>' },
    { id: 'unsure', label: 'Not sure yet', icon: ICON_FRAME + '<path d="M13 12.5a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.8v.9"/><circle cx="16" cy="21.5" r="1" fill="currentColor"/>' },
  ];

  /** Window-count buckets; `panes` is how many little windows the card draws. */
  var COUNTS = [
    { id: '1-5', label: '1 – 5', hint: 'A room or two', panes: 1 },
    { id: '5-15', label: '5 – 15', hint: 'Several rooms', panes: 3 },
    { id: '15+', label: '15+', hint: 'Whole home', panes: 5 },
  ];

  var PROVINCES = [
    ['ON', 'Ontario'], ['QC', 'Quebec'], ['AB', 'Alberta'], ['BC', 'British Columbia'],
    ['MB', 'Manitoba'], ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
    ['NS', 'Nova Scotia'], ['PE', 'Prince Edward Island'], ['SK', 'Saskatchewan'],
    ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['YT', 'Yukon'],
  ];

  var ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------------------------------------------------------------- */
  /* Validation helpers                                                */
  /* ---------------------------------------------------------------- */

  /** Digits only, without a leading North American country code. */
  function phoneDigits(v) {
    var d = String(v).replace(/\D/g, '');
    return d.length === 11 && d.charAt(0) === '1' ? d.slice(1) : d;
  }

  /** Pretty-prints a partial or full 10-digit number as (613) 555-0123. */
  function formatPhone(v) {
    var d = phoneDigits(v).slice(0, 10);
    if (d.length < 4) return d;
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  var POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Per-field rules: return an error message, or '' when valid. */
  var RULES = {
    first_name: function (v) { return v.trim() ? '' : 'Please enter your first name.'; },
    last_name: function (v) { return v.trim() ? '' : 'Please enter your last name.'; },
    phone: function (v) { return phoneDigits(v).length === 10 ? '' : 'Please enter a 10-digit phone number.'; },
    email: function (v) { return EMAIL_RE.test(v.trim()) ? '' : 'Please enter a valid email address.'; },
    street: function (v) { return v.trim().length >= 3 ? '' : 'Please enter your street address.'; },
    city: function (v) { return v.trim() ? '' : 'Please enter your city.'; },
    province: function (v) { return v ? '' : 'Please choose your province.'; },
    postal_code: function (v) { return POSTAL_RE.test(v.trim().toUpperCase()) ? '' : 'Please enter a postal code like K1A 0B1.'; },
  };

  /* ---------------------------------------------------------------- */
  /* Markup                                                            */
  /* ---------------------------------------------------------------- */

  /** One labelled input with its error slot. `cls` sets the grid span. */
  function field(name, label, cls, attrs, optional) {
    return (
      '<div class="field ' + cls + '">' +
      '<label for="f-' + name + '">' + label + (optional ? ' <span class="opt">(optional)</span>' : '') + '</label>' +
      '<input id="f-' + name + '" name="' + name + '" ' + attrs + (optional ? '' : ' required aria-required="true"') +
      ' aria-describedby="e-' + name + '">' +
      '<p class="err" id="e-' + name + '" aria-live="polite"></p></div>'
    );
  }

  function sceneHtml() {
    return (
      '<aside class="scene" aria-hidden="true">' +
      '<div class="window"><div class="glass">' +
      '<div class="sun"></div><div class="cloud c1"></div><div class="cloud c2"></div>' +
      '<div class="hill h1"></div><div class="tree"></div><div class="hill h2"></div>' +
      '<div class="mullion"></div>' +
      '<div class="shade"><div class="fabric"></div><div class="bottomrail"></div></div>' +
      '<div class="headrail"><span class="motor"></span></div>' +
      '<div class="cord"></div>' +
      '</div><div class="sill"></div></div>' +
      '<div class="scene-copy"><strong>Free in-home estimate</strong>' +
      '<span>Ottawa &amp; surrounding area</span>' +
      '<ul class="perks">' +
      ['We bring samples to your home', 'Every window measured for free', 'Custom-made and professionally installed']
        .map(function (t) { return '<li>' + CHECK + t + '</li>'; }).join('') +
      '</ul></div></aside>'
    );
  }

  function stepOneHtml() {
    var provinces = PROVINCES.map(function (p) {
      return '<option value="' + p[0] + '"' + (p[0] === 'ON' ? ' selected' : '') + '>' + p[1] + '</option>';
    }).join('');
    return (
      '<section class="step" data-step="1" tabindex="-1" aria-labelledby="t1">' +
      '<h2 class="step-title" id="t1">Let’s start with you</h2>' +
      '<p class="step-sub">We’ll use this to book your free in-home consultation.</p>' +
      '<div class="grid">' +
      field('first_name', 'First name', 'span-3', 'type="text" autocomplete="given-name" maxlength="60"') +
      field('last_name', 'Last name', 'span-3', 'type="text" autocomplete="family-name" maxlength="60"') +
      field('phone', 'Phone', 'span-3', 'type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(613) 555-0123" maxlength="20"') +
      field('email', 'Email', 'span-3', 'type="email" autocomplete="email" placeholder="you@example.com" maxlength="200"') +
      field('street', 'Street address', 'span-4', 'type="text" autocomplete="address-line1" placeholder="123 Bank St" maxlength="200"') +
      field('unit', 'Unit / Apt', 'span-2', 'type="text" autocomplete="address-line2" maxlength="60"', true) +
      field('city', 'City', 'span-2', 'type="text" autocomplete="address-level2" placeholder="Ottawa" maxlength="80"') +
      '<div class="field span-2"><label for="f-province">Province</label>' +
      '<select id="f-province" name="province" autocomplete="address-level1" required aria-describedby="e-province">' + provinces + '</select>' +
      '<p class="err" id="e-province" aria-live="polite"></p></div>' +
      field('postal_code', 'Postal code', 'span-2', 'type="text" autocomplete="postal-code" placeholder="K1A 0B1" maxlength="7"') +
      '</div>' +
      '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary" data-next>Continue ' + ARROW + '</button></div>' +
      '</section>'
    );
  }

  function stepTwoHtml() {
    var covers = COVERS.map(function (c) {
      return (
        '<div class="choice"><input type="checkbox" id="c-' + c.id + '" name="coverings" value="' + c.id + '">' +
        '<label for="c-' + c.id + '"><span class="check">' + CHECK + '</span>' +
        '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + c.icon + '</svg>' +
        c.label + '</label></div>'
      );
    }).join('');
    var counts = COUNTS.map(function (n) {
      return (
        '<div class="choice"><input type="radio" id="n-' + n.panes + '" name="window_count" value="' + n.id + '">' +
        '<label for="n-' + n.panes + '"><span class="check">' + CHECK + '</span>' +
        '<span class="panes" aria-hidden="true">' + new Array(n.panes + 1).join('<i></i>') + '</span>' +
        '<strong>' + n.label + '</strong><small>' + n.hint + '</small></label></div>'
      );
    }).join('');
    return (
      '<section class="step" data-step="2" tabindex="-1" aria-labelledby="t2" hidden>' +
      '<h2 class="step-title" id="t2">What’s on your wish list?</h2>' +
      '<p class="step-sub">Pick everything you’re curious about. We’ll bring samples.</p>' +
      '<div role="group" aria-labelledby="g-covers" aria-describedby="e-coverings">' +
      '<span class="group-label" id="g-covers">Window coverings <small>(choose any)</small></span>' +
      '<div class="covers">' + covers + '</div>' +
      '<p class="err" id="e-coverings" aria-live="polite"></p></div>' +
      '<div role="radiogroup" aria-labelledby="g-count" aria-describedby="e-window_count" style="margin-top:18px">' +
      '<span class="group-label" id="g-count">How many windows?</span>' +
      '<div class="counts">' + counts + '</div>' +
      '<p class="err" id="e-window_count" aria-live="polite" style="margin-top:8px"></p></div>' +
      '<div class="actions"><button type="button" class="btn btn-ghost" data-back>Back</button>' +
      '<button type="submit" class="btn btn-primary" data-next>Continue ' + ARROW + '</button></div>' +
      '</section>'
    );
  }

  function stepThreeHtml() {
    return (
      '<section class="step" data-step="3" tabindex="-1" aria-labelledby="t3" hidden>' +
      '<h2 class="step-title" id="t3">Review &amp; confirm</h2>' +
      '<p class="step-sub">Make sure everything looks right, then confirm.</p>' +
      '<dl class="review" data-review></dl>' +
      '<label class="consent" data-consent-box>' +
      '<input type="checkbox" name="consent" aria-describedby="e-consent">' +
      '<span>I agree to receive <b>emails</b> and <b>text messages (SMS)</b> from Blinds Nisa Inc. about my estimate and appointment.' +
      '<small>Message and data rates may apply. You can unsubscribe at any time by replying STOP or contacting us.</small></span>' +
      '</label>' +
      '<p class="err" id="e-consent" aria-live="polite" style="margin-top:8px"></p>' +
      '<div class="turnstile"><slot name="turnstile"></slot></div>' +
      '<div class="alert" data-alert role="alert" hidden></div>' +
      '<div class="actions"><button type="button" class="btn btn-ghost" data-back>Back</button>' +
      '<button type="submit" class="btn btn-primary" data-confirm>Confirm my free estimate</button></div>' +
      '</section>'
    );
  }

  function stepFourHtml(phone, email) {
    var tel = phone.replace(/[^\d+]/g, '');
    return (
      '<section class="step" data-step="4" tabindex="-1" aria-labelledby="t4" hidden>' +
      '<div class="done-head"><svg class="tick" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26"/><path d="M17 29l7.5 7.5L39 21"/></svg>' +
      '<div><h2 class="step-title" id="t4">Thanks, <span data-first></span>! Your request is in.</h2>' +
      '<p class="step-sub" style="margin:0">Here’s what happens next.</p></div></div>' +
      '<ol class="next">' +
      '<li><strong>We’ll reach out within 1 business day</strong><span>By phone or text at <b data-phone-out></b> to pick a time that suits you.</span></li>' +
      '<li><strong>Free in-home consultation</strong><span>We bring samples, measure every window and answer your questions. No obligation.</span></li>' +
      '<li><strong>Your custom quote</strong><span>Made to measure for your windows and professionally installed.</span></li>' +
      '</ol>' +
      '<div class="contact">' +
      '<a class="btn btn-primary" href="tel:' + tel + '">Call ' + phone + '</a>' +
      '<a class="btn btn-outline" href="mailto:' + email + '">' + email + '</a>' +
      '</div>' +
      '<details class="summary"><summary>Your request</summary><dl class="review" data-summary></dl></details>' +
      '<p class="fineprint">Want to add something? Just reply to our email or text, or call us.</p>' +
      '</section>'
    );
  }

  function shellHtml(cfg) {
    var slats = new Array(SLAT_MAX + 1).join('<div class="slat"></div>');
    var steps = ['Details', 'Windows', 'Confirm', 'Done'].map(function (t, i) {
      return '<li data-dot="' + (i + 1) + '"><span class="dot"><span>' + (i + 1) + '</span>' + CHECK + '</span>' + t + '</li>';
    }).join('');
    return (
      '<link rel="stylesheet" href="' + BASE + 'lead-form.css">' +
      '<div class="bn" data-step="1" data-cover="zebra">' +
      sceneHtml() +
      '<div class="panel">' +
      '<p class="eyebrow">Free estimate</p>' +
      '<ol class="steps" aria-label="Progress">' + steps + '</ol>' +
      '<p class="sr-only" aria-live="polite" data-live></p>' +
      '<form novalidate>' +
      '<div class="viewport">' +
      stepOneHtml() + stepTwoHtml() + stepThreeHtml() + stepFourHtml(cfg.phone, cfg.email) +
      '<div class="slats" aria-hidden="true">' + slats + '</div>' +
      '</div></form></div></div>'
    );
  }

  /* ---------------------------------------------------------------- */
  /* Turnstile (rendered in light DOM, projected through a <slot>)     */
  /* ---------------------------------------------------------------- */

  var turnstileReady = null;

  /** Loads Cloudflare's Turnstile script once per page. */
  function loadTurnstile() {
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise(function (resolve, reject) {
      if (window.turnstile) return resolve(window.turnstile);
      window.__bnTurnstileLoaded = function () { resolve(window.turnstile); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__bnTurnstileLoaded';
      s.async = true;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return turnstileReady;
  }

  /* ---------------------------------------------------------------- */
  /* Component                                                         */
  /* ---------------------------------------------------------------- */

  function mount(host) {
    if (host.__bnMounted) return;
    host.__bnMounted = true;

    var cfg = {
      api: (host.getAttribute('data-api') || '').replace(/\/$/, ''),
      sitekey: host.getAttribute('data-sitekey') || '',
      phone: host.getAttribute('data-phone') || '613-699-1837',
      email: host.getAttribute('data-email') || 'info@blindsnisa.com',
    };

    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = shellHtml(cfg);

    var $ = function (sel) { return root.querySelector(sel); };
    var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
    var card = $('.bn');
    var form = $('form');
    var viewport = $('.viewport');
    var shade = $('.shade');
    var cord = $('.cord');
    var fabric = $('.fabric');
    var live = $('[data-live]');
    var slatWrap = $('.slats');
    var slats = $$('.slat');

    var state = { step: 1, busy: false, reviewing: false, token: '', widget: null };

    // Reveal once the shadow stylesheet has loaded, so there is no flash of unstyled form.
    var link = root.querySelector('link');
    var reveal = function () { card.classList.add('is-ready'); };
    link.addEventListener('load', reveal);
    setTimeout(reveal, 1500);

    if (cfg.sitekey) {
      var slot = document.createElement('div');
      slot.setAttribute('slot', 'turnstile');
      host.appendChild(slot);
      state.turnstileEl = slot;
    }

    /* ----- field helpers ----- */

    function input(name) { return form.elements.namedItem(name); }

    function setError(name, msg) {
      var el = root.getElementById('e-' + name);
      if (el) el.textContent = msg;
      var inp = input(name);
      if (inp && inp.setAttribute) {
        if (msg) inp.setAttribute('aria-invalid', 'true');
        else inp.removeAttribute('aria-invalid');
      }
      return !msg;
    }

    function validateField(name) {
      var inp = input(name);
      return setError(name, RULES[name](inp.value));
    }

    function shake(el) {
      if (!el || REDUCED) return;
      el.classList.remove('is-shaking');
      void el.offsetWidth;
      el.classList.add('is-shaking');
    }

    /** Validates the current step. Focuses and shakes the first problem. */
    function validateStep(step) {
      var firstBad = null;
      if (step === 1) {
        Object.keys(RULES).forEach(function (name) {
          if (!validateField(name) && !firstBad) firstBad = input(name);
        });
      } else if (step === 2) {
        var anyCover = $$('input[name="coverings"]').some(function (c) { return c.checked; });
        setError('coverings', anyCover ? '' : 'Pick at least one. “Not sure yet” is fine too.');
        if (!anyCover) firstBad = $('#c-zebra');
        var count = $('input[name="window_count"]:checked');
        setError('window_count', count ? '' : 'Roughly how many windows?');
        if (!count && !firstBad) firstBad = $('#n-1');
      } else if (step === 3) {
        var ok = input('consent').checked;
        setError('consent', ok ? '' : 'Please agree so we can contact you about your estimate.');
        $('[data-consent-box]').classList.toggle('is-invalid', !ok);
        if (!ok) firstBad = input('consent');
      }
      if (firstBad) {
        firstBad.focus({ preventScroll: false });
        shake(firstBad.closest('.field, .covers, .counts, .consent'));
        return false;
      }
      return true;
    }

    /* ----- live formatting & inline validation ----- */

    form.addEventListener('input', function (e) {
      var t = e.target;
      if (t.name === 'phone' && t.selectionStart === t.value.length) t.value = formatPhone(t.value);
      if (t.name === 'postal_code') t.value = t.value.toUpperCase();
      if (RULES[t.name] && t.getAttribute('aria-invalid') === 'true') validateField(t.name);
    });

    form.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t.name === 'phone' && t.value) t.value = formatPhone(t.value);
      if (t.name === 'postal_code') {
        var p = t.value.replace(/\s+/g, '').toUpperCase();
        if (p.length === 6) t.value = p.slice(0, 3) + ' ' + p.slice(3);
      }
      if (RULES[t.name] && t.value) validateField(t.name);
    });

    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'coverings') {
        // "Not sure yet" and specific products are mutually exclusive.
        if (t.checked && t.value === 'unsure') {
          $$('input[name="coverings"]').forEach(function (c) { if (c !== t) c.checked = false; });
        } else if (t.checked) {
          $('#c-unsure').checked = false;
        }
        if (t.checked) previewCover(t.value);
        setError('coverings', '');
      }
      if (t.name === 'window_count') setError('window_count', '');
      if (t.name === 'consent') {
        setError('consent', '');
        $('[data-consent-box]').classList.remove('is-invalid');
      }
    });

    /** Swaps the scene's fabric to the covering just picked. */
    function previewCover(id) {
      if (card.getAttribute('data-cover') === id) return;
      fabric.classList.remove('is-swapping');
      void fabric.offsetWidth;
      fabric.classList.add('is-swapping');
      setTimeout(function () { card.setAttribute('data-cover', id); }, REDUCED ? 0 : 160);
    }

    /* ----- step transition ----- */

    /** Shows enough slats to cover `height` px at roughly SLAT_PX each. */
    function sizeSlats(height) {
      var count = Math.max(8, Math.min(SLAT_MAX, Math.round(height / SLAT_PX)));
      slats.forEach(function (s, i) { s.style.display = i < count ? '' : 'none'; });
      return slats.slice(0, count);
    }

    /** Rotates the visible slats top-to-bottom; total stagger stays ~220ms. */
    function animateSlats(active, from, to, easing) {
      var step = 220 / active.length;
      return Promise.all(active.map(function (s, i) {
        var a = s.animate(
          [{ transform: 'rotateX(' + from + 'deg)' }, { transform: 'rotateX(' + to + 'deg)' }],
          { duration: 240, delay: i * step, easing: easing, fill: 'forwards' }
        );
        return a.finished;
      }));
    }

    function updateChrome(n) {
      card.setAttribute('data-step', String(n));
      shade.style.setProperty('--drop', DROP[n]);
      cord.style.setProperty('--drop', DROP[n]);
      $('.steps').style.setProperty('--progress', String((n - 1) / 3));
      $$('.steps li').forEach(function (li) {
        var d = Number(li.getAttribute('data-dot'));
        li.classList.toggle('is-active', d === n);
        li.classList.toggle('is-done', d < n || n === 4);
        if (d === n) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
      var titles = { 1: 'Your details', 2: 'Your windows', 3: 'Review and confirm', 4: 'Request sent' };
      live.textContent = 'Step ' + n + ' of 4: ' + titles[n];
    }

    function goTo(n) {
      if (state.busy || n === state.step) return Promise.resolve();
      state.busy = true;
      var fromEl = $('.step[data-step="' + state.step + '"]');
      var toEl = $('.step[data-step="' + n + '"]');

      function swap() {
        fromEl.hidden = true;
        fromEl.classList.remove('is-current');
        toEl.hidden = false;
        toEl.classList.add('is-current');
        if (n === 3) renderReview($('[data-review]'), true);
        if (n === 4) renderReview($('[data-summary]'), false);
        if (n === 3) ensureTurnstile();
        state.step = n;
        updateChrome(n);
      }

      function finish() {
        state.busy = false;
        var top = host.getBoundingClientRect().top;
        if (top < 0) host.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
        toEl.focus({ preventScroll: true });
      }

      if (REDUCED || !slats[0].animate) {
        swap();
        finish();
        return Promise.resolve();
      }

      viewport.style.height = fromEl.offsetHeight + 'px';
      slatWrap.classList.add('is-animating');
      var active = sizeSlats(fromEl.offsetHeight);
      return animateSlats(active, 90, 0, 'cubic-bezier(.5,0,.75,0)').then(function () {
        swap();
        viewport.style.height = toEl.offsetHeight + 'px';
        return new Promise(function (r) { setTimeout(r, 120); });
      }).then(function () {
        return animateSlats(active, 0, -90, 'cubic-bezier(.25,1,.5,1)');
      }).then(function () {
        slats.forEach(function (s) { s.getAnimations().forEach(function (a) { a.cancel(); }); });
        slatWrap.classList.remove('is-animating');
        viewport.style.height = '';
        finish();
      });
    }

    /* ----- review (step 3) ----- */

    /** Fills a <dl> with the visitor's answers; `editable` adds Edit buttons. */
    function renderReview(dl, editable) {
      var v = function (n) { return (input(n).value || '').trim(); };
      var covers = $$('input[name="coverings"]:checked').map(function (c) {
        return COVERS.filter(function (x) { return x.id === c.value; })[0].label;
      });
      var countEl = $('input[name="window_count"]:checked');
      var count = countEl ? COUNTS.filter(function (x) { return x.id === countEl.value; })[0] : null;
      var rows = [
        ['Name', v('first_name') + ' ' + v('last_name'), 1],
        ['Contact', formatPhone(v('phone')) + ' · ' + v('email'), 1],
        ['Address', [v('street') + (v('unit') ? ', Unit ' + v('unit') : ''), v('city'), input('province').value + ' ' + v('postal_code')].join(', '), 1],
        ['Window coverings', covers.join(', '), 2],
        ['Windows', count ? count.label.replace(/ /g, '') + ' (' + count.hint.toLowerCase() + ')' : '', 2],
      ];
      dl.textContent = '';
      rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'review-row';
        var dt = document.createElement('dt');
        dt.textContent = r[0];
        var dd = document.createElement('dd');
        dd.textContent = r[1];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'edit';
        btn.textContent = 'Edit';
        btn.setAttribute('aria-label', 'Edit ' + r[0].toLowerCase());
        btn.addEventListener('click', function () {
          state.reviewing = true;
          goTo(r[2]);
        });
        row.appendChild(dt);
        row.appendChild(dd);
        if (editable) row.appendChild(btn);
        dl.appendChild(row);
      });
    }

    function ensureTurnstile() {
      if (!cfg.sitekey || state.widget !== null) return;
      state.widget = 'pending';
      loadTurnstile().then(function (ts) {
        state.widget = ts.render(state.turnstileEl, {
          sitekey: cfg.sitekey,
          callback: function (t) { state.token = t; },
          'expired-callback': function () { state.token = ''; },
        });
      }).catch(function () {
        state.widget = null;
        showAlert('Our spam check didn’t load. Please refresh the page, or call us at ' + cfg.phone + '.');
      });
    }

    /* ----- submit ----- */

    function showAlert(msg) {
      var a = $('[data-alert]');
      a.textContent = msg;
      a.hidden = !msg;
    }

    /** An error whose message is safe and useful to show the visitor as-is. */
    function userError(msg) {
      var e = new Error(msg);
      e.bnUser = true;
      return e;
    }

    function payload() {
      var v = function (n) { return (input(n).value || '').trim(); };
      return {
        first_name: v('first_name'),
        last_name: v('last_name'),
        phone: formatPhone(v('phone')),
        email: v('email').toLowerCase(),
        street: v('street'),
        unit: v('unit'),
        city: v('city'),
        province: input('province').value,
        postal_code: v('postal_code').toUpperCase(),
        coverings: $$('input[name="coverings"]:checked').map(function (c) { return c.value; }),
        window_count: ($('input[name="window_count"]:checked') || {}).value || '',
        consent: input('consent').checked,
        source_url: location.href.slice(0, 500),
        turnstile_token: state.token,
        website: input('website').value,
      };
    }

    function submitLead() {
      if (!validateStep(3)) return;
      if (cfg.sitekey && !state.token) {
        showAlert('Please complete the quick verification above, then press Confirm.');
        return;
      }
      showAlert('');
      var btn = $('[data-confirm]');
      var label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Sending…';
      var body = payload();

      var request = cfg.api
        ? fetch(cfg.api + '/intake/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 201 }); }, 1100); });

      request.then(function (res) {
        if (res.ok) return onSuccess(body);
        if (res.status === 403 && window.turnstile && state.widget) {
          window.turnstile.reset(state.widget);
          state.token = '';
          throw new Error('Verification failed. Please try the check again and press Confirm.');
        }
        if (res.status === 400) throw new Error('Some details didn’t go through. Please press Edit to review them and try again.');
        if (res.status === 429) throw new Error('Too many attempts. Please wait a few minutes or call us at ' + cfg.phone + '.');
        throw new Error('We couldn’t send your request. Please call us at ' + cfg.phone + '.');
      }).catch(function (err) {
        showAlert(err && err.bnUser
          ? err.message
          : 'We couldn\u2019t reach our server. Please check your connection or call us at ' + cfg.phone + '.');
      }).then(function () {
        btn.disabled = false;
        btn.innerHTML = label;
      });
    }

    function onSuccess(body) {
      $('[data-first]').textContent = body.first_name;
      $('[data-phone-out]').textContent = body.phone;
      $$('.steps li').forEach(function (li) { li.classList.add('is-done'); });
      host.dispatchEvent(new CustomEvent('bn:lead-submitted', { bubbles: true, detail: { coverings: body.coverings, window_count: body.window_count } }));
      if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'free_estimate' });
      return goTo(4);
    }

    /* ----- navigation wiring ----- */

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.busy) return;
      if (state.step === 3) return submitLead();
      if (state.step === 4) return;
      if (!validateStep(state.step)) return;
      var next = state.reviewing ? 3 : state.step + 1;
      if (next === 3) state.reviewing = false;
      goTo(next);
    });

    root.addEventListener('click', function (e) {
      var back = e.target.closest && e.target.closest('[data-back]');
      if (back && state.step > 1 && state.step < 4) {
        state.reviewing = false;
        goTo(state.step - 1);
      }
    });

    $('.step[data-step="1"]').classList.add('is-current');
    updateChrome(1);
    live.textContent = '';
  }

  function init() {
    var hosts = document.querySelectorAll('#bn-lead-form, [data-bn-lead-form]');
    Array.prototype.forEach.call(hosts, mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
