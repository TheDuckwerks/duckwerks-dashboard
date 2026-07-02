// ── Lot Modal — Phase 5 ───────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('lotModal', () => ({
    sortKey: 'name',
    sortDir: 'asc',

    // ── Rename state ───────────────────────────────────────────────────────
    renaming:     false,
    renameValue:  '',
    renameSaving: false,

    // ── Realloc state ──────────────────────────────────────────────────────
    reallocMode:          false,
    reallocRows:          [],
    reallocOriginalTotal: 0,
    reallocSaving:        false,
    reallocError:         null,

    get lot() {
      const dw = Alpine.store('dw');
      return dw.lots.find(l => l.name === dw.activeLotName) || null;
    },

    get items() {
      return this.lot?.items || [];
    },

    get sortedItems() {
      const dw  = Alpine.store('dw');
      const arr = [...this.items];
      const k   = this.sortKey;
      const dir = this.sortDir === 'asc' ? 1 : -1;
      return arr.sort((a, b) => {
        let av, bv;
        if (k === 'name')      { return dir * (a.name || '').localeCompare(b.name || ''); }
        if (k === 'status')    { return dir * (a.status || '').localeCompare(b.status || ''); }
        if (k === 'cost')      { av = a.cost || 0;                              bv = b.cost || 0; }
        if (k === 'listPrice') { av = dw.activeListing(a)?.list_price || 0;    bv = dw.activeListing(b)?.list_price || 0; }
        if (k === 'eaf')       { av = dw.payout(a);                            bv = dw.payout(b); }
        if (k === 'estProfit') { av = this.profitValue(a);                     bv = this.profitValue(b); }
        if (k === 'sale')      { av = a.order?.sale_price || 0;                bv = b.order?.sale_price || 0; }
        return dir * ((av || 0) - (bv || 0));
      });
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
    },

    sortGlyph(key) {
      if (this.sortKey !== key) return ' ↕';
      return this.sortDir === 'asc' ? ' ↑' : ' ↓';
    },

    totalCost() {
      return Alpine.store('dw').lotCost(this.lot);
    },

    recovered() {
      return this.items
        .filter(r => r.status === 'Sold')
        .reduce((sum, r) => sum + (r.order?.sale_price || 0), 0);
    },

    recoveryPct() {
      const cost = this.totalCost();
      const rec  = this.recovered();
      if (cost > 0) return Math.min(100, Math.round((rec / cost) * 100));
      const total = this.items.length;
      return total > 0 ? Math.round((this.countByStatus('Sold') / total) * 100) : 0;
    },

    estUpside() {
      const dw = Alpine.store('dw');
      return this.items
        .filter(r => r.status === 'Listed')
        .reduce((sum, r) => sum + dw.estProfit(r), 0);
    },

    realizedProfit() {
      return this.items
        .filter(r => r.status === 'Sold')
        .reduce((sum, r) => sum + (r.order?.profit || 0), 0);
    },

    soldCost() {
      return this.items
        .filter(r => r.status === 'Sold')
        .reduce((sum, r) => sum + (r.cost || 0), 0);
    },

    soldShipping() {
      return this.items
        .filter(r => r.status === 'Sold')
        .reduce((sum, r) => sum + (r.shipment?.shipping_cost || 0), 0);
    },

    estTotalProfit() {
      return this.realizedProfit() + this.estUpside();
    },

    totalRecovered() {
      return this.recovered() - (this.lot?.total_cost || this.totalCost());
    },

    countByStatus(status) {
      return this.items.filter(r => r.status === status).length;
    },

    recoveryBarClass() {
      const pct = this.recoveryPct();
      if (pct >= 100) return 'green';
      if (pct >= 50)  return 'yellow';
      return 'red';
    },

    badgeClass(status) {
      const s = (status || '').toLowerCase();
      if (s === 'listed')   return 'badge-listed';
      if (s === 'sold')     return 'badge-sold';
      if (s === 'pending')  return 'badge-pending';
      if (s === 'prepping') return 'badge-prepping';
      return 'badge-other';
    },

    listPriceDisplay(r) {
      const dw = Alpine.store('dw');
      const lp = dw.activeListing(r)?.list_price || 0;
      return lp > 0 ? dw.fmt0(lp) : 'n/a';
    },

    eafDisplay(r) {
      const dw = Alpine.store('dw');
      if (r.status === 'Sold') return 'n/a';
      const lp = dw.activeListing(r)?.list_price || 0;
      return lp > 0 ? dw.fmt0(dw.payout(r)) : 'n/a';
    },

    profitValue(r) {
      return r.status === 'Sold' ? (r.order?.profit || 0) : Alpine.store('dw').estProfit(r);
    },

    profitDisplay(r) {
      const p = this.profitValue(r);
      return (p >= 0 ? '+' : '') + Alpine.store('dw').fmt0(p);
    },

    openItem(r) {
      const dw = Alpine.store('dw');
      dw.previousModal = { type: 'lot', recordId: null, lotName: dw.activeLotName };
      dw.openModal('item', r.id);
    },

    addItem() {
      const dw = Alpine.store('dw');
      dw.previousModal = { type: 'lot', recordId: null, lotName: dw.activeLotName };
      dw.openModal('add');
    },

    startRename() {
      this.renameValue = this.lot?.name || '';
      this.renaming    = true;
      this.$nextTick(() => this.$refs.renameInput?.focus());
    },

    async saveRename() {
      const val = this.renameValue.trim();
      if (!val || val === this.lot?.name) { this.renaming = false; return; }
      this.renameSaving = true;
      const dw = Alpine.store('dw');
      try {
        await fetch(`/api/lots/${this.lot.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: val }),
        });
        await dw.fetchAll();
        dw.activeLotName = val;
      } finally {
        this.renameSaving = false;
        this.renaming     = false;
      }
    },

    async confirmDelete() {
      if (!confirm(`Delete lot "${this.lot?.name}"? This cannot be undone.`)) return;
      await fetch(`/api/lots/${this.lot.id}`, { method: 'DELETE' });
      await Alpine.store('dw').fetchAll();
      Alpine.store('dw').closeModal();
    },

    exportCsv() {
      const dw   = Alpine.store('dw');
      const rows = [['Name','Status','Cost','List Price','EAF','Profit','Sale']];
      for (const r of this.sortedItems) {
        const lp = dw.activeListing(r)?.list_price || 0;
        rows.push([
          r.name,
          r.status,
          r.cost || 0,
          lp || '',
          r.status !== 'Sold' && lp ? dw.payout(r).toFixed(2) : '',
          this.profitValue(r).toFixed(2),
          r.order?.sale_price || '',
        ]);
      }
      const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${this.lot?.name || 'lot'}.csv` });
      a.click();
    },

    // ── Realloc methods ────────────────────────────────────────────────────
    initRealloc() {
      const dw = Alpine.store('dw');
      this.reallocOriginalTotal = this.totalCost();
      this.reallocRows = this.items.map(r => ({
        id:        r.id,
        name:      r.name,
        status:    r.status,
        listPrice: dw.activeListing(r)?.list_price || 0,
        editCost:  r.cost || 0,
      }));
      this.reallocMode  = true;
      this.reallocError = null;
    },

    cancelRealloc() {
      this.reallocMode  = false;
      this.reallocRows  = [];
      this.reallocError = null;
    },

    reallocAllocated() {
      return this.reallocRows.reduce((s, r) => s + (parseFloat(r.editCost) || 0), 0);
    },

    reallocDiff() {
      return this.reallocAllocated() - this.reallocOriginalTotal;
    },

    reallocColorClass() {
      const diff = Math.abs(this.reallocDiff());
      if (diff < 0.01) return 'green';
      if (diff < 5)    return 'yellow';
      return 'red';
    },

    redistribute() {
      const totalLp = this.reallocRows.reduce((s, r) => s + (r.listPrice || 0), 0);
      if (totalLp <= 0) return;
      const budget = this.reallocOriginalTotal;
      this.reallocRows.forEach(r => {
        r.editCost = Math.round((r.listPrice / totalLp) * budget);
      });
    },

    async saveRealloc() {
      this.reallocSaving = true;
      this.reallocError  = null;
      try {
        const changed = this.reallocRows.filter(r => {
          const orig = this.items.find(i => i.id === r.id);
          return Math.abs((orig?.cost || 0) - (parseFloat(r.editCost) || 0)) > 0.001;
        });
        await Promise.all(changed.map(r =>
          fetch(`/api/items/${r.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ cost: parseFloat(r.editCost) || 0 }),
          })
        ));
        await Alpine.store('dw').fetchAll();
        this.reallocMode = false;
        this.reallocRows = [];
      } catch (e) {
        this.reallocError = 'Save failed: ' + e.message;
      } finally {
        this.reallocSaving = false;
      }
    },
  }));
});
