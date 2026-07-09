// ── Comp Research View ─────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('compsView', () => ({

    items:   [{ name: '', sources: 'ebay', minPrice: '', notes: '', searchQuery: '' }],
    results: [],   // [{ name, status, analysis, csv, error }]
    running: false,
    sortKey: 'sold_price',
    sortDir: 'desc',

    init() {
      this.$watch('$store.dw.pendingComp', val => {
        if (!val) return;
        this.items   = [{ name: val.name, sources: val.sources, minPrice: val.minPrice, notes: val.notes, searchQuery: '' }];
        this.results = [];
        this.$store.dw.pendingComp = null;
      });
      const saved = dwSortable.load('comps', 'sold_price', 'desc');
      this.sortKey = saved.col;
      this.sortDir = saved.dir;
    },

    addItem() {
      this.items.push({ name: '', sources: 'ebay', minPrice: '', notes: '', searchQuery: '' });
    },

    removeItem(idx) {
      this.items.splice(idx, 1);
    },

    async run() {
      const items = this.items
        .filter(i => i.name.trim())
        .map(i => ({
          name:        i.name.trim(),
          sources:     i.sources.split(','),
          minPrice:    parseFloat(i.minPrice) || undefined,
          notes:       i.notes.trim() || undefined,
          searchQuery: i.searchQuery.trim() || undefined,
        }));
      if (!items.length) return;

      this.running = true;
      this.results = items.map(i => ({ name: i.name, status: 'searching', analysis: '', csv: '', error: '' }));

      // Search all items in parallel
      let searchResults;
      try {
        const response = await fetch('/api/comps/search', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ items }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Search failed');
        searchResults = data.results;
      } catch (e) {
        this.results.forEach(r => { r.status = 'error'; r.error = e.message; });
        this.running = false;
        return;
      }

      // Update all to 'analyzing'
      this.results.forEach(r => { r.status = 'analyzing'; });

      // Analyze each item sequentially to avoid rate limits
      for (let i = 0; i < searchResults.length; i++) {
        const item   = searchResults[i];
        const result = this.results[i];
        if (!item.listings || item.listings.length === 0) {
          result.status = 'error';
          result.error  = item.errors?.length
            ? item.errors.join(' · ')
            : 'No listings found — check source or search terms';
          continue;
        }
        try {
          const response = await fetch('/api/comps/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ item }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Analysis failed');
          result.analysis = data.analysis;
          result.csv      = data.csv;
          result.status   = 'done';
        } catch (e) {
          result.status = 'error';
          result.error  = e.message;
        }
      }

      this.running = false;
    },

    csvRows(csv) {
      if (!csv) return [];
      const lines = csv.split('\n').filter(Boolean);
      if (lines.length < 2) return [];
      const headers = lines[0].split(',');
      return lines.slice(1).map(line => {
        const cols = [];
        let cur = '', inQ = false;
        for (const ch of line + ',') {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
          else cur += ch;
        }
        return headers.reduce((obj, h, i) => { obj[h] = cols[i] || ''; return obj; }, {});
      });
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
      dwSortable.save('comps', this.sortKey, this.sortDir);
    },
    sortGlyph(key) {
      if (this.sortKey !== key) return '↕';
      return this.sortDir === 'asc' ? '↑' : '↓';
    },
    sortedComps(rows) {
      if (!rows?.length) return [];
      const key = this.sortKey, dir = this.sortDir;
      return [...rows].sort((a, b) => {
        let av = a[key], bv = b[key];
        if (key === 'sold_price') { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
    },
    get showTypeCol() {
      const allRows = this.results.flatMap(r => {
        const lines = (r.csv || '').split('\n').filter(Boolean);
        return lines.slice(1).map(line => {
          const cols = line.split(',');
          return { sale_type: cols[3]?.trim() || '' };
        });
      });
      return !Alpine.store('dw').allSame(allRows, 'sale_type');
    },

    copyCSV(csv) {
      navigator.clipboard.writeText(csv);
    },

    copyAll() {
      const all = this.results
        .filter(r => r.csv)
        .map(r => r.csv)
        .join('\n');
      navigator.clipboard.writeText(all);
    },

    _buildTXT(result) {
      return `COMP RESEARCH: ${result.name}\n${'='.repeat(60)}\n\n${result.analysis}\n\n${'─'.repeat(60)}\n\n${result.csv}`;
    },

    _triggerDownload(filename, content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    downloadTXT(result) {
      const filename = result.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_comps.txt';
      this._triggerDownload(filename, this._buildTXT(result));
    },

    downloadAll() {
      const content = this.results
        .filter(r => r.csv)
        .map(r => this._buildTXT(r))
        .join('\n\n' + '='.repeat(60) + '\n\n');
      this._triggerDownload('comps_all.txt', content);
    },

  }));
});
