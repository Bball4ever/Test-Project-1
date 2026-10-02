// Chalkling powers. While making a chalkling, the duelist picks one power with
// a button. The chalk spent drawing the creature sets the power's level: more
// chalk, stronger power.
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

// How strong a power is, from the chalk spent on the creature (rounded to 0.1).
export function powerLevel(ink, pc) {
  const level = Math.max(pc.minLevel, Math.min(pc.maxLevel, ink / pc.chalkPerLevel));
  return Math.round(level * 10) / 10;
}

// Power effects that change a new chalkling's stats.
export function applyPowerStats(c, pc) {
  const L = c.powerLevel;
  if (c.power === 'sword') c.bite *= 1 + pc.swordBite * L;
  if (c.power === 'wings') c.speed *= 1 + pc.wingSpeed * L;
  if (c.power === 'whirlwind') c.speed *= 1 + pc.whirlwindSpeed * L;
}

export function flies(c) {
  return c.power === 'wings';
}

// A chalkling's bite right now, including a nearby friend's crown (the strongest one).
export function biteOf(state, c) {
  const pc = state.powerCfg;
  let best = 1;
  for (const k of state.chalklings) {
    if (k === c || k.owner !== c.owner || k.gone || k.power !== 'crown') continue;
    if (distance(k.pos, c.pos) <= pc.crownRange + pc.crownRangePerLevel * k.powerLevel) best = Math.max(best, 1 + pc.crownBite * k.powerLevel);
  }
  return c.bite * best;
}

// Powers that act on their own every moment: healing and shooting arrows.
export function usePower(state, c, dt) {
  const pc = state.powerCfg;
  if (c.power === 'healer') {
    for (const friend of state.chalklings) {
      if (friend.owner === c.owner && !friend.gone && distance(friend.pos, c.pos) <= pc.healRange) {
        friend.hp = Math.min(friend.max, friend.hp + pc.healPerSecond * c.powerLevel * dt);
      }
    }
  }
  if (c.power === 'bow') {
    c.bowCooldown = (c.bowCooldown ?? 0) - dt * 1000;
    if (c.bowCooldown > 0) return;
    const range = pc.bowRange + pc.bowRangePerLevel * c.powerLevel;
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
    damageChalkling(state, target, pc.arrowDamage * c.powerLevel);
  }
}
