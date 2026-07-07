const express = require('express');
const router  = express.Router();
const db      = require('./db');

// Freeze a shipment's terminal state so it drops out of the live-poll set (#160).
// Idempotent: only writes the first time a tracker resolves to delivered.
const freezeDelivered = db.prepare(
  `UPDATE shipments SET tracking_status = 'delivered', delivered_at = ?
   WHERE tracking_id = ? AND tracking_status IS NOT 'delivered'`
);

const PROVIDER = (process.env.SHIPPING_PROVIDER || 'SHIPPO').toUpperCase();

// ── CARRIER + SERVICE NAME MAPS ───────────────────────────────────────────────
const CARRIER_NAMES = { UPSDAP: 'UPS', UPS: 'UPS', USPS: 'USPS',
                        FedEx: 'FedEx', FedExDefault: 'FedEx',
                        DHLExpress: 'DHL Express', DHL: 'DHL' };
function carrierName(raw) { return CARRIER_NAMES[raw] || raw || ''; }

const SERVICE_NAMES = {
  // UPS
  UPSGroundsaverGreaterThan1lb: 'Ground Saver (>1lb)',
  Ground:             'Ground',
  '3DaySelect':       '3 Day Select',
  '2ndDayAir':        '2nd Day Air',
  '2ndDayAirAM':      '2nd Day Air AM',
  NextDayAir:         'Next Day Air',
  NextDayAirSaver:    'Next Day Air Saver',
  NextDayAirEarlyAM:  'Next Day Air Early AM',
  // USPS
  GroundAdvantage:    'Ground Advantage',
  First:              'First Class',
  Priority:           'Priority Mail',
  Express:            'Express Mail',
  ParcelSelect:       'Parcel Select',
  LibraryMail:        'Library Mail',
  MediaMail:          'Media Mail',
  // FedEx
  SMART_POST:         'Smart Post',
  FEDEX_GROUND:       'Ground',
  FEDEX_EXPRESS_SAVER:'Express Saver',
  FEDEX_2_DAY:        '2 Day',
  FEDEX_2_DAY_AM:     '2 Day AM',
  STANDARD_OVERNIGHT: 'Standard Overnight',
  PRIORITY_OVERNIGHT: 'Priority Overnight',
  FIRST_OVERNIGHT:    'First Overnight',
};
function serviceName(raw) { return SERVICE_NAMES[raw] || raw || ''; }

// ── FROM ADDRESS ──────────────────────────────────────────────────────────────

function fromAddress() {
  return {
    name:    process.env.FROM_NAME,
    street1: process.env.FROM_STREET1,
    city:    process.env.FROM_CITY,
    state:   process.env.FROM_STATE,
    zip:     process.env.FROM_ZIP,
    country: process.env.FROM_COUNTRY || 'US',
    phone:   process.env.FROM_PHONE,
  };
}

// ── SHIPPO ────────────────────────────────────────────────────────────────────

const SHIPPO_API         = 'https://api.goshippo.com';
const SHIPPO_API_VERSION = '2018-02-08';

function shippoToken() {
  const test  = process.env.SHIPPO_TEST_MODE === 'true';
  const token = test ? process.env.SHIPPO_TEST_TOKEN : process.env.SHIPPO_LIVE_TOKEN;
  if (!token) throw new Error(`Shippo ${test ? 'test' : 'live'} token not configured`);
  return token;
}

