// ── Dashboard Charts — Chart.js ────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('chartsSection', () => ({
    charts: {},

    init() {
      // Set Chart.js dark theme defaults once
      Chart.defaults.color = '#999';
      Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

      // Dual-path: watch for data load, and handle already-loaded case
      this.$watch('$store.dw.loading', (val) => {
        if (!val) this.buildCharts();
      });
      const dw = Alpine.store('dw');
      if (!dw.loading && dw.records.length > 0) {
        this.buildCharts();
      }
    },

    buildCharts() {
      // Debounce: rapid fetchAll() calls (e.g. syncDetails loop) each toggle loading,
      // triggering this watch multiple times. Without debouncing, the rapid
      // destroy+create cycle leaves Chart.js RAF callbacks firing on null ctx.
      clearTimeout(this._buildTimer);
      this._buildTimer = setTimeout(() => {
        Object.values(this.charts).forEach(c => c.destroy());
        this.charts = {};
        this.buildMomentumChart();
      }, 50);
    },

    momentumData() {
      const dw = Alpine.store('dw');
      const WINDOWS = [3, 7, 14, 30];
      const now = new Date();

      // Per-window, per-site gross and net
      const sites = ['All', 'Reverb', 'eBay', 'Facebook'];
      const gross = {}; // gross[site][windowIdx]
      const net   = {}; // net[site][windowIdx]
      for (const s of sites) {
        gross[s] = Array(WINDOWS.length).fill(0);
        net[s]   = Array(WINDOWS.length).fill(0);
      }

      for (const r of dw.soldRecords) {
        const raw = r.order?.date_sold;
        if (!raw) continue;
        const sold     = new Date(raw + (raw.includes('T') ? '' : 'T00:00:00'));
        const ageMs    = now - sold;
        const ageDays  = ageMs / (1000 * 60 * 60 * 24);

        const saleGross = r.order?.sale_price || 0;
        const cost      = r.cost || 0;
        const shipping  = r.shipment?.shipping_cost || 0;

        // Site grouping from the sold listing (by presence of an order, not l.status — that's 'active'/'ended')
        const listing  = r.listings?.find(l => l.order) || r.listings?.[0];
        const siteName = listing?.site?.name || 'Other';
        // Realized fees live on the order row (orders.fees, #136) — never recomputed from the site formula here
        const fee     = r.order?.fees ?? 0;
        const saleNet = saleGross - cost - shipping - fee;

        for (let i = 0; i < WINDOWS.length; i++) {
          if (ageDays <= WINDOWS[i]) {
            gross['All'][i] += saleGross;
            net['All'][i]   += saleNet;
            if (sites.includes(siteName)) {
              gross[siteName][i] += saleGross;
              net[siteName][i]   += saleNet;
            }
          }
        }
      }

      // overage[site][i] = gross - net (the fees+cost visual layer)
      const overage = {};
      for (const s of sites) {
        overage[s] = WINDOWS.map((_, i) => Math.max(0, gross[s][i] - net[s][i]));
      }

      return { gross, net, overage, hasFacebook: gross['Facebook'].some(v => v > 0) };
    },

    buildMomentumChart() {
      const dw = Alpine.store('dw');
      if (dw.soldRecords.length === 0) return;

      const { net, overage, hasFacebook } = this.momentumData();
      const labels = ['3d', '7d', '14d', '30d'];

      // Hero background plugin — draws a wide translucent bar per window behind the site bars
      const heroPlugin = {
        id: 'heroBg',
        beforeDatasetsDraw(chart) {
          const { ctx, chartArea, scales: { x, y } } = chart;
          const { heroNet, heroOvg } = chart.options._heroData || {};
          if (!heroNet) return;
          const slotWidth = x.width / chart.data.labels.length;
          const barWidth  = slotWidth * 0.78;
          const yBottom   = chartArea.bottom;
          ctx.save();
          chart.data.labels.forEach((_, i) => {
            const netVal   = heroNet[i]  || 0;
            const grossVal = netVal + (heroOvg[i] || 0);
            if (grossVal <= 0) return;
            const xCenter = x.getPixelForValue(i);
            const yGross  = y.getPixelForValue(grossVal);
            const yNet    = netVal > 0 ? y.getPixelForValue(netVal) : yBottom;
            // cost+fees layer (top portion) — blue-gray tint so it reads as "more" not shadow
            ctx.fillStyle = 'rgba(100,140,220,0.18)';
            ctx.fillRect(xCenter - barWidth / 2, yGross, barWidth, yBottom - yGross);
            // net layer (bottom portion, green wash)
            ctx.fillStyle = 'rgba(72,187,120,0.22)';
            ctx.fillRect(xCenter - barWidth / 2, yNet, barWidth, yBottom - yNet);
          });
          ctx.restore();
        },
        afterDraw(chart) {
          const { ctx, chartArea, scales: { x, y } } = chart;
          const { heroNet, heroOvg } = chart.options._heroData || {};
          if (!heroNet) return;
          ctx.save();

          // Hero gross · net labels above each cluster
          const fmt = n => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'K' : '$' + Math.round(n);
          ctx.font = '13px "Space Mono", monospace';
          ctx.textAlign = 'center';
          chart.data.labels.forEach((_, i) => {
            const netVal   = heroNet[i]  || 0;
            const grossVal = netVal + (heroOvg[i] || 0);
            if (grossVal <= 0) return;
            const xCenter = x.getPixelForValue(i);
            const yGross  = y.getPixelForValue(grossVal);
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText(`${fmt(grossVal)} · ${fmt(netVal)} net`, xCenter, yGross - 5);
          });

          // Site name labels below each bar in bar color
          const siteLabels = [
            { dsIndex: 0, name: 'Reverb',   color: 'rgba(237,100,50,0.9)' },
            { dsIndex: 2, name: 'eBay',     color: 'rgba(236,201,75,0.9)' },
          ];
          if (chart.data.datasets.length > 4) {
            siteLabels.push({ dsIndex: 4, name: 'Facebook', color: 'rgba(153,153,153,0.9)' });
          }
          ctx.font = '12px "Space Mono", monospace';
          ctx.textBaseline = 'top';
          siteLabels.forEach(({ dsIndex, name, color }) => {
            const meta = chart.getDatasetMeta(dsIndex);
            if (!meta) return;
            ctx.fillStyle = color;
            chart.data.labels.forEach((_, i) => {
              if (!meta.data[i]) return;
              ctx.fillText(name, meta.data[i].x, chartArea.bottom + 4);
            });
          });

          ctx.restore();
        },
      };

      const datasets = [
        { label: 'Net (Reverb)',        data: net['Reverb'],     stack: 'reverb',   backgroundColor: 'rgba(237,100,50,0.8)',   order: 1 },
        { label: 'Cost+Fees (Reverb)',  data: overage['Reverb'], stack: 'reverb',   backgroundColor: 'rgba(237,100,50,0.2)',   order: 1 },
        { label: 'Net (eBay)',          data: net['eBay'],       stack: 'ebay',     backgroundColor: 'rgba(236,201,75,0.8)',   order: 1 },
        { label: 'Cost+Fees (eBay)',    data: overage['eBay'],   stack: 'ebay',     backgroundColor: 'rgba(236,201,75,0.2)',   order: 1 },
      ];

      if (hasFacebook) {
        datasets.push(
          { label: 'Net (Facebook)',       data: net['Facebook'],    stack: 'facebook', backgroundColor: 'rgba(153,153,153,0.7)',  order: 1 },
          { label: 'Cost+Fees (Facebook)', data: overage['Facebook'],stack: 'facebook', backgroundColor: 'rgba(153,153,153,0.2)', order: 1 }
        );
      }

      this.charts.momentum = new Chart(this.$refs.momentumCanvas, {
        type: 'bar',
        data: { labels, datasets },
        plugins: [heroPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 28, bottom: 18 } },
          _heroData: { heroNet: net['All'], heroOvg: overage['All'] },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const isOverage = ctx.dataset.label.startsWith('Cost+Fees');
                  const stack = ctx.dataset.stack;
                  const site  = stack.charAt(0).toUpperCase() + stack.slice(1);
                  if (isOverage) {
                    const netDs = ctx.chart.data.datasets.find(
                      d => d.stack === stack && !d.label.startsWith('Cost+Fees')
                    );
                    const gross = (netDs?.data[ctx.dataIndex] || 0) + ctx.parsed.y;
                    return ` Gross (${site}): $${gross.toFixed(2)}`;
                  }
                  return ` Net (${site}): $${ctx.parsed.y.toFixed(2)}`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 13 } } },
            y: {
              type: 'logarithmic',
              min: 1,
              ticks: {
                font: { size: 12 },
                callback: v => [1, 10, 100, 1000, 10000].includes(v) ? '$' + v.toLocaleString() : '',
              },
            },
          },
        },
      });
    },

  }));
});
