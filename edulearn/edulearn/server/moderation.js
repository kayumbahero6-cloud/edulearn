'use strict';
// Lightweight, explainable text moderation for forums and chat. It is a safety net, not a replacement for human
// moderators: anything serious is queued as a report with a priority so a person looks at it quickly.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const BUILTIN = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy', 'slut', 'whore', 'merde', 'putain', 'connard', 'salope'];
let extra = [];
try { extra = fs.readFileSync(path.join(cfg.DATA_DIR, 'blocklist.txt'), 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean); } catch { /* optional file: add local-language terms here */ }
const WORDS = [...new Set([...BUILTIN, ...extra])];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[013457@$]/g, c => LEET[c]);
const squash = s => s.replace(/(.)\1{2,}/g, '$1$1');

const RX = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /(?:\+?\d[\s().-]?){9,}/g,
  url: /\b(?:https?:\/\/|www\.)\S+/gi,
  handle: /\b(?:whatsapp|snapchat|snap|instagram|insta|telegram|tiktok|facebook|signal)\b/i,
  threat: /\b(?:i(?:'| a)?m going to|i will|gonna|i'll)\s+(?:kill|hurt|beat|stab|shoot)\s+(?:you|him|her|them|u)\b|\bkill\s+(?:yourself|urself)\b/i,
  welfare: /\b(?:kill myself|end my life|want to die|wanna die|suicide|suicidal|hurt myself|harm myself|self[- ]harm|no reason to live)\b/i,
  abuse: /\b(?:someone (?:is )?(?:hurting|touching) me|(?:he|she|they) (?:hits?|beats?|touches?) me)\b/i,
};

function check(text, { minor = false, allowLinks = false } = {}) {
  const original = String(text || '').trim();
  const flags = [];
  let out = original;
  let blocked = false;
  let severity = 0;
  let welfare = false;
  const reasons = [];

  if (!original) return { ok: false, blocked: true, text: '', flags: ['empty'], reasons: ['Message is empty'], severity: 0, welfare: false };
  if (original.length > 2000) { blocked = true; reasons.push('Message is too long'); }

  const f = squash(fold(original));
  for (const w of WORDS) {
    if (new RegExp(`(^|[^a-z])${w}(s|ed|ing)?($|[^a-z])`).test(f)) { flags.push('profanity'); blocked = true; reasons.push('Please keep the language respectful'); severity = Math.max(severity, 1); break; }
  }
  if (RX.threat.test(original)) { flags.push('threat'); blocked = true; reasons.push('Threats are not allowed'); severity = 3; }
  if (RX.welfare.test(original)) { flags.push('welfare'); welfare = true; severity = Math.max(severity, 3); }
  if (RX.abuse.test(original)) { flags.push('welfare'); welfare = true; severity = Math.max(severity, 3); }

  const hasPII = () => { RX.email.lastIndex = RX.phone.lastIndex = RX.url.lastIndex = 0; return RX.email.test(out) || RX.phone.test(out) || RX.url.test(out) || RX.handle.test(out); };
  if (minor) {
    if (hasPII()) {
      RX.email.lastIndex = RX.phone.lastIndex = RX.url.lastIndex = 0;
      flags.push('personal-info');
      blocked = true; reasons.push('For your safety, do not share phone numbers, emails, links or social-media handles');
      severity = Math.max(severity, 1);
    }
  } else if (!allowLinks) {
    RX.url.lastIndex = 0;
    out = out.replace(RX.url, '[link removed]');
  }
  if (original.length > 12 && original === original.toUpperCase() && /[A-Z]{12}/.test(original)) { flags.push('shouting'); out = out.charAt(0) + out.slice(1).toLowerCase(); }

  return { ok: !blocked, blocked, text: out, flags: [...new Set(flags)], reasons: [...new Set(reasons)], severity, welfare, welfareNote: welfare ? cfg.HELPLINE_TEXT : '' };
}

module.exports = { check };
