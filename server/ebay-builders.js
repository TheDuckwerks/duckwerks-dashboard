// server/ebay-builders.js — category-specific payload builders
// Each builder takes raw item data and returns a normalized payload
// for the list/update routes. Add new builders here for new categories.

const LISTING_FOOTER = '\nAll sales final and all items sold as is. Please ask questions before purchasing.\nAll my listings ship with Free shipping for your ease, none of this $30 shipping on a 1 pound item. I price my listings fairly but please feel free to make an offer.\nI am a single person listing and selling 250 or so discs, so I might have missed a mark or two in my descriptions. Please ask if you want more photos or details about any of my discs, or let me know if you see any issues. \nThanks for looking!';

const DG_CATEGORY   = '184356'; // Sporting Goods > Disc Golf > Discs
const MIN_OFFER_PCT = 0.75;

const DISC_TYPE_MAP     = { 'Putter': 'Putting Disc', 'Midrange': 'Midrange Disc' };
const MANUFACTURER_MAP  = { 'Streamline': 'Streamline Discs' };
// Axiom and Streamline are MVP sub-brands; buyers search the parent, so lead the title with it.
const PARENT_BRAND      = { 'Axiom': 'MVP', 'Streamline': 'MVP' };

const VALID_COLORS = new Set([
  'Beige', 'Black', 'Blue', 'Bronze', 'Brown', 'Gold', 'Gray', 'Green',
  'Multi-Color', 'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'White', 'Yellow',
]);

// eBay Inventory API does not accept bare "USED" — map it to the closest specific enum
const CONDITION_MAP = { 'USED': 'USED_EXCELLENT' };

function normalizeDiscType(type) { return DISC_TYPE_MAP[type] || type; }
// For titles, use the short form buyers actually search (and avoid "...Disc Disc Golf").
const TITLE_TYPE_MAP = { 'Putting Disc': 'Putter', 'Midrange Disc': 'Midrange', 'Mid': 'Midrange' };
function titleDiscType(type) { return type ? (TITLE_TYPE_MAP[type] || type) : ''; }
function normalizeManufacturer(m) { return MANUFACTURER_MAP[m] || m; }
function normalizeCondition(c) { return CONDITION_MAP[c] || c || 'NEW'; }
function minOffer(price) { return Math.floor(parseFloat(price) * MIN_OFFER_PCT); }

// Recall-first title: lead with the terms buyers search (parent brand, mold, plastic,
// disc type, "Disc Golf"), then the low-search extras. `run` is omitted by default —
// it is inconsistent (junk like "post-prototype" vs gold like "Lizotte signature"), so
// signature/event discs carry a hand-written `list_title` instead. Assembled in read
// order; if over eBay's 80-char cap, the lowest-value tail segments drop first while the
// searchable core is always kept.
function generateDiscTitle({ manufacturer, mold, plastic, type, run, notes, weight, color, condition }) {
  const parent = PARENT_BRAND[manufacturer];
  const line   = notes ? String(notes).replace(/simon\s*line/ig, 'SimonLine') : '';

  // Condition word. Seconds/x-outs are a required disclosure AND a deal-hunter search term,
  // so surface the real grade instead of the (false) "Unthrown". Grade text lives in run/notes.
  const src  = `${notes || ''} ${run || ''}`;
  let cond, condDrop;
  if      (/x-?out/i.test(src))          { cond = 'X-Out';          condDrop = 0; }
  else if (/lab\s*second/i.test(src))    { cond = 'Lab Second';     condDrop = 0; }
  else if (/factory\s*second/i.test(src)){ cond = 'Factory Second'; condDrop = 0; }
  else if (/misprint|\bsecond\b/i.test(src)) { cond = 'Factory Second'; condDrop = 0; }
  else if ((condition || 'NEW').toUpperCase().startsWith('USED')) { cond = 'Used'; condDrop = 4; }
  else                                   { cond = 'Unthrown';       condDrop = 4; }

  // drop = 0 never drops (searchable core); higher drop = shed first when over budget
  const segs = [
    { t: parent,       drop: 0 },
    { t: manufacturer, drop: 0 },
    { t: mold,         drop: 0 },
    { t: line,         drop: 3 },
    { t: plastic,      drop: 0 },
    { t: titleDiscType(type), drop: 0 },
    { t: 'Disc Golf',  drop: 0 },
    { t: color,        drop: 2 },
    { t: weight ? `${weight}g` : '', drop: 1 },
    { t: cond,         drop: condDrop },
  ].filter(s => s.t);

  const render = ss => ss.map(s => s.t).join(' ');
  let kept = segs.slice();
  while (render(kept).length > 80) {
    const droppable = kept.filter(s => s.drop > 0);
    if (!droppable.length) break;
    const victim = droppable.reduce((a, b) => (b.drop > a.drop ? b : a));
    kept = kept.filter(s => s !== victim);
  }
  const title = render(kept);
  return title.length <= 80 ? title : title.slice(0, 81).replace(/\s+\S*$/, '');
}

// Resolves a disc's title from its blob: a custom `list_title` override wins,
// else the generated recall-first title. This is the single title-resolution
// point — used to materialize items.name at intake/mint and by buildDiscPayload.
function resolveDiscTitle(blob) {
  return blob.list_title || generateDiscTitle({ ...blob, condition: normalizeCondition(blob.condition) });
}

