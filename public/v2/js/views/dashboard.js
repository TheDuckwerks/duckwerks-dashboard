// ── Dashboard View ────────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('dashView', () => ({

    get trackingLoading() { return Alpine.store('dw').trackingLoading; },

    get inTransitRows() {
      const dw = Alpine.store('dw');
      return dw.records.filter(r => dw.isInTransit(r))
        .sort((a, b) => new Date(b.order?.date_sold || 0) - new Date(a.order?.date_sold || 0));
    },

    trackStatus(r)      { return Alpine.store('dw').trackerFor(r.shipment)?.status || null; },
    trackCarrier(r)     { return Alpine.store('dw').trackerFor(r.shipment)?.carrier || 'n/a'; },
    trackEstDelivery(r) {
      const raw = Alpine.store('dw').trackerFor(r.shipment)?.estDelivery;
      return raw ? new Date(raw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'n/a';
    },

    trackStatusBadge(status) {
      switch (status) {
        case 'delivered':        return 'badge-sold';
        case 'out_for_delivery': return 'badge-pending';
        case 'in_transit':       return 'badge-listed';
        case 'return_to_sender':
        case 'failure':          return 'badge-prepping';
        default:                 return 'badge-other';
      }
    },
    trackStatusLabel(status) {
      if (!status) return 'n/a';
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    get totalInvested() {
      return Alpine.store('dw').records.reduce((s, r) => s + (r.cost || 0), 0);
    },
    get revenue() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.order?.sale_price || 0), 0);
    },
    get profit() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.order?.profit || 0), 0);
    },
    get pipeline() {
      return Alpine.store('dw').pipeline;
    },
    get forecastedProfit() {
      return this.profit + this.pipeline;
    },
    get soldCost() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.cost || 0), 0);
    },
    get soldShipping() {
      return Alpine.store('dw').soldRecords.reduce((s, r) => s + (r.shipment?.shipping_cost || 0), 0);
    },
    get preppingCount() {
      return Alpine.store('dw').records.filter(r => r.status === 'Prepping').length;
    },
    get ebayListed() {
      const dw = Alpine.store('dw');
      return dw.listedRecords.filter(r => dw.siteLabel(r) === 'eBay').length;
    },
    get reverbListed() {
      const dw = Alpine.store('dw');
      return dw.listedRecords.filter(r => dw.siteLabel(r) === 'Reverb').length;
    },

    get lotRows() {
      const dw = Alpine.store('dw');
      return dw.lots.map(lot => {
        const cost      = dw.lotCost(lot);
        const recovered = lot.items.filter(r => r.status === 'Sold')
                            .reduce((s, r) => s + (r.order?.sale_price || 0), 0);
        const soldCount  = lot.items.filter(r => r.status === 'Sold').length;
        const totalCount = lot.items.length;
        const pct = cost > 0
          ? Math.min(100, Math.round((recovered / cost) * 100))
          : (totalCount > 0 ? Math.round((soldCount / totalCount) * 100) : null);
        const upside = lot.items.filter(r => r.status === 'Listed')
                         .reduce((s, r) => s + dw.estProfit(r), 0);
        return { name: lot.name, cost, recovered, pct, upside };
      }).sort((a, b) => b.cost - a.cost);
    },

    barClass(pct) {
      if (pct >= 100) return 'green';
      if (pct >= 50)  return 'yellow';
      return 'red';
    },

    get recentlySold() {
      return [...Alpine.store('dw').soldRecords]
        .filter(r => r.order?.date_sold)
        .sort((a, b) => new Date(b.order.date_sold) - new Date(a.order.date_sold))
        .slice(0, 30);
    },
    get recentlyListed() {
      return [...Alpine.store('dw').listedRecords]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);
    },

    listedDate(r) {
      return new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    soldDate(r) {
      const raw = r.order?.date_sold;
      if (!raw) return 'n/a';
      const [y, m, d] = raw.split('T')[0].split('-');
      return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    itemProfit(r) { return r.order?.profit || 0; },

    // ── Income windows ────────────────────────────────────────────────────────

    soldInWindow(days) {
      const dw     = Alpine.store('dw');
      const cutoff = new Date(Date.now() - days * 86400000);
      return dw.soldRecords.filter(r => {
        if (!r.order?.date_sold) return false;
        return new Date(r.order.date_sold) >= cutoff;
      });
    },

    windowDateRange(days) {
      const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const end   = new Date();
      const start = new Date(Date.now() - days * 86400000);
      return fmt(start) + '–' + fmt(end);
    },

    get incomeWindows() {
      const goal30 = 3000;
      const windows = [
        { label: '7d',  days: 7,  goalAmt: Math.round(goal30 * 7  / 30) },
        { label: '30d', days: 30, goalAmt: goal30 },
        { label: '60d', days: 60, goalAmt: goal30 * 2 },
        { label: '90d', days: 90, goalAmt: goal30 * 3 },
      ];
      const rows = windows.map(w => {
        const items = this.soldInWindow(w.days);
        const gross = items.reduce((s, r) => s + (r.order?.sale_price      || 0), 0);
        const cost  = items.reduce((s, r) => s + (r.cost                   || 0), 0);
        const ship  = items.reduce((s, r) => s + (r.shipment?.shipping_cost || 0), 0);
        const net   = items.reduce((s, r) => s + (r.order?.profit          || 0), 0);
        return { ...w, gross, cost, ship, net };
      });
      const maxGross = Math.max(...rows.map(r => r.gross), 1);
      return rows.map(r => ({
        ...r,
        costPct:  Math.round((r.cost  / maxGross) * 100),
        shipPct:  Math.round((r.ship  / maxGross) * 100),
        netPct:   Math.max(0, Math.round((r.net   / maxGross) * 100)),
        goalPct:  r.goalAmt ? Math.round((r.goalAmt / maxGross) * 100) : null,
        overGoal: r.goalAmt ? r.net >= r.goalAmt : null,
        deltaPct: r.goalAmt && r.goalAmt > 0 ? Math.round(((r.net - r.goalAmt) / r.goalAmt) * 100) : null,
      }));
    },

    get tape24h() {
      return this.soldInWindow(1).reduce((s, r) => s + (r.order?.profit || 0), 0);
    },

    // ── Rendering helpers ─────────────────────────────────────────────────────

    fmtWnd(n) {
      if (n === 0) return '$0';
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1000) return sign + '$' + (abs / 1000).toFixed(1) + 'k';
      return sign + '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
    },

    verdictText(w) {
      if (w.label === '7d')  return w.overGoal
        ? `↑ ${Math.abs(w.deltaPct)}% over weekly pace`
        : `↓ ${Math.abs(w.deltaPct)}% under weekly pace`;
      if (w.label === '30d') return w.overGoal
        ? `✓ rent covered · +$${Math.round(w.net - w.goalAmt).toLocaleString()}`
        : `✗ $${Math.round(w.goalAmt - w.net).toLocaleString()} short of goal`;
      const rentTimes = (w.net / w.goalAmt).toFixed(2);
      return w.overGoal
        ? `${rentTimes}× rent · ${w.label}`
        : `✗ $${Math.round(w.goalAmt - w.net).toLocaleString()} short of goal`;
    },

    ctag(r) {
      const cat = (r.category?.name || '').toLowerCase();
      if (cat.includes('music') || cat.includes('instrument') || cat.includes('audio') || cat.includes('synth') || cat.includes('guitar')) return 'music';
      if (cat.includes('computer') || cat.includes('laptop') || cat.includes('mac') || cat.includes('pc')) return 'comp';
      if (cat.includes('gaming') || cat.includes('game') || cat.includes('console')) return 'gaming';
      if (cat.includes('camera') || cat.includes('photo') || cat.includes('lens')) return 'camera';
      if (cat.includes('av') || cat.includes('receiver') || cat.includes('hifi') || cat.includes('stereo') || cat.includes('turntable')) return 'av';
      if (cat.includes('vinyl') || cat.includes('record') || cat.includes('media') || cat.includes('book') || cat.includes('disc')) return 'media';
      return 'other';
    },
    ctagLetter(r) {
      const map = { music: 'M', comp: 'C', gaming: 'G', camera: 'C', av: 'A', media: 'D', other: '?' };
      return map[this.ctag(r)] || '?';
    },
    platformMark(r) {
      const lbl = (Alpine.store('dw').siteLabel(r) || '').toLowerCase();
      return lbl === 'ebay' ? 'ebay' : lbl === 'reverb' ? 'reverb' : 'other';
    },
    platformLabel(r) {
      const lbl = (Alpine.store('dw').siteLabel(r) || '').toLowerCase();
      return lbl === 'ebay' ? 'EBY' : lbl === 'reverb' ? 'RVB' : '—';
    },

  }));
});
