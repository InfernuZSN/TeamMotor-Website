/* Money + VAT maths. The SAME rules are mirrored in public/js/mock-data.js (Utils.computeTotals)
   so the POS preview always matches what the server stores. Server is authoritative. */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* subtotal: sum of line totals (peso). discount: peso amount already validated (0..subtotal).
   settings: { vatEnabled, vatRate (0.12), vatMode: 'inclusive' | 'exclusive' }

   inclusive (default in PH retail): shelf prices already contain VAT.
        total = subtotal - discount;  vat = total * r / (1 + r);  vatable = total - vat
   exclusive: VAT is added on top of the discounted subtotal.
        vatable = subtotal - discount;  vat = vatable * r;        total = vatable + vat
   VAT disabled: total = subtotal - discount, vat = 0 */
function computeTotals(subtotal, discount, settings) {
  const sub = round2(subtotal);
  const disc = round2(Math.max(0, Math.min(Number(discount) || 0, sub)));
  const net = round2(sub - disc);
  const enabled = !!(settings && settings.vatEnabled);
  const r = enabled ? Number(settings.vatRate) || 0 : 0;
  if (!enabled || r <= 0) {
    return { subtotal: sub, discount: disc, vatableAmount: net, vatAmount: 0, total: net, vatRate: r, vatMode: 'inclusive', vatEnabled: false };
  }
  if (settings.vatMode === 'exclusive') {
    const vat = round2(net * r);
    return { subtotal: sub, discount: disc, vatableAmount: net, vatAmount: vat, total: round2(net + vat), vatRate: r, vatMode: 'exclusive', vatEnabled: true };
  }
  const vat = round2(net * r / (1 + r));
  return { subtotal: sub, discount: disc, vatableAmount: round2(net - vat), vatAmount: vat, total: net, vatRate: r, vatMode: 'inclusive', vatEnabled: true };
}

module.exports = { round2, computeTotals };
