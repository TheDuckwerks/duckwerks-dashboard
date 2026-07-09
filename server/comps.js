const express    = require('express');
const router     = express.Router();
const Anthropic  = require('@anthropic-ai/sdk');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');
const CHROME_PATH = process.env.CHROME_PATH;
const SERPAPI     = 'https://serpapi.com/search.json';
const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COMP_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '../docs/gear-comp-research.md'), 'utf8'
);

const SYSTEM_PROMPT = `You are a reseller pricing assistant. Your job is to analyze eBay listing data and produce structured comp analysis.

Here is the comp research workflow and CSV format you must follow:

${COMP_WORKFLOW}

When given raw eBay listing data for an item, you will:
1. Write a brief analysis paragraph (2-4 sentences): price range, notable outliers or patterns, recommended list price and floor price. Be specific with dollar amounts.
2. Output a CSV block in the exact format from the workflow doc above.

For the CSV:
- source: use "eBay" for eBay listings and "Reverb" for Reverb listings (check the listing data)
- date_pulled is the date provided
- Use the listing data as-is for title, condition, sold_price, shipping, total_landed, sale_type
- listing_status: use the value from the data — eBay results are confirmed sold (soldItems filter), Reverb results are confirmed sold (show_only_sold=true). Do not override based on end_date.
- notes: flag outliers (parts-only, lot, Japanese import, no PSU, battery-only, etc.) as described in the workflow. Leave empty if nothing notable.

IMPORTANT: You MUST always output both sections. Even if the data is noisy or all listings are active, still produce the CSV — use the notes column to flag questionable listings (kit, charger-only, 2-pack, aftermarket, active/no-sold-date, etc.). Never skip the CSV block.

Format your response EXACTLY as:
ANALYSIS:
<analysis paragraph>

CSV:
\`\`\`
item,source,date_pulled,title,condition,sold_price,shipping,total_landed,sale_type,listing_status,notes
<rows>
\`\`\`

Do not include any other text outside this format.`;

// POST /api/comps/search
// Body: { items: [{ name, minPrice, notes, alternates }] }
// Returns: { results: [{ name, hints, listings: [...] }] }
router.post('/search', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  try {
    const results = await Promise.all(items.map(async item => {
      const sources = item.sources || ['ebay'];

      // a failed source surfaces in `errors` so the caller can tell
      // "source down" from "genuinely zero comps"
      const errors = [];
      const [ebayListings, reverbListings] = await Promise.all([
        sources.includes('ebay')
          ? searchItem(item).then(r => r.listings).catch(e => {
              console.warn(`eBay search failed for "${item.name}":`, e.message);
              errors.push(`eBay: ${e.message}`);
              return [];
            })
          : Promise.resolve([]),
        sources.includes('reverb')
          ? searchReverb(item.name, item.minPrice).catch(e => {
              console.warn(`Reverb scrape failed for "${item.name}":`, e.message);
              errors.push(`Reverb: ${e.message}`);
              return [];
            })
          : Promise.resolve([]),
      ]);
      return {
        name:     item.name,
        hints:    item,
        listings: [...ebayListings, ...reverbListings],
        errors,
      };
    }));
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'Search failed', detail: e.message });
  }
});

async function searchItem(item) {
  const { name, searchQuery, minPrice } = item;
  const params = new URLSearchParams({
    engine:      'ebay',
    ebay_domain: 'ebay.com',
    _nkw:        searchQuery || name,
    show_only:   'Sold',
    _ipg:        '50',
    api_key:     process.env.SERPAPI_API_KEY,
  });
  if (minPrice) {
    params.set('_udlo', String(minPrice));
  }

  const res = await fetch(`${SERPAPI}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SerpAPI error for "${name}": ${res.status} — ${text}`);
  }

  const data = await res.json();
  // SerpAPI reports engine-level failures as HTTP 200 + an `error` field
  // (seen 2026-07-09: eBay engine returning empty for every query) — surface it
  if (data.error && !(data.organic_results || []).length) {
    throw new Error(`SerpAPI: ${data.error}`);
  }
  const listings = (data.organic_results || []).map(i => {
    const price    = i.price?.extracted || 0;
    const shipping = typeof i.shipping === 'object' ? (i.shipping.extracted || 0) : 0;
    const saleType = i.bids != null ? 'Auction' : 'BIN';
    return {
      query:          name,
      title:          i.title,
      condition:      i.condition || '',
      sold_price:     price,
      shipping,
      total_landed:   +(price + shipping).toFixed(2),
      sale_type:      saleType,
      end_date:       i.sold_date || '',
      listing_status: 'sold',
      source:         'eBay',
    };
  });

  return { name: item.name, hints: item, listings };
}

function searchReverb(name, minPrice) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '../scripts/reverb-scrape.js');
    const child  = spawn(process.execPath, [script, name, String(minPrice || 0), CHROME_PATH], {
      timeout: 45000,
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `reverb-scrape exited ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`reverb-scrape JSON parse failed: ${e.message}`));
      }
    });

    child.on('error', reject);
  });
}

// POST /api/comps/analyze
// Body: { item: { name, hints, listings: [...] } }
// Returns: { name, analysis, csv }
router.post('/analyze', async (req, res) => {
  const { item } = req.body;
  if (!item || !item.listings) {
    return res.status(400).json({ error: 'item with listings required' });
  }

  const today = new Date().toISOString().split('T')[0];
  const userMsg   = `Item: ${item.name}
Date today: ${today}
Hints: ${JSON.stringify(item.hints)}

eBay listings (${item.listings.length} results):
${JSON.stringify(item.listings, null, 2)}`;

  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system:     [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content: userMsg }],
    });

    const text     = message.content[0]?.text || '';
    const analysis = extractSection(text, 'ANALYSIS:', 'CSV:');
    const csv      = extractCsvBlock(text);

    res.json({ name: item.name, analysis, csv });
  } catch (e) {
    res.status(502).json({ error: 'Claude API error', detail: e.message });
  }
});

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end   = endMarker ? text.indexOf(endMarker) : text.length;
  if (start === -1) return text.trim();
  return text.slice(start + startMarker.length, end > start ? end : text.length).trim();
}

function extractCsvBlock(text) {
  // Match fenced block with optional language hint
  const fenced = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Fallback: grab everything after "CSV:" and strip any surrounding fences
  const csvIdx = text.indexOf('CSV:');
  if (csvIdx !== -1) {
    return text.slice(csvIdx + 4).trim().replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
  }
  return '';
}

module.exports = { router };
