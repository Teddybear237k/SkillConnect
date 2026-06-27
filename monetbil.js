// ─── Monetbil Mobile Money Integration ────────────────────────────────────────
// MTN MoMo & Orange Money — Cameroun
require('dotenv').config();

const API_BASE = 'https://api.monetbil.com/payment/v1';

function isConfigured() {
  return !!(
    process.env.MONETBIL_SERVICE_KEY &&
    process.env.MONETBIL_SERVICE_KEY !== 'ta_service_key_ici'
  );
}

/**
 * Initier un paiement — retourne { transaction_id, payment_url }
 */
async function initPayment({ amount, phone, firstName, lastName, email, itemRef, notifyUrl, returnUrl }) {
  const params = new URLSearchParams({
    service:    process.env.MONETBIL_SERVICE_KEY,
    amount:     String(parseInt(amount)),
    phonenumber: normalizePhone(phone),
    item_ref:   itemRef || `sc-${Date.now()}`,
    notify_url: notifyUrl || '',
    return_url: returnUrl || '',
  });
  if (firstName) params.set('first_name', firstName);
  if (lastName)  params.set('last_name',  lastName);
  if (email)     params.set('email',       email);

  const res = await fetch(`${API_BASE}/placePayment`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.message || data.error || 'Monetbil initPayment failed');
  }
  return {
    transaction_id: data.transaction_id || data.payToken,
    payment_url:    data.payment_url    || data.url,
    raw: data,
  };
}

/**
 * Vérifier le statut d'un paiement
 * status retourné : 1 = succès, 2 = en attente, 3 = échec
 */
async function checkPayment(transactionId) {
  const params = new URLSearchParams({
    service:  process.env.MONETBIL_SERVICE_KEY,
    payToken: transactionId,
  });
  const res = await fetch(`${API_BASE}/checkPayment`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  if (!res.ok) return null;
  return await res.json();
}

/**
 * Vérifier la signature du webhook Monetbil
 * sign = sha256(service_key + transaction_id + status + service_secret)
 */
function verifyWebhook(body) {
  if (!process.env.MONETBIL_SERVICE_SECRET) return true; // pas de secret = pas de vérif
  const crypto = require('crypto');
  const { transaction_id, status, sign } = body;
  if (!sign) return false;
  const expected = crypto
    .createHash('sha256')
    .update(process.env.MONETBIL_SERVICE_KEY + transaction_id + status + process.env.MONETBIL_SERVICE_SECRET)
    .digest('hex');
  return sign === expected;
}

/** Normalise le numéro de téléphone en format camerounais (6XXXXXXXX) */
function normalizePhone(phone) {
  if (!phone) return phone;
  const clean = String(phone).replace(/\s+/g, '').replace(/^\+?237/, '');
  return clean.replace(/^0+/, '');
}

module.exports = { initPayment, checkPayment, verifyWebhook, isConfigured };