function buildDiscSpecLines(blob) {
  const lines = [];
  if (blob.manufacturer) lines.push(`Brand: ${blob.manufacturer}`);
  if (blob.mold)         lines.push(`Mold: ${blob.mold}`);
  if (blob.type)         lines.push(`Type: ${blob.type}`);
  if (blob.plastic)      lines.push(`Plastic: ${blob.plastic}`);
  if (blob.run)          lines.push(`Run/Edition: ${blob.run}`);
  if (blob.weight)       lines.push(`Weight: ${blob.weight}g`);
  if (blob.stability)    lines.push(`Stability: ${blob.stability}`);
  const hasVal = v => v != null && v !== '';
  if (hasVal(blob.speed) || hasVal(blob.glide) || hasVal(blob.turn) || hasVal(blob.fade)) {
    const parts = [];
    if (hasVal(blob.speed)) parts.push(`Speed: ${blob.speed}`);
    if (hasVal(blob.glide)) parts.push(`Glide: ${blob.glide}`);
    if (hasVal(blob.turn))  parts.push(`Turn: ${blob.turn}`);
    if (hasVal(blob.fade))  parts.push(`Fade: ${blob.fade}`);
    lines.push(`Flight Numbers: ${parts.join(' | ')}`);
  }
  if (blob.notes) lines.push(`Notes: ${blob.notes}`);
  return lines;
}

// Unified description renderer — used by disc builder routes.
// description: optional curated prose string
// specLines: string[] of "Key: Value" lines assembled by builder
// Returns full HTML string with mobile schema.org snippet, spec list, and footer.
function renderDescriptionHtml({ description, specLines = [] }) {
  const footerLines = LISTING_FOOTER.split('\n').filter(Boolean);
  const footer      = footerLines.map(l => `<p>${l}</p>`).join('');
  const specList    = specLines.length
    ? `<ul>${specLines.filter(l => l.trim()).map(l => `<li>${l}</li>`).join('')}</ul>`
    : '';

  if (description) {
    const paraLines  = description.split('\n').filter(Boolean);
    const mobileText = specLines.join('  |  ') + '  |  ' + paraLines.join(' ');
    const fullHtml   = paraLines.map(l => `<p>${l}</p>`).join('');
    return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${fullHtml}${specList}${footer}`;
  }

  const mobileText = specLines.join('  |  ');
  return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${specList}${footer}`;
}

// Renders plain-text description from skill checkpoint (pipe-separated spec blocks + prose).
// Used by list-item and update-item routes when payload arrives pre-built from skill.
function renderSkillDescriptionHtml(text) {
  const blocks    = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const htmlParts = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.every(l => l.includes(' | '))) {
      htmlParts.push(`<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`);
    } else {
      lines.forEach(l => htmlParts.push(`<p>${l}</p>`));
    }
  }

  const mobileText = text.replace(/\n+/g, '  |  ');
  return `<div vocab="https://schema.org/" typeof="Product" style="display:none"><span property="description">${mobileText}</span></div>${htmlParts.join('')}`;
}

// Builds a normalized payload from a disc inventory blob.
// blob: the metadata JSON from the inventory table (already parsed)
// Returns the normalized payload shape the list/update routes accept.
function buildDiscPayload(blob, opts = {}) {
  const condition = normalizeCondition(blob.condition);
  // Title authority is items.name once a disc exists (issue #134) — the route
  // hands it in via opts.title. The builder never generates on the hot path;
  // it only falls back to resolving from the blob spec when no name is passed
  // (e.g. a preview before the item row exists).
  const title     = opts.title || resolveDiscTitle(blob);
  const specLines = buildDiscSpecLines(blob);
  // Price authority is the listing row once a disc is listed (issue #134). The
  // route resolves it and passes opts.price; blob.listPrice is intake staging,
  // used only when no listing exists yet (e.g. preview/mint of an unlisted disc).
  const price     = opts.price != null ? parseFloat(opts.price) : parseFloat(blob.listPrice);

  const aspects = {
    Type: ['Disc Golf Disc'],
    ...(blob.manufacturer && { Brand:                [normalizeManufacturer(blob.manufacturer)] }),
    ...(blob.mold         && { Model:                [blob.mold] }),
    ...(blob.type         && { 'Disc Type':           [normalizeDiscType(blob.type)] }),
    ...(blob.plastic      && { 'Disc Plastic Type':   [blob.plastic] }),
    ...(blob.weight       && { 'Disc Weight':         [`${blob.weight} grams`] }),
    ...(blob.color && VALID_COLORS.has(blob.color) && { Color: [blob.color] }),
    ...(blob.speed != null && blob.speed !== '' && { 'Speed Rating':        [String(blob.speed)] }),
    ...(blob.glide != null && blob.glide !== '' && { 'Glide Rating':        [String(blob.glide)] }),
    ...(blob.turn  != null && blob.turn  !== '' && { 'Turn (Right) Rating': [String(blob.turn)] }),
    ...(blob.fade  != null && blob.fade  !== '' && { 'Fade (Left) Rating':  [String(blob.fade)] }),
  };

  return {
    title,
    description: blob.description || null,
    specLines,
    condition,
    price,
    minOffer:   minOffer(price),
    categoryId: DG_CATEGORY,
    aspects,
  };
}

module.exports = { buildDiscPayload, resolveDiscTitle, renderDescriptionHtml, renderSkillDescriptionHtml, minOffer };
