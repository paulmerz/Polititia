// A share as a French percentage. 99.65 % is not "100 %" and 0.3 % is not
// "0 %": a share that is not whole keeps up to two more decimals rather than
// look whole. dashboard/app.js (fmtPct) follows the same rule.
const MAX_EXTRA_DIGITS = 2;

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function percentText(share: number, digits = 0): string {
  const pct = Number(share || 0) * 100;
  let places = digits;
  const looksWhole = (shown: number) => (pct < 100 && shown >= 100) || (pct > 0 && shown <= 0);
  while (places < digits + MAX_EXTRA_DIGITS && looksWhole(round(pct, places))) {
    places += 1;
  }
  let shown = round(pct, places);
  if (pct < 100 && shown >= 100) {
    shown = 100 - 10 ** -places;
  } else if (pct > 0 && shown <= 0) {
    shown = 10 ** -places;
  }
  return `${shown.toLocaleString("fr-FR", { maximumFractionDigits: places })} %`;
}
