// ── Duckwerks v2 — Config ─────────────────────────────────────────────────────

const APP_VERSION = '2.0.56';

// Stale-listing thresholds (catalog stale report, #151): a listing is stale when
// it has been up STALE_DOM_DAYS+ with <= STALE_MAX_VIEWS views in the 30-day window
const STALE_DOM_DAYS  = 21;
const STALE_MAX_VIEWS = 5;

// Category display config — keyed by category name
// badge_class matches server/db.js seed data
const CAT_COLOR = {
  Music:                'var(--blue)',
  Computer:             'var(--purple)',
  Gaming:               'var(--orange)',
  'A/V Gear':           'var(--yellow)',
  Camera:               'var(--green)',
  'Comics/Books/Media': 'var(--red)',
  Home:                 '#60b0b0',
  'Junk Drawer':        'var(--muted)',
};

const CAT_BADGE = {
  Music:                'badge-music',
  Computer:             'badge-comp',
  Gaming:               'badge-gaming',
  'A/V Gear':           'badge-av',
  Camera:               'badge-camera',
  'Comics/Books/Media': 'badge-media',
  Home:                 'badge-home',
  'Junk Drawer':        'badge-other',
};
