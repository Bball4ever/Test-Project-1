// A human holding the chalk: turns pointer input into finished strokes.
//
// Pointer Events cover mouse, trackpad, touch and pen with one set of events.
// Every finger on a touchscreen gets its own pointerId, so several strokes can be
// in progress at once (we'll need that for two players on one screen).

export class HumanController {
  // element: the canvas to listen on
  // onStroke({ owner, pointerType, points }) is called when a stroke is finished
  constructor(element, { owner = 'player', onStroke }) {
    this.element = element;
    this.owner = owner;
    this.onStroke = onStroke;
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
    if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
    e.preventDefault();
    // Keep getting this pointer's events even if it slides off the canvas.
    this.element.setPointerCapture(e.pointerId);
    const stroke = { owner: this.owner, pointerType: e.pointerType, seed: Math.floor(e.timeStamp * 1000), points: [] };
    this.active.set(e.pointerId, stroke);
    this.addPoint(stroke, e);
  }

  move(e) {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    // The browser may bundle several samples into one event to save work.
    // Unpacking them gives smoother, more accurate strokes.
    const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const s of samples.length ? samples : [e]) this.addPoint(stroke, s);
  }

  up(e) {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    this.active.delete(e.pointerId);
    this.addPoint(stroke, e);
    this.onStroke(stroke);
  }

  addPoint(stroke, e) {
    const rect = this.element.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
    const last = stroke.points[stroke.points.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    stroke.points.push(p);
  }
}
