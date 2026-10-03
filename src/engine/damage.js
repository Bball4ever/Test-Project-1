// Damage rules shared by everything that can hurt a line: Vigors and chalklings.

// In a 2-player duel, the other duelist.
export function otherSide(side) {
  return side === 'left' ? 'right' : 'left';
}

export function emit(state, event) {
  state.events.push({ ...event, tick: state.tick });
}

// Damage one section of a circle. Breaking a main circle's section is a breach;
// breaking a smaller circle's section destroys that circle.
export function damageSection(state, ward, index, amount, point) {
  const section = ward.sections[index];
  section.health = Math.max(0, section.health - amount);
  if (section.health > 0 || ward.gone) return;
  if (ward.main) {
    if (!state.winner && !state.out.includes(ward.owner)) {
      emit(state, { type: 'breach', owner: ward.owner, wardId: ward.id, section: index, point });
      knockOut(state, ward.owner);
    }
  } else {
    ward.gone = true;
    emit(state, { type: 'shieldBroken', owner: ward.owner, wardId: ward.id, point });
  }
}

// A breached duelist is out. When only one is left, they've won. Until then,
// everything the breached duelist drew is wiped off the board.
export function knockOut(state, owner) {
  state.out.push(owner);
  const alive = state.players.filter((id) => !state.out.includes(id));
  emit(state, { type: 'out', owner, place: alive.length + 1, point: { ...state.homes[owner] } });
  if (alive.length === 1) {
    state.winner = alive[0];
    return;
  }
  for (const list of [state.wards, state.walls, state.vigors, state.chalklings, state.chains, state.paths]) {
    for (const thing of list) if (thing.owner === owner) thing.gone = true;
  }
  state.chains = state.chains.filter((c) => c.owner !== owner);
  state.paths = state.paths.filter((p) => p.owner !== owner);
  state.erasing[owner] = null;
}

export function damageWall(state, wall, amount, point) {
  wall.health = Math.max(0, wall.health - amount);
  if (wall.health <= 0 && !wall.gone) {
    wall.gone = true;
    emit(state, { type: 'wallBroken', owner: wall.owner, id: wall.id, point });
  }
}

export function damageChalkling(state, c, amount) {
  // A shield takes some of it (stronger shields take more). Its strength is
  // its share of the power level (see powers.js; worked out here to avoid a
  // circular import).
  const n = c.powers?.length ?? 0;
  if (n && c.powers.includes('shield')) amount /= 1 + (state.powerCfg.shieldBlock * c.powerLevel) / n;
  c.hp = Math.max(0, c.hp - amount);
  if (c.hp <= 0 && !c.gone) {
    c.gone = true;
    emit(state, { type: 'chalklingDied', owner: c.owner, id: c.id, point: { ...c.pos } });
  }
}
