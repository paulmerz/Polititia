// The hemicycle rankings of the Assemblée tab (« Palmarès de l'hémicycle »).
// Counts come from Analytics; this file only orders them.

// Same camps as asides.CAMPS: the electoral alliances of June 2024. DR, LIOT
// and the non-inscrits each form their own.
export const CAMPS: Record<string, string> = {
  LFI_NFP: "NFP",
  SOC: "NFP",
  EcoS: "NFP",
  GDR: "NFP",
  EPR: "Ensemble",
  Dem: "Ensemble",
  HOR: "Ensemble",
  RN: "RN-UDR",
  UDR: "RN-UDR",
  DR: "DR",
  LIOT: "LIOT",
  NI: "NI",
};
// Left to right. Non-inscrits are not a camp: applause from anyone else would
// all count as « another camp ».
export const CAMP_ORDER = ["NFP", "LIOT", "Ensemble", "DR", "RN-UDR"] as const;
export const LEADERS = 10;
export const CAMP_LEADERS = 3;
// A group is ranked on the applause it gives once it has given this many.
export const GIVER_MIN_APPLAUSE = 20;

export type Contender = { pid: number; sittings: number; count: number };
export type Leader = Contender & { perSitting: number };
export type Leaders = { perSitting: Leader[]; total: Leader[] };

// The same deputies ordered two ways: per sitting of presence, and in all.
export function leaders(rows: Contender[], limit = LEADERS): Leaders {
  const counted = rows.filter((row) => row.count > 0 && row.sittings > 0).map((row) => ({ ...row, perSitting: row.count / row.sittings }));
  return {
    perSitting: [...counted].sort((a, b) => b.perSitting - a.perSitting || b.count - a.count || a.pid - b.pid).slice(0, limit),
    total: [...counted].sort((a, b) => b.count - a.count || b.perSitting - a.perSitting || a.pid - b.pid).slice(0, limit),
  };
}

export type ApplauseCell = { groups: string; party: string; n: number };
export type Giver = { party: string; given: number; toOtherCamps: number; toOtherGroups: number; share: number };

// For each group, the applause it gave to deputies, and how much went to
// another camp (and to another group, allies included). « groups » lists the
// applauding groups of one applause, comma-separated.
export function applauseGivers(cells: ApplauseCell[], minimum = GIVER_MIN_APPLAUSE): Giver[] {
  const givers = new Map<string, { given: number; toOtherCamps: number; toOtherGroups: number }>();
  for (const cell of cells) {
    for (const group of new Set(cell.groups.split(",").filter(Boolean))) {
      if (!CAMPS[group] || group === "NI") {
        continue;
      }
      const giver = givers.get(group) || { given: 0, toOtherCamps: 0, toOtherGroups: 0 };
      giver.given += cell.n;
      if (cell.party !== group) {
        giver.toOtherGroups += cell.n;
      }
      if (CAMPS[cell.party] !== CAMPS[group]) {
        giver.toOtherCamps += cell.n;
      }
      givers.set(group, giver);
    }
  }
  return [...givers]
    .filter(([, giver]) => giver.given >= minimum)
    .map(([party, giver]) => ({ party, ...giver, share: giver.toOtherCamps / giver.given }))
    .sort((a, b) => b.share - a.share || b.toOtherCamps - a.toOtherCamps || a.party.localeCompare(b.party));
}
