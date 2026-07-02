#!/usr/bin/env node
// scripts/bulk-list-discs.js — eBay bulk listing/updating from local inventory DB
// Usage: node scripts/bulk-list-discs.js --ids <ids> --photos <dir> [--api <url>] [--confirm]
//        node scripts/bulk-list-discs.js --ids <ids> --update [--confirm]
//        node scripts/bulk-list-discs.js --ids <ids> --photos-only [--confirm]
//        <ids> accepts ranges and lists: 1-20,25,30-35

const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const idsArg         = arg('--ids');
const photosDir      = arg('--photos');
const apiBase        = arg('--api') || 'http://localhost:3000';
const confirm        = process.argv.includes('--confirm');
const updateMode     = process.argv.includes('--update');
const photosOnlyMode = process.argv.includes('--photos-only');
const maxRetries     = parseInt(arg('--retries') || '3', 10);

if (!idsArg || (!updateMode && !photosDir)) {
  console.error('Usage: node scripts/bulk-list-discs.js --ids <ids> --photos <dir> [--api <url>] [--confirm]');
  console.error('       node scripts/bulk-list-discs.js --ids <ids> --update [--confirm]');
  console.error('       node scripts/bulk-list-discs.js --ids <ids> --photos-only [--confirm]');
  console.error('       <ids> accepts ranges and lists: 1-20,25,30-35');
  process.exit(1);
}

if (photosOnlyMode && updateMode) {
  console.error('--photos-only and --update are mutually exclusive');
  process.exit(1);
}

function parseIds(str) {
  const ids = new Set();
  for (const seg of str.split(',')) {
    const parts = seg.trim().split('-').map(Number);
    if (parts.length === 1 && !isNaN(parts[0])) {
      ids.add(parts[0]);
    } else if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] <= parts[1]) {
      for (let i = parts[0]; i <= parts[1]; i++) ids.add(i);
    } else {
      console.error(`Invalid --ids segment: "${seg}" — use format 1-20,25,30-35`);
      process.exit(1);
    }
  }
  return ids;
}

