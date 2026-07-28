// pull-sold-comps.js — extract eBay sold comps from a logged-in browser tab.
//
// WHY THIS EXISTS: eBay serves sold listings only to a logged-in session, so
// SerpAPI's scraper (the old /api/comps/search path) gets the login wall and
// returns a successful empty result forever (GOTCHAS "Comp research", #168).
// This runs in YOUR session, reads the live DOM, and emits the exact listings[]
// shape /api/comps/analyze already consumes — a drop-in for what SerpAPI returned.
//
// USE: on an eBay sold-results page (filter Sold, sort Ended Recently), run this
// against the live DOM one of two ways — either the installed "Pull Sold Comps"
// bookmarklet (one click, count comes back as an alert), or paste this whole file
// into the DevTools console (Cmd+Opt+J, count logs to console). Either copies a
// JSON array to your clipboard; paste it into
//   docs/listing-sessions/<slug>/comps.json
//
// REGENERATE the bookmarklet after editing this file (then re-save the bookmark's URL):
//   node -e 'const fs=require("fs");const c=fs.readFileSync(".claude/skills/list-item/pull-sold-comps.js","utf8").replace(/^(\/\/.*\n|\s*\n)+/,"");console.log("javascript:"+encodeURIComponent(c))'
//
// Selectors are eBay's s-card markup (verified 2026-07-27). If eBay reworks it,
// the count will drop or read 0 — that's the signal to re-pull one card's
// outerHTML and re-map, not to trust a partial result.

(() => {
  const cards = [...document.querySelectorAll('li.s-card, li.s-item')];
  const nkw   = new URL(location.href).searchParams.get('_nkw')
             || new URL(location.href).searchParams.get('_skw') || '';

  const normDate = s => {
    const d = new Date(s.replace(/\s+/g, ' ').trim());
    return isNaN(d) ? s.trim() : d.toISOString().slice(0, 10);
  };

  const rows = [];
  let skipped = 0;

  for (const card of cards) {
    const txt = sel => card.querySelector(sel)?.textContent?.trim() || '';

    // Gate on a real "Sold <date>" caption — filters template/"Shop on eBay"
    // cards and any active-listing strays that share the card markup.
    const caption   = txt('.s-card__caption') || txt('.s-item__caption');
    const soldMatch = caption.match(/Sold\s+(.+)/i);

    let title = txt('.s-card__title .su-styled-text') || txt('.s-item__title');
    title = title.replace(/Opens in a new window or tab\.?$/i, '')
                 .replace(/^New Listing/i, '').trim();

    if (!title || /^shop on ebay$/i.test(title)) continue;
    if (!soldMatch) { skipped++; continue; }

    // .s-card__price is the sold price; the strikethrough original is a
    // separate .strikethrough span, so this never grabs the wrong number.
    const priceM = (txt('.s-card__price') || txt('.s-item__price'))
                     .match(/\$?([\d,]+\.\d{2})/);
    const price  = priceM ? parseFloat(priceM[1].replace(/,/g, '')) : 0;

    const condition = (txt('.s-card__subtitle .su-styled-text') || txt('.SECONDARY_INFO'))
                        .replace(/\s*·\s*$/, '').trim();

    const attrRows = [...card.querySelectorAll('.s-card__attribute-row, .s-item__detail')]
                       .map(r => r.textContent.trim());

    let shipping = 0;
    const shipRow = attrRows.find(t => /delivery|shipping/i.test(t));
    if (shipRow && !/free/i.test(shipRow)) {
      const m = shipRow.match(/\$([\d,]+\.\d{2})/);
      if (m) shipping = parseFloat(m[1].replace(/,/g, ''));
    }

    const sale_type = attrRows.some(t => /\d+\s+bids?/i.test(t)) ? 'Auction' : 'BIN';

    rows.push({
      query:          nkw,
      title,
      condition,
      sold_price:     price,
      shipping,
      total_landed:   +(price + shipping).toFixed(2),
      sale_type,
      end_date:       normDate(soldMatch[1]),
      listing_status: 'sold',
      source:         'eBay',
    });
  }

  const out = JSON.stringify(rows, null, 2);
  const msg = `Pulled ${rows.length} sold comps to clipboard.` +
    (skipped ? ` Skipped ${skipped} non-sold card(s).` : '');

  if (window.copy) {
    // DevTools console: the `copy` helper is the reliable clipboard path; log the count.
    window.copy(out);
    console.log(msg);
  } else {
    // Bookmarklet: no console in view, so the count comes back as an alert.
    navigator.clipboard.writeText(out).then(
      () => alert(msg),
      () => { console.log(out); alert('Clipboard blocked; JSON dumped to console instead.'); }
    );
  }
  return rows.length;
})();
