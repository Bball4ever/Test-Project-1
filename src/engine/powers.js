// Chalkling powers. While making a chalkling, the duelist picks one or more
// powers with the buttons. The DETAIL in the creature's drawing sets the power
// level, and that level is shared out: one power gets all of it, two powers
// get half each, three get a third each, and so on.
//
//   sword      bites harder
//   bow        shoots arrows at enemy chalklings
//   shield     takes less damage
//   wings      flies over walls, and a bit faster
//   crown      nearby friends bite harder
//   healer     heals itself and nearby friends
//   whirlwind  much faster

import { distance } from '../recognizer/clean.js';
import { damageChalkling, emit } from './damage.js';

export const POWERS = ['sword', 'bow', 'shield', 'wings', 'crown', 'healer', 'whirlwind'];

export const POWER_NAMES = {
  sword: 'Sword',
  bow: 'Bow',
  shield: 'Shield',
  wings: 'Wings',
  crown: 'Crown',
  healer: 'Healer',
  whirlwind: 'Whirlwind',
};

// The total power level, from the creature's detail (rounded to 0.1).
export function powerLevel(detail, pc) {
  const level = Math.max(pc.minLevel, Math.min(pc.maxLevel, detail / pc.detailPerLevel));
  return Math.round(level * 10) / 10;
}

// A clean list of powers: real ones only, no repeats.
export function cleanPowers(list) {
  if (typeof list === 'string') list = [list];
  if (!Array.isArray(list)) return [];
  return POWERS.filter((p) => list.includes(p));
}

// How strong one of this chalkling's powers is: its share of the total level
// (0 if it doesn't have that power).
export function levelOf(c, power) {
  const n = c.powers?.length ?? 0;
  return n && c.powers.includes(power) ? c.powerLevel / n : 0;
}

// Power effects that change a new chalkling's stats.
export function applyPowerStats(c, pc) {
  c.bite *= 1 + pc.swordBite * levelOf(c, 'sword');
  c.speed *= 1 + pc.wingSpeed * levelOf(c, 'wings');
  c.speed *= 1 + pc.whirlwindSpeed * levelOf(c, 'whirlwind');
}

export function flies(c) {
  return !!c.powers?.includes('wings');
}

// A chalkling's bite right now, including a nearby friend's crown (the strongest one).
export function biteOf(state, c) {
  const pc = state.powerCfg;
  let best = 1;
  for (const k of state.chalklings) {
    const L = levelOf(k, 'crown');
    if (k === c || k.owner !== c.owner || k.gone || !L) continue;
    if (distance(k.pos, c.pos) <= pc.crownRange + pc.crownRangePerLevel * L) best = Math.max(best, 1 + pc.crownBite * L);
  }
  return c.bite * best;
}

// Powers that act on their own every moment: healing and shooting arrows.
export function usePower(state, c, dt) {
  const pc = state.powerCfg;
  const heal = levelOf(c, 'healer');
  if (heal) {
    for (const friend of state.chalklings) {
      if (friend.owner === c.owner && !friend.gone && distance(friend.pos, c.pos) <= pc.healRange) {
        friend.hp = Math.min(friend.max, friend.hp + pc.healPerSecond * heal * dt);
      }
    }
  }
  const bow = levelOf(c, 'bow');
  if (bow) {
    c.bowCooldown = (c.bowCooldown ?? 0) - dt * 1000;
    if (c.bowCooldown > 0) return;
    const range = pc.bowRange + pc.bowRangePerLevel * bow;
    let target = null;
    let best = Infinity;
    for (const e of state.chalklings) {
      if (e.owner === c.owner || e.gone) continue;
      const d = distance(e.pos, c.pos);
      if (d <= range && d < best) {
        best = d;
        target = e;
      }
    }
    if (!target) return;
    c.bowCooldown = pc.bowEveryMs;
    emit(state, { type: 'arrow', owner: c.owner, from: { ...c.pos }, to: { ...target.pos } });
    damageChalkling(state, target, pc.arrowDamage * bow);
  }
}
