// A human holding the chalk: turns pointer input into finished strokes.
//
// Pointer Events cover mouse, trackpad, touch and pen with one set of events.
// Every finger on a touchscreen gets its own pointerId, so several strokes can be
// in progress at once (we'll need that for two players on one screen).

export class HumanController {
  // element: the canvas to listen on
  // onBegin(stroke) is called when a stroke starts (optional)
  // onStroke({ owner, pointerType, points }) is called when a stroke is finished
  // toWorld(clientX, clientY) turns a screen position into a board position
  // owner: a side ('left'/'right'), or a function (point) => side, so that on a
  //        shared touchscreen each stroke belongs to whichever half it starts in
  constructor(element, { owner = 'left', onBegin = () => {}, onStroke, toWorld }) {
    this.element = element;
    this.owner = owner;
    this.onBegin = onBegin;
    this.onStroke = onStroke;
    this.toWorld = toWorld;
    this.enabled = true;
    this.active = new Map(); // pointerId → stroke in progress

    element.addEventListener('pointerdown', (e) => this.down(e));
    element.addEventListener('pointermove', (e) => this.move(e));
    element.addEventListener('pointerup', (e) => this.up(e));
    element.addEventListener('pointercancel', (e) => this.up(e));
  }

  // Strokes still being drawn, so the renderer can show them live.
  liveStrokes() {
    return [...this.active.values()];
  }

  down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
    e.preventDefault();
    // Keep getting this pointer's events even if it slides off the canvas.
    this.element.setPointerCapture(e.pointerId);
    const start = this.toWorld(e.clientX, e.clientY);
    const owner = typeof this.owner === 'function' ? this.owner(start) : this.owner;
    if (!owner) return;
    const stroke = { owner, pointerType: e.pointerType, seed: Math.floor(e.timeStamp * 1000), points: [] };
    this.active.set(e.pointerId, stroke);
    this.addPoint(stroke, e);
    this.onBegin(stroke);
  }

  move(e) {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    // The browser may bundle several samples into one event to save work.
    // Unpacking them gives smoother, more accurate strokes.
    const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const s of samples.length ? samples : [e]) this.addPoint(stroke, s);
  }

  // Drop any strokes in progress (used when a duel ends or restarts).
  cancelAll() {
    this.active.clear();
  }

  up(e) {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    this.active.delete(e.pointerId);
    this.addPoint(stroke, e);
    this.onStroke(stroke);
  }

  addPoint(stroke, e) {
    const { x, y } = this.toWorld(e.clientX, e.clientY);
    const p = { x, y, t: e.timeStamp };
    const last = stroke.points[stroke.points.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    stroke.points.push(p);
  }
}
