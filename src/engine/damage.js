// Damage rules shared by everything that can hurt a line: Vigors and chalklings.

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
    if (!state.winner) {
      state.winner = otherSide(ward.owner);
      emit(state, { type: 'breach', owner: ward.owner, wardId: ward.id, section: index, point });
    }
  } else {
    ward.gone = true;
    emit(state, { type: 'shieldBroken', owner: ward.owner, wardId: ward.id, point });
  }
}

export function damageWall(state, wall, amount, point) {
  wall.health = Math.max(0, wall.health - amount);
  if (wall.health <= 0 && !wall.gone) {
    wall.gone = true;
    emit(state, { type: 'wallBroken', owner: wall.owner, id: wall.id, point });
  }
}

export function damageChalkling(state, c, amount) {
  c.hp = Math.max(0, c.hp - amount);
  if (c.hp <= 0 && !c.gone) {
    c.gone = true;
    emit(state, { type: 'chalklingDied', owner: c.owner, id: c.id, point: { ...c.pos } });
  }
}
