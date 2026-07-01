#!/usr/bin/env node
// Re-materialize items.name = resolveDiscTitle(blob) for every non-Sold disc
// (#134 Phase 4), after a generateDiscTitle template change. Overrides (non-null
// list_title) return verbatim, so a template change only moves generated titles;
// an override's name changes only when the override does.
//
// Dry-run by default (shows the diff, writes nothing).
//   --confirm   write the new items.name values
//   --push      after --confirm, push each changed disc to eBay via bulk-update
//   --api <url> target app (default localhost — run this ON the NUC, where :3000
//               lives; port 3000 is not exposed on the LAN)
//
// The DB work runs server-side (the app owns the real DB); this just calls the
// /api/catalog-intake/refresh-titles route and prints the diff.
//
// Usage (from the Mac): ssh geoff@fedora.local "cd /srv/duckwerks/dash/current && node scripts/refresh-disc-titles.js [--confirm] [--push]"

function argVal(flag) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; }

const API     = argVal('--api') || 'http://localhost:3000';
const CONFIRM = process.argv.includes('--confirm');
const PUSH    = process.argv.includes('--push');

async function main() {
  const res  = await fetch(`${API}/api/catalog-intake/refresh-titles?confirm=${CONFIRM}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

  if (data.count === 0) { console.log('No titles changed — nothing to do.'); return; }

  console.log(`${CONFIRM ? 'APPLIED' : 'DRY RUN'} — ${data.count} title(s) ${CONFIRM ? 'updated' : 'would change'}:\n`);
  data.changes.forEach(c => {
    console.log(`${c.sku}`);
    console.log(`  - ${c.from}`);
    console.log(`  + ${c.to}\n`);
  });

  if (!CONFIRM) { console.log('Re-run with --confirm to write items.name.'); return; }

  if (!PUSH) {
    console.log('items.name updated. Run with --push (or use UPDATE EBAY in the catalog) to sync eBay.');
    return;
  }

  console.log('Pushing changed discs to eBay...\n');
  let ok = 0, failed = 0;
  for (const c of data.changes) {
    try {
      const row = await (await fetch(`${API}/api/inventory/${encodeURIComponent(c.sku)}`)).json();
      if (!row || !row.metadata) throw new Error('no inventory row');
      const id  = parseInt(c.sku.replace(/^DWG-0*/i, ''), 10);
      const r   = await fetch(`${API}/api/ebay/bulk-update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disc: { id, ...row.metadata } }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      console.log(`${c.sku}: pushed`);
      ok++;
    } catch (e) {
      console.error(`${c.sku}: push failed — ${e.message}`);
      failed++;
    }
  }
  console.log(`\nPush done. ${ok} ok, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