const targetIds = parseIds(idsArg);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const res  = await fetch(`${apiBase}/api/inventory?ids=${encodeURIComponent(idsArg)}`);
  if (!res.ok) throw new Error(`Inventory fetch failed: ${res.status}`);
  const { inventory } = await res.json();

  if (inventory.length === 0) {
    console.error('No inventory rows found for the requested IDs.');
    process.exit(1);
  }

  // Build per-disc plan
  const plan = inventory.map(row => {
    const m       = row.sku.match(/^DWG-(\d+)$/i);
    const id      = m ? parseInt(m[1], 10) : 0;
    const paddedId = String(id).padStart(3, '0');
    const meta    = row.metadata || {};
    const title   = (meta.list_title || '').trim();
    const price   = parseFloat(meta.listPrice) || 0;

    if (row.status === 'sold') return { id, paddedId, row, meta, title, skip: 'sold' };

    if (updateMode) {
      // Title/price authority for a listed disc is items.name + the active
      // listing row (#134) — the bulk-update route resolves both server-side.
      // metadata.listPrice is intake staging (nulled once listed): never a gate here.
      if (!row.listing_id) return { id, paddedId, row, meta, title, skip: 'not listed (no active listing)' };
      return { id, paddedId, row, meta, title: (row.item_name || title), price: parseFloat(row.listing_price) || 0 };
    }

    const warnings = [];
    if (!price)  warnings.push('no listPrice in metadata');

    if (photosOnlyMode) {
      const photoPattern = new RegExp(`^DWG-${id}-.*\\.jpe?g$`, 'i');
      const photoFiles   = fs.readdirSync(photosDir).filter(f => photoPattern.test(f));
      if (photoFiles.length === 0) return { id, paddedId, row, meta, title, skip: 'no photos' };
      return { id, paddedId, row, meta, title, photoFiles };
    }

    const photoPattern = new RegExp(`^DWG-${id}-.*\\.jpe?g$`, 'i');
    const photoFiles   = fs.readdirSync(photosDir).filter(f => photoPattern.test(f));
    if (photoFiles.length === 0) warnings.push('no photos');

    return { id, paddedId, row, meta, title, price, photoFiles, warnings: warnings.length ? warnings : null };
  });

  const total = plan.length;

  // ── Dry run ───────────────────────────────────────────────────────────────

  if (!confirm) {
    const action = updateMode ? 'updated' : photosOnlyMode ? 'photos updated' : 'listed';
    console.log(`\nDRY RUN — no listings will be ${action} (target: ${apiBase})\n`);
    let wouldAct = 0, wouldSkip = 0;
    plan.forEach((p, i) => {
      const label = `[${i + 1}/${total}] DWG-${p.paddedId}`;
      const t     = (p.title || '').slice(0, 42).padEnd(42);
      if (p.skip) {
        console.log(`${label}  ${t}  skipped — ${p.skip}`);
        wouldSkip++;
      } else if (p.warnings) {
        console.log(`${label}  ${t}  skipped — ${p.warnings.join(', ')}`);
        wouldSkip++;
      } else if (updateMode) {
        console.log(`${label}  ${t}  would update @ $${p.price}`);
        wouldAct++;
      } else if (photosOnlyMode) {
        console.log(`${label}  ${t}  would update photos  (${p.photoFiles.length} photo${p.photoFiles.length !== 1 ? 's' : ''})`);
        wouldAct++;
      } else {
        console.log(`${label}  ${t}  would list @ $${p.price}  (${p.photoFiles.length} photo${p.photoFiles.length !== 1 ? 's' : ''})`);
        wouldAct++;
      }
    });
    console.log(`\nDry run: ${wouldAct} would be ${action}, ${wouldSkip} would be skipped`);
    return;
  }

  // ── Live run ──────────────────────────────────────────────────────────────

  async function runBatch(batch, cycleLabel) {
    let listed = 0, skipped = 0, errorIds = [];
    const batchTotal = batch.length;
    for (let i = 0; i < batchTotal; i++) {
      const p     = batch[i];
      const label = `${cycleLabel}[${i + 1}/${batchTotal}] DWG-${p.paddedId}`;
      const t     = (p.title || '').slice(0, 42).padEnd(42);

      if (p.skip || p.warnings) {
        console.log(`${label}  ${t}  skipped — ${p.skip || p.warnings.join(', ')}`);
        skipped++;
        continue;
      }

      try {
        const disc = {
          id:           p.id,
          title:        p.title,
          list_title:   p.title,   // buildDiscPayload reads `list_title` for the curated-title override
          listPrice:    p.price,
          description:  p.meta.description    || '',
          condition:    p.meta.condition      || '',
          manufacturer: p.meta.manufacturer   || '',
          mold:         p.meta.mold           || '',
          type:         p.meta.type           || '',
          plastic:      p.meta.plastic        || '',
          color:        p.meta.color          || '',
          run:          p.meta.run            || '',
          weight:       p.meta.weight         || '',
          notes:        p.meta.notes          || '',
          speed:        p.meta.speed          || '',
          glide:        p.meta.glide          || '',
          turn:         p.meta.turn           || '',
          fade:         p.meta.fade           || '',
          stability:    p.meta.stability      || '',
        };

        let response, result;

        if (updateMode) {
          response = await fetch(`${apiBase}/api/ebay/bulk-update`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ disc }),
          });
          result = await response.json();
          if (result.error) {
            console.log(`${label}  ${t}  ERROR — ${result.error}`);
            errorIds.push(p.id);
            skipped++;
            continue;
          }
          console.log(`${label}  ${t}  updated`);
          listed++;
        } else if (photosOnlyMode) {
          const formData = new FormData();
          formData.set('disc', JSON.stringify(disc));
          for (const filename of p.photoFiles) {
            const buf  = fs.readFileSync(path.join(photosDir, filename));
            const blob = new Blob([buf], { type: 'image/jpeg' });
            formData.set(`photos[${filename.replace(/\.jpe?g$/i, '')}]`, blob, filename);
          }
          response = await fetch(`${apiBase}/api/ebay/bulk-photos`, { method: 'POST', body: formData });
          result = await response.json();
          if (result.error) {
            console.log(`${label}  ${t}  ERROR — ${result.error}`);
            errorIds.push(p.id);
            skipped++;
            continue;
          }
          console.log(`${label}  ${t}  photos updated  (${result.photoCount})`);
          listed++;
        } else {
          const formData = new FormData();
          formData.set('disc', JSON.stringify(disc));
          for (const filename of p.photoFiles) {
            const buf  = fs.readFileSync(path.join(photosDir, filename));
            const blob = new Blob([buf], { type: 'image/jpeg' });
            formData.set(`photos[${filename.replace(/\.jpe?g$/i, '')}]`, blob, filename);
          }
          response = await fetch(`${apiBase}/api/ebay/bulk-list`, { method: 'POST', body: formData });
          result = await response.json();
          if (result.error) {
            console.log(`${label}  ${t}  ERROR — ${result.error}`);
            errorIds.push(p.id);
            skipped++;
            continue;
          }
          console.log(`${label}  ${t}  listed  ${result.url}`);
          listed++;
        }
      } catch (e) {
        console.log(`${label}  ${t}  ERROR — ${e.message}`);
        errorIds.push(p.id);
        skipped++;
      }
    }
    return { listed, skipped, errorIds };
  }

  const action = updateMode ? 'updated' : photosOnlyMode ? 'photos updated' : 'listed';
  let totalListed = 0, totalSkipped = 0;
  let { listed, skipped, errorIds } = await runBatch(plan, '');
  totalListed  += listed;
  totalSkipped += skipped;

  for (let cycle = 1; cycle <= maxRetries && errorIds.length > 0; cycle++) {
    console.log(`\nRetrying ${errorIds.length} error(s) — cycle ${cycle}/${maxRetries} (waiting 10s)...`);
    await new Promise(r => setTimeout(r, 10000));
    const retryPlan = plan.filter(p => errorIds.includes(p.id));
    ({ listed, skipped, errorIds } = await runBatch(retryPlan, `[retry ${cycle}] `));
    totalListed  += listed;
    totalSkipped += skipped;
  }

  console.log(`\nDone: ${totalListed} ${action}, ${totalSkipped} skipped`);
  if (errorIds.length) console.log(`Still failing after ${maxRetries} retries: --ids ${errorIds.join(',')}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
