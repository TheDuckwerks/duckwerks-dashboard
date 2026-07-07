#!/usr/bin/env node
// Backfill tracker terminal state (#160): poll each unfrozen sold shipment's tracker
// once so delivered ones freeze (tracking_status='delivered' + delivered_at). After
// this runs, dashboard/items loads poll only genuinely in-flight packages instead of
// the full sold history. The freeze happens server-side in GET /api/label/tracker/:id
// — this just walks the candidate shipments and hits that route once each.
//
// Dry-run by default (counts candidates, writes nothing).
//   --confirm   actually poll each tracker (freezing delivered ones)
//   --api <url> target app (default localhost — run ON the NUC, :3000 not on LAN)
//
// Usage (from the Mac): ssh geoff@fedora.local "cd /srv/duckwerks/dash/current && node scripts/backfill-tracker-status.js [--confirm]"

const path     = require('path');
const Database = require('better-sqlite3');

function argVal(flag) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; }
const API     = argVal('--api') || 'http://localhost:3000';
const CONFIRM = process.argv.includes('--confirm');

const DB_PATH = path.join(__dirname, '..', 'data', 'duckwerks.db');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const db   = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    `SELECT tracking_id FROM shipments
     WHERE tracking_id IS NOT NULL AND tracking_id != ''
       AND tracking_status IS NOT 'delivered'`
  ).all();
  db.close();

  console.log(`${rows.length} shipment(s) to poll (unfrozen, with a tracking id).`);
  if (!rows.length) return;

  if (!CONFIRM) {
    console.log('Dry run — pass --confirm to poll each tracker and freeze delivered ones.');
    return;
  }

  let delivered = 0, inTransit = 0, failed = 0;
  for (const { tracking_id } of rows) {
    try {
      const res  = await fetch(`${API}/api/label/tracker/${tracking_id}`);
      const data = await res.json();
      if (!res.ok || data.skipped)            failed++;
      else if (data.status === 'delivered')   delivered++;
      else                                    inTransit++;
    } catch (_) {
      failed++;
    }
    await sleep(120);  // gentle on EasyPost
  }
  console.log(`Done. Froze ${delivered} delivered · ${inTransit} still in transit · ${failed} skipped/failed.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
