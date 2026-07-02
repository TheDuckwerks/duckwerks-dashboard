# Scripts

One-liners for each script. All scripts default to dry run; pass `--confirm` to write.

## Active workflows

**`bulk-list-discs.js`** — List or update discs on eBay from inventory DB. Secondary path to the catalog's web bulk-list UI (#139); still the one to use for `--photos-only` batches and scripted runs.
```
node scripts/bulk-list-discs.js --ids 293-310 --photos /path/to/photos   # list new
node scripts/bulk-list-discs.js --ids 293-310 --update                    # update existing
node scripts/bulk-list-discs.js --ids 293-310 --photos-only               # replace photos only
```

**`deploy.sh`** — Deploy to the NUC (Duck Ops rsync-artifact standard). See [`docs/deploy.md`](../docs/deploy.md).
```
./scripts/deploy.sh
```

**`ebay-traffic-merge.js`** — Merge an offline eBay Seller Hub traffic-report CSV export with DB SKU + price data. Unrelated to the live `POST /api/ebay/traffic` route (analytics.js); this is for CSV exports pulled outside the app.
```
node scripts/ebay-traffic-merge.js path/to/report.csv
```

**`rename-disc-photos.js`** — Batch rename disc photos to `DWG-{id}-{n}.jpg` convention.

**`convert-photos.js`** — Convert photos to JPEG before upload.

## Diagnostics

**`check-aspects.js`** — Inspect eBay item aspects for a listing by SKU.

**`check-conditions.js`** — Inspect valid eBay condition values for a category ID.

**`check-offer.js`** — Inspect an eBay offer by SKU.

**`test-rates.js`** — Test EasyPost rate fetching for a given package size/weight.

## Data management

**`assign-lot.js`** — Assign a range of items to a lot ID.

**`refresh-disc-titles.js`** — Re-materialize `items.name` for non-Sold discs after a `generateDiscTitle` template change (#134). Dry-run by default; `--confirm` writes, `--push` syncs eBay. Runs on the NUC (`:3000` isn't LAN-exposed):
```
ssh geoff@fedora.local "cd /srv/duckwerks/dash/current && node scripts/refresh-disc-titles.js --confirm"
```

**`update-site-fees.js`** — Update site fee config in the DB.

**`withdraw-offers.js`** — Reference code, not a reusable tool: withdraws eBay offers for a hardcoded set of SKU/offer-ID pairs baked into the script. Edit the pairs before rerunning for a different set.

## Reference data (re-seed if DB is rebuilt)

**`seed-flight-numbers.js`** — Seed flight number reference data into `flight_numbers` table.

**`seed-plastics.js`** — Seed disc plastics reference data into `disc_plastics` table.

## Comp research

**`bulk-comp-discs.js`** — Run comp research for a range of disc inventory items.

**`reverb-scrape.js`** — Scrape Reverb listing data for comp research.
