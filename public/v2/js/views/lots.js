// ── Lots View ─────────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('lotsView', () => ({
    sortKey: 'name',
    sortDir: 'asc',

    init() {
      const saved = dwSortable.load('lots', 'name', 'asc');
      this.sortKey = saved.col;
      this.sortDir = saved.dir;
    },

    get rows() {
      const dw = Alpine.store('dw');
      const key = this.sortKey, dir = this.sortDir;
      return [...dw.lots].sort((a, b) => {
        let av, bv;
        if      (key === 'name')      { return dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name); }
        else if (key === 'cost')      { av = dw.lotCost(a); bv = dw.lotCost(b); }
        else if (key === 'recovered') {
          av = a.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          bv = b.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
        }
        else if (key === 'roi') {
          const cA = dw.lotCost(a);
          const rA = a.items.filter(r=>r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          const cB = dw.lotCost(b);
          const rB = b.items.filter(r=>r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0);
          av = cA > 0 ? rA / cA : 0; bv = cB > 0 ? rB / cB : 0;
        }
        else if (key === 'upside') {
          const dw2 = Alpine.store('dw');
          av = a.items.filter(r=>r.status==='Listed').reduce((s,r)=>s+dw2.payout(r),0);
          bv = b.items.filter(r=>r.status==='Listed').reduce((s,r)=>s+dw2.payout(r),0);
        }
        else return 0;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ?  1 : -1;
        return 0;
      });
    },

    sortBy(key) {
      if (this.sortKey === key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { this.sortKey = key; this.sortDir = 'asc'; }
      dwSortable.save('lots', this.sortKey, this.sortDir);
    },
    sortGlyph(key) {
      if (this.sortKey !== key) return '↕';
      return this.sortDir === 'asc' ? '↑' : '↓';
    },

    countByStatus(lot, status) { return lot.items.filter(r => r.status === status).length; },
    totalCost(lot)      { return Alpine.store('dw').lotCost(lot); },
    totalRecovered(lot) { return lot.items.filter(r => r.status==='Sold').reduce((s,r)=>s+(r.order?.sale_price||0),0); },
    recoveryPct(lot) {
      const cost = this.totalCost(lot);
      const rec  = this.totalRecovered(lot);
      if (cost > 0) return Math.min(100, Math.round((rec / cost) * 100));
      const total = lot.items.length;
      return total > 0 ? Math.round((this.countByStatus(lot, 'Sold') / total) * 100) : 0;
    },
    recoveryBarClass(pct) {
      if (pct >= 100) return 'green';
      if (pct >= 50)  return 'yellow';
      return 'red';
    },
    estUpside(lot) {
      const dw = Alpine.store('dw');
      return lot.items.filter(r => r.status === 'Listed').reduce((s, r) => s + dw.estProfit(r), 0);
    },

    openLot(lot) { Alpine.store('dw').openModal('lot', null, lot.name); },
  }));
});
