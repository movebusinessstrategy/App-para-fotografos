(function initFocalPointChatIdentity(root) {
  'use strict';

  const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

  function matchCanonicalJid(value, pattern) {
    const match = String(value || '').match(pattern);
    return match?.[1]?.toLowerCase() || '';
  }

  function canonicalChatJid(value) {
    const unsupported = matchCanonicalJid(
      value,
      /(?:^|[_:])([\d-]{5,30}@g\.us|(?:status|\d{5,20})@broadcast)(?:[_:]|$)/i,
    );
    if (unsupported) return unsupported;
    return matchCanonicalJid(
      value,
      /(?:^|[_:])(\d{5,20}@(c\.us|s\.whatsapp\.net|lid))(?:[_:]|$)/i,
    );
  }

  function phoneFromCanonicalJid(value) {
    const jid = canonicalChatJid(value);
    const match = jid.match(/^(\d{8,15})@(c\.us|s\.whatsapp\.net)$/i);
    return match?.[1] || '';
  }

  function isUnsupportedChatJid(value) {
    const jid = canonicalChatJid(value);
    return /@(g\.us|broadcast)$/i.test(jid);
  }

  function preferredCanonicalChatJid(values) {
    const jids = Array.from(values || [], canonicalChatJid).filter(Boolean);
    return jids.find(isUnsupportedChatJid) || jids[0] || '';
  }

  function rejectedPhoneSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value.map(onlyDigits).filter(Boolean));
    return new Set();
  }

  function resolvePhone({ rawPhone, fallbackPhone, anchorPhone, rejectedPhones }) {
    const raw = onlyDigits(rawPhone);
    const fallback = onlyDigits(fallbackPhone);
    const anchored = onlyDigits(anchorPhone);
    const rejected = rejectedPhoneSet(rejectedPhones);
    const rawRejected = Boolean(raw && anchored && rejected.has(raw));

    if (rawRejected) return { phone: anchored, source: 'anchor', rawRejected: true };
    if (raw) return { phone: raw, source: 'dom', rawRejected: false };
    if (anchored) return { phone: anchored, source: 'anchor', rawRejected: false };
    if (fallback) return { phone: fallback, source: 'state', rawRejected: false };
    return { phone: '', source: 'none', rawRejected: false };
  }

  function mutationGuardDecision({
    expectedOpaqueId,
    currentOpaqueId,
    expectedSelectionToken,
    currentSelectionToken,
    currentNamePresent,
    namesCompatible,
    currentPhoneTrusted,
    phoneMatches,
    currentChatUnsupported,
  }) {
    if (currentChatUnsupported) return 'deny';
    if (expectedOpaqueId && currentOpaqueId && expectedOpaqueId !== currentOpaqueId) return 'deny';
    if (currentNamePresent && !namesCompatible) return 'deny';
    if (currentPhoneTrusted) return phoneMatches ? 'allow' : 'deny';
    return 'confirm';
  }

  root.FocalPointChatIdentity = Object.freeze({
    canonicalChatJid,
    phoneFromCanonicalJid,
    isUnsupportedChatJid,
    preferredCanonicalChatJid,
    resolvePhone,
    mutationGuardDecision,
  });
})(globalThis);
