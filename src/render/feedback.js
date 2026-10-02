// Words shown on the board: what a stroke was recognized as, or why it failed.

export const NAMES = {
  warding: 'Warding',
  forbiddance: 'Forbiddance',
  vigor: 'Vigor',
};

export function labelText(result) {
  const pct = `${Math.round(result.quality * 100)}%`;
  if (result.type !== 'dud') return `${NAMES[result.type]} ${pct}`;
  return result.quality > 0 ? `${result.reason} (${pct})` : result.reason;
}
