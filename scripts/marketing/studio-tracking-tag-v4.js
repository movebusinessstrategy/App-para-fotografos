(function () {
  'use strict';

  var BRIDGE_URL = 'https://estudio-gi-pitori-marketing-bridge.borela-demo-app.workers.dev/v1/whatsapp-click';
  var TURNSTILE_SITE_KEY = '0x4AAAAAAEfya0uwJW27hQsS';
  var WHATSAPP_PHONE = '5543996817638';
  var WHATSAPP_MESSAGE = 'Olá Gi, conheci o Estúdio pela página de ensaio gestante e gostaria de mais informações!';
  var CONSENT_KEY = 'pitori_google_consent_v2';
  var BRIDGE_KEY = 'pitori_marketing_bridge_v1';
  var JOURNEY_KEY = 'pitori_marketing_journey_v1';
  var PENDING_CLICK_KEY = 'pitori_marketing_pending_click_v1';
  var ALLOWED_HOST = /^(?:www\.)?gipitorifotografias\.com\.br$/i;
  var EXCLUDED_PATH = /^\/(?:admin|login|preview|proof|cliente|clientes|selecao)(?:\/|$)/i;
  var WHATSAPP_LINK = /^(?:(?:https?:)?\/\/(?:www\.)?(?:wa\.me|wa\.link|w\.app)(?:\/|$)|(?:https?:)?\/\/(?:(?:api|web|www)\.)?whatsapp\.com\/send(?:\/|\?|$)|whatsapp:\/\/send(?:\/|\?|$))/i;
  var turnstilePromise = null;
  var activeWhatsappElement = null;
  var activeWhatsappAt = 0;

  function noop() {}

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      return (char === 'x' ? random : (random & 3) | 8).toString(16);
    });
  }

  function safeText(value, limit) {
    if (typeof value !== 'string') return '';
    var clean = value.trim().slice(0, limit).replace(/[\u0000-\u001f\u007f]/g, '');
    return /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(clean) ? '' : clean;
  }

  function queryValue(name, limit) {
    try { return safeText(new URLSearchParams(location.search).get(name) || '', limit); }
    catch (_error) { return ''; }
  }

  function cookieValue(name) {
    var prefix = name + '=';
    var cookies = document.cookie ? document.cookie.split(';') : [];
    for (var index = 0; index < cookies.length; index += 1) {
      var cookie = cookies[index].trim();
      if (cookie.indexOf(prefix) === 0) return decodeURIComponent(cookie.slice(prefix.length));
    }
    return '';
  }

  function consentState() {
    try {
      var stored = JSON.parse(localStorage.getItem(CONSENT_KEY));
      if (stored && typeof stored.analytics === 'boolean' && typeof stored.marketing === 'boolean') return stored;
    } catch (_error) {}
    return { analytics: false, marketing: false };
  }

  function journeyId() {
    try {
      var stored = sessionStorage.getItem(JOURNEY_KEY) || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
        return stored.toLowerCase();
      }
      var created = uuid();
      sessionStorage.setItem(JOURNEY_KEY, created);
      return created;
    } catch (_error) { return uuid(); }
  }

  function addValue(target, key, value) {
    if (value !== '') target[key] = value;
  }

  function addAttribution(event, state) {
    var utms = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    for (var index = 0; index < utms.length; index += 1) addValue(event, utms[index], queryValue(utms[index], 300));
    addValue(event, 'campaign_id', queryValue('campaign_id', 500));
    addValue(event, 'adset_id', queryValue('adset_id', 500));
    addValue(event, 'ad_id', queryValue('ad_id', 500));
    if (!state.marketing) return;
    ['gclid', 'gbraid', 'wbraid', 'fbclid'].forEach(function (field) {
      addValue(event, field, queryValue(field, 500));
    });
    addValue(event, 'fbc', safeText(cookieValue('_fbc'), 500));
    addValue(event, 'fbp', safeText(cookieValue('_fbp'), 500));
  }

  function addAnalyticsIds(event, state) {
    if (!state.analytics) return;
    var gaParts = cookieValue('_ga').split('.');
    addValue(event, 'ga_client_id', gaParts.length >= 4 ? safeText(gaParts.slice(-2).join('.'), 200) : '');
    var cookies = document.cookie ? document.cookie.split(';') : [];
    for (var index = 0; index < cookies.length; index += 1) {
      var cookie = cookies[index].trim();
      if (cookie.indexOf('_ga_') !== 0) continue;
      var match = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).match(/(?:^|\.)s?(\d{8,})(?:\.|$)/);
      if (match) { addValue(event, 'ga_session_id', match[1]); return; }
    }
  }

  function siteEvent(eventName, occurredAt, pagePath, marker, detail) {
    var state = consentState();
    var analytics = state.analytics ? 'granted' : 'denied';
    var marketing = state.marketing ? 'granted' : 'denied';
    var path = pagePath || location.pathname;
    var event = {
      event_name: eventName,
      event_id: uuid(),
      journey_id: journeyId(),
      occurred_at: occurredAt || new Date().toISOString(),
      consent_status: marketing,
      analytics_storage: analytics,
      ad_storage: marketing,
      ad_user_data: marketing,
      ad_personalization: marketing,
      source_url: location.origin + path,
      page_path: path,
      cta_id: marker,
      cta_location: safeText(detail || '', 120)
    };
    addAttribution(event, state);
    addAnalyticsIds(event, state);
    return event;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstilePromise) return turnstilePromise;
    turnstilePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var settled = false;
      var timeout = window.setTimeout(function () { finish(new Error('turnstile_timeout')); }, 8000);
      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (error) { turnstilePromise = null; reject(error); }
        else resolve(window.turnstile);
      }
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () { finish(window.turnstile ? null : new Error('turnstile_unavailable')); };
      script.onerror = function () { finish(new Error('turnstile_load_failed')); };
      document.head.appendChild(script);
    });
    return turnstilePromise;
  }

  function turnstileToken(action) {
    return loadTurnstile().then(function (turnstile) {
      return new Promise(function (resolve, reject) {
        var container = document.createElement('div');
        var settled = false;
        var widgetId;
        var timeout;
        container.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
        document.body.appendChild(container);
        function finish(error, token) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          try { if (widgetId !== undefined) turnstile.remove(widgetId); } catch (_error) {}
          if (container.parentNode) container.parentNode.removeChild(container);
          if (error) reject(error); else resolve(token);
        }
        widgetId = turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          action: action,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: function (token) { finish(null, token); },
          'error-callback': function () { finish(new Error('turnstile_error')); },
          'expired-callback': function () { finish(new Error('turnstile_expired')); },
          'timeout-callback': function () { finish(new Error('turnstile_challenge_timeout')); }
        });
        timeout = window.setTimeout(function () { finish(new Error('turnstile_timeout')); }, 6000);
        turnstile.execute(widgetId);
      });
    });
  }

  function sendEvent(event, action) {
    return turnstileToken(action).then(function (token) {
      event.turnstile_token = token;
      return fetch(BRIDGE_URL, {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event)
      });
    }).then(function (response) {
      return response.text().then(function (text) {
        var body;
        try { body = text ? JSON.parse(text) : {}; } catch (_error) { throw new Error('bridge_invalid_json'); }
        if (!response.ok) throw new Error('bridge_http_' + response.status + '_' + safeText(body.error || '', 40));
        return body;
      });
    });
  }

  function status(name, error) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'marketing_bridge_status', bridge_status: name,
      bridge_error: error ? safeText(error.message || String(error), 80) : ''
    });
  }

  function allowedPage() {
    return ALLOWED_HOST.test(location.hostname) && !EXCLUDED_PATH.test(location.pathname);
  }

  function sendPageView() {
    if (!allowedPage() || !consentState().analytics) return;
    sendEvent(siteEvent('PageView', null, null, '__page_view__', 'page'), 'page_view')
      .then(function () { status('page_view_success'); })
      .catch(function (error) { status('page_view_fallback', error); });
  }

  function takePendingClick() {
    try {
      var raw = sessionStorage.getItem(PENDING_CLICK_KEY);
      sessionStorage.removeItem(PENDING_CLICK_KEY);
      var value = raw ? JSON.parse(raw) : null;
      return value && value.event_id && value.occurred_at && value.page_path ? value : null;
    } catch (_error) { return null; }
  }

  function drainPendingClick() {
    if (!consentState().analytics) return;
    var pending = takePendingClick();
    if (!pending) return;
    var event = siteEvent('SiteClick', pending.occurred_at, pending.page_path, '__site_click__', pending.label);
    event.event_id = pending.event_id;
    sendEvent(event, 'site_click')
      .then(function () { status('site_click_success'); })
      .catch(function (error) { status('site_click_fallback', error); });
  }

  function clickLabel(element) {
    var text = safeText(element.innerText || element.textContent || element.getAttribute('aria-label') || '', 70);
    var href = element.getAttribute('href') || '';
    try {
      var url = href ? new URL(href, location.href) : null;
      var destination = url && url.origin === location.origin ? url.pathname : '';
      return safeText([text, destination].filter(Boolean).join(' → '), 120) || 'Elemento interativo';
    } catch (_error) { return text || 'Elemento interativo'; }
  }

  function rememberSiteClick(domEvent) {
    if (!allowedPage() || !consentState().analytics) return;
    var element = domEvent.target && typeof domEvent.target.closest === 'function'
      ? domEvent.target.closest('a[href],button,[role="button"]') : null;
    if (!element || WHATSAPP_LINK.test(element.getAttribute('href') || '')) return;
    try {
      sessionStorage.setItem(PENDING_CLICK_KEY, JSON.stringify({
        event_id: uuid(), occurred_at: new Date().toISOString(),
        page_path: location.pathname, label: clickLabel(element)
      }));
    } catch (_error) { return; }
    window.setTimeout(function () { if (document.visibilityState === 'visible') drainPendingClick(); }, 200);
  }

  function whatsappLocation(element) {
    var text = '';
    var current = element;
    for (var depth = 0; current && depth < 5; depth += 1) {
      text += ' ' + [current.id || '', current.className || '', current.getAttribute && current.getAttribute('data-section') || ''].join(' ');
      current = current.parentElement;
    }
    text = text.toLowerCase();
    if (/header|navbar|navigation|menu/.test(text)) return 'header';
    if (/floating|float|sticky|whatsapp-fixed|whatsapp_button/.test(text)) return 'floating';
    if (/hero|banner|cover|first-section/.test(text)) return 'hero';
    if (/package|pacote|price|preco|plano/.test(text)) return 'package';
    if (/gallery|galeria|portfolio/.test(text)) return 'gallery';
    if (/footer/.test(text)) return 'footer';
    if (/contact|contato|orcamento/.test(text)) return 'contact';
    return 'unknown';
  }

  function whatsappUrl(reference) {
    var message = reference ? WHATSAPP_MESSAGE + '\n\nREF:' + reference : WHATSAPP_MESSAGE;
    return 'https://api.whatsapp.com/send?phone=' + WHATSAPP_PHONE + '&text=' + encodeURIComponent(message);
  }

  function analyticsWhatsapp(eventId, locationLabel) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'whatsapp_click', event_id: eventId, destination: 'whatsapp',
        cta_location: locationLabel, page_path_clean: location.pathname,
        eventCallback: finish, eventTimeout: 1200
      });
      window.setTimeout(finish, 1250);
    });
  }

  function handleWhatsapp(domEvent, element) {
    domEvent.preventDefault();
    var eventId = uuid();
    var locationLabel = whatsappLocation(element);
    var navigated = false;
    function navigate(url) { if (!navigated) { navigated = true; window.location.assign(url); } }
    var event = siteEvent('WhatsAppClick', null, null, safeText(element.id || 'gestante_whatsapp', 120), locationLabel);
    event.event_id = eventId;
    var bridge = sendEvent(event, 'whatsapp_click').then(function (body) {
      var reference = body && /^gp_[a-z0-9_-]{12}$/i.test(body.bridge_ref || '') ? body.bridge_ref.toLowerCase() : '';
      if (reference) {
        try { sessionStorage.setItem(BRIDGE_KEY, JSON.stringify({ bridge_ref: reference, event_id: eventId })); } catch (_error) {}
      }
      status(reference ? 'success' : 'invalid_response');
      return reference;
    }).catch(function (error) { status('fallback', error); return ''; });
    Promise.all([bridge, analyticsWhatsapp(eventId, locationLabel)]).then(function (values) { navigate(whatsappUrl(values[0])); });
    window.setTimeout(function () { navigate(whatsappUrl('')); }, 7000);
  }

  function interceptWhatsapp(domEvent) {
    if (!allowedPage()) return;
    var element = domEvent.target && typeof domEvent.target.closest === 'function' ? domEvent.target.closest('a[href]') : null;
    if (!element || !WHATSAPP_LINK.test(element.getAttribute('href') || '')) return;
    var now = Date.now();
    if (element === activeWhatsappElement && now - activeWhatsappAt < 1500) return;
    activeWhatsappElement = element;
    activeWhatsappAt = now;
    handleWhatsapp(domEvent, element);
  }

  function consentUpdatePayload() {
    var stored;
    try { stored = JSON.parse(sessionStorage.getItem(BRIDGE_KEY)); } catch (_error) { return null; }
    if (!stored || !/^gp_[a-z0-9_-]{12}$/i.test(stored.bridge_ref || '')) return null;
    var state = consentState();
    var analytics = state.analytics ? 'granted' : 'denied';
    var marketing = state.marketing ? 'granted' : 'denied';
    return {
      event_name: 'ConsentUpdate', event_id: uuid(), occurred_at: new Date().toISOString(),
      bridge_reference: stored.bridge_ref.toLowerCase(), analytics_storage: analytics,
      ad_storage: marketing, ad_user_data: marketing, ad_personalization: marketing
    };
  }

  if (window.__pitoriWhatsAppTrackerV4) return;
  window.__pitoriWhatsAppTrackerV4 = true;
  window.__pitoriWhatsAppTrackerV3 = true;
  window.__pitoriWhatsAppTrackerV2 = true;
  window.__pitoriMarketingBridge = {
    sendConsentUpdate: function () {
      var payload = consentUpdatePayload();
      return payload ? sendEvent(payload, 'consent_update').then(function () { return true; }).catch(function () { return false; }) : Promise.resolve(false);
    }
  };
  document.addEventListener('click', interceptWhatsapp, true);
  document.addEventListener('click', rememberSiteClick, true);
  drainPendingClick();
  sendPageView();
  loadTurnstile().catch(noop);
}());