async function shippoPost(token, path, body) {
  const res  = await fetch(`${SHIPPO_API}/${path}`, {
    method:  'POST',
    headers: {
      'Authorization':    `ShippoToken ${token}`,
      'Content-Type':     'application/json',
      'SHIPPO-API-VERSION': SHIPPO_API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

async function shippoRates(toAddress, parcel) {
  const token = shippoToken();
  const { status, data } = await shippoPost(token, 'shipments/', {
    address_from: fromAddress(),
    address_to:   toAddress,
    parcels: [{
      weight:        String(parcel.weight),
      mass_unit:     'lb',
      length:        String(parcel.length),
      width:         String(parcel.width),
      height:        String(parcel.height),
      distance_unit: 'in',
    }],
    async: false,
  });
  if (status !== 201) throw Object.assign(new Error('Shippo error'), { status, data });
  return (data.rates || [])
    .filter(r => r.object_id)
    .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))
    .map(r => ({
      object_id: r.object_id,
      carrier:   r.provider,
      service:   r.servicelevel?.name || r.servicelevel_token,
      price:     parseFloat(r.amount),
      currency:  r.currency,
      days:      r.estimated_days,
    }));
}

async function shippoPurchase(rateObjectId) {
  const token = shippoToken();
  const { status, data } = await shippoPost(token, 'transactions/', {
    rate:            rateObjectId,
    label_file_type: 'PDF',
    async:           false,
  });
  if (status !== 201) throw Object.assign(new Error('Shippo error'), { status, data });
  if (data.status !== 'SUCCESS') throw Object.assign(new Error('Label creation failed'), { messages: data.messages });
  return {
    trackingNumber: data.tracking_number,
    labelUrl:       data.label_url,
    trackingUrl:    data.tracking_url_provider,
  };
}

// ── EASYPOST ──────────────────────────────────────────────────────────────────

const EASYPOST_API = 'https://api.easypost.com/v2';

function easypostToken() {
  const test  = process.env.EASYPOST_TEST_MODE === 'true';
  const token = test ? process.env.EASYPOST_TEST_TOKEN : process.env.EASYPOST_LIVE_TOKEN;
  if (!token) throw new Error(`EasyPost ${test ? 'test' : 'live'} token not configured`);
  return token;
}

function easypostHeaders(token) {
  return {
    'Authorization': 'Basic ' + Buffer.from(token + ':').toString('base64'),
    'Content-Type':  'application/json',
  };
}

async function easypostRates(toAddress, parcel) {
  const token = easypostToken();
  const res   = await fetch(`${EASYPOST_API}/shipments`, {
    method:  'POST',
    headers: easypostHeaders(token),
    body: JSON.stringify({
      shipment: {
        from_address: fromAddress(),
        to_address:   toAddress,
        parcel: {
          weight: parcel.weight * 16,   // EasyPost expects oz
          length: parcel.length,
          width:  parcel.width,
          height: parcel.height,
        },
        options: {
          label_format:             'ZPL',
          special_rates_eligibility: 'USPS.MEDIAMAIL',
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error('EasyPost error'), { status: res.status, data });
  const rates = (data.rates || [])
    .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))
    .map(r => ({
      object_id: `${r.shipment_id}|${r.id}`,  // encoded for purchase
      carrier:   carrierName(r.carrier),
      service:   serviceName(r.service),
      price:     parseFloat(r.rate),
      currency:  r.currency,
      days:      r.delivery_days,
    }));
  const warnings = (data.messages || [])
    .filter(m => m.type === 'rate_error' && CARRIER_NAMES[m.carrier])
    .map(m => `${carrierName(m.carrier)}: ${m.message}`);
  return { rates, warnings };
}

async function easypostPurchase(rateObjectId, insurance = null) {
  const [shipmentId, rateId] = rateObjectId.split('|');
  if (!shipmentId || !rateId) throw new Error('Invalid EasyPost rate ID');
  const token   = easypostToken();
  const payload = { rate: { id: rateId } };
  if (insurance != null) payload.insurance = String(parseFloat(insurance) || 100);
  const res   = await fetch(`${EASYPOST_API}/shipments/${shipmentId}/buy`, {
    method:  'POST',
    headers: easypostHeaders(token),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error('EasyPost error'), { status: res.status, data });
  const totalCost = (data.fees || []).reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);
  return {
    trackingNumber: data.tracking_code,
    labelUrl:       data.postage_label?.label_zpl_url || data.postage_label?.label_url,
    labelZplUrl:    data.postage_label?.label_zpl_url || null,
    trackingUrl:    data.tracker?.public_url,
    trackingId:     data.tracker?.id   || null,
    trackerUrl:     data.tracker?.public_url || null,
    totalCost:      totalCost || null,
  };
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

router.post('/rates', async (req, res) => {
  const { toAddress, parcel } = req.body;
  try {
    const result = PROVIDER === 'EASYPOST'
      ? await easypostRates(toAddress, parcel)
      : { rates: await shippoRates(toAddress, parcel), warnings: [] };
    res.json(result);
  } catch (e) {
    const status = e.status || 502;
    res.status(status).json(e.data || { error: e.message });
  }
});

router.post('/purchase', async (req, res) => {
  const { rateObjectId, insurance } = req.body;
  try {
    const result = PROVIDER === 'EASYPOST'
      ? await easypostPurchase(rateObjectId, insurance)
      : await shippoPurchase(rateObjectId);
    res.json(result);
  } catch (e) {
    const status = e.status || 502;
    res.status(status).json(e.data || { error: e.message, messages: e.messages });
  }
});

router.get('/tracker/:id', async (req, res) => {
  if (PROVIDER !== 'EASYPOST') return res.json({ skipped: true });
  const token = easypostToken();
  try {
    const r    = await fetch(`${EASYPOST_API}/trackers/${req.params.id}`, {
      headers: easypostHeaders(token),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    if (data.status === 'delivered') {
      const events      = data.tracking_details || [];
      const deliveredAt = events.find(e => e.status === 'delivered')?.datetime || data.updated_at || null;
      freezeDelivered.run(deliveredAt, req.params.id);
    }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'EasyPost request failed', detail: e.message });
  }
});

// Shippo-only usage counter — returns skipped flag when on EasyPost
const BILLING_EPOCH = new Date('2026-03-11');
const CYCLE_DAYS    = 30;
const LABEL_LIMIT   = 30;

router.get('/usage', async (_req, res) => {
  if (PROVIDER !== 'SHIPPO') return res.json({ skipped: true });

  const token = process.env.SHIPPO_LIVE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Live token not configured' });

  const now        = new Date();
  const msPerCycle = CYCLE_DAYS * 24 * 60 * 60 * 1000;
  const cycleIndex = Math.floor((now - BILLING_EPOCH) / msPerCycle);
  const since      = new Date(BILLING_EPOCH.getTime() + cycleIndex * msPerCycle).toISOString();

  try {
    const url = new URL(`${SHIPPO_API}/transactions/`);
    url.searchParams.set('results', '300');
    url.searchParams.set('object_created_after', since);
    url.searchParams.set('object_test', 'false');
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization':    `ShippoToken ${token}`,
        'SHIPPO-API-VERSION': SHIPPO_API_VERSION,
      },
    });
    const data      = await response.json();
    const purchased = (data.results || []).filter(t => t.status === 'SUCCESS');
    res.json({ count: purchased.length, limit: LABEL_LIMIT, since });
  } catch (e) {
    res.status(502).json({ error: 'Shippo request failed', detail: e.message });
  }
});

module.exports = router;
