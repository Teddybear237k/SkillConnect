// ─── Campay Mobile Money Integration ─────────────────────────────────────────
// Supports MTN MoMo and Orange Money (Cameroon)
// Sandbox: demo.campay.net  |  Production: www.campay.net
require('dotenv').config();

const BASE = (process.env.CAMPAY_ENV === 'production')
  ? 'https://www.campay.net/api'
  : 'https://demo.campay.net/api';

// Token cache (valid ~60 min, refresh 5 min early)
let _cachedToken = null;
let _tokenExpiry  = 0;

async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const res = await fetch(`${BASE}/token/`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      username: process.env.CAMPAY_USERNAME,
      password: process.env.CAMPAY_PASSWORD,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Campay auth failed (${res.status}): ${body}`);
  }

  const data   = await res.json();
  _cachedToken = data.token;
  _tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
  return _cachedToken;
}

/**
 * Initiate a collection (customer pays — USSD prompt on their phone).
 * @returns { reference, ussd_code, operator }
 */
async function collect({ amount, phone, description, externalRef }) {
  const token = await getToken();
  const res = await fetch(`${BASE}/collect/`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${token}`,
    },
    body: JSON.stringify({
      amount:             String(amount),
      currency:           'XAF',
      from:               normalizePhone(phone),
      description:        description || 'Paiement SkillConnect',
      external_reference: externalRef || `sc-${Date.now()}`,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.detail || 'Campay collect failed');
  return data; // { reference, ussd_code, operator }
}

/**
 * Disbursement — send money to a MoMo number.
 * @returns { reference, operator, status }
 */
async function transfer({ amount, phone, description, externalRef }) {
  const token = await getToken();
  const res = await fetch(`${BASE}/transfer/`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${token}`,
    },
    body: JSON.stringify({
      amount:             String(amount),
      currency:           'XAF',
      to:                 normalizePhone(phone),
      description:        description || 'Paiement SkillConnect',
      external_reference: externalRef || `sc-${Date.now()}`,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.detail || 'Campay transfer failed');
  return data;
}

/**
 * Check transaction status by Campay reference.
 * @returns { reference, status: 'SUCCESSFUL'|'FAILED'|'PENDING', amount, operator, … }
 */
async function checkTransaction(reference) {
  const token = await getToken();
  const res = await fetch(`${BASE}/transaction/${reference}/`, {
    headers: { 'Authorization': `Token ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

/** Ensure phone is in 6XXXXXXXX or +2376XXXXXXXX format */
function normalizePhone(phone) {
  if (!phone) return phone;
  const clean = String(phone).replace(/\s+/g, '').replace(/^0+/, '');
  if (clean.startsWith('+237')) return clean.slice(4);
  if (clean.startsWith('237') && clean.length === 12) return clean.slice(3);
  return clean; // pass as-is for 6XXXXXXXX
}

module.exports = { collect, transfer, checkTransaction, isConfigured };

function isConfigured() {
  return !!(
    process.env.CAMPAY_USERNAME &&
    process.env.CAMPAY_USERNAME !== 'VOTRE_USERNAME_CAMPAY' &&
    process.env.CAMPAY_PASSWORD &&
    process.env.CAMPAY_PASSWORD !== 'VOTRE_MOT_DE_PASSE_CAMPAY'
  );
}
