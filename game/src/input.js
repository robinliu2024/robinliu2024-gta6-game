// Solmar Heat — input: keyboard + mouse-look state.
// Singleton: tracks held keys, edge-pressed keys, mouse deltas and clicks.
// No DOM game logic lives here; gameplay modules read this object each frame.

const KEY_ALIASES = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'handbrake',
  KeyE: 'enter',
  KeyQ: 'punch', KeyF: 'punch',
  KeyP: 'pause', Escape: 'pause',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Digit4: 'weapon4',
  KeyR: 'reload',
  KeyG: 'garage', // v2: open the Solmar Garage panel
  KeyC: 'radio',  // v2: cycle the radio stations
  KeyK: 'crew',   // v3: open the crew recruit panel
  KeyB: 'shop',   // v3: open the Solmar Arms shop panel (near a shop)
  KeyT: 'travel', // v3: fast-travel between safehouses (at a safehouse)
};

class Input {
  constructor() {
    this.held = {};          // action -> boolean, true while key down
    this.pressed = {};       // action -> boolean, true only on the frame it went down
    this.mouseDX = 0;        // accumulated pointer movement since last consume
    this.mouseDY = 0;
    this.mouseDown = false;  // left button held (shoot)
    this.mouseClicked = false; // left button pressed this frame
    this.wheelDelta = 0;     // accumulated wheel steps since last consume
    this.pointerLocked = false;
    this.onPause = null;     // callback assigned by main.js
    this._listeners = [];
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._attach();
  }

  _attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  _onKeyDown(e) {
    const action = KEY_ALIASES[e.code];
    if (!action) return;
    if (['up', 'down', 'left', 'right', 'handbrake'].includes(action)) e.preventDefault();
    if (!this.held[action]) this.pressed[action] = true;
    this.held[action] = true;
    if (action === 'pause' && this.pressed[action] && this.onPause) this.onPause();
  }

  _onKeyUp(e) {
    const action = KEY_ALIASES[e.code];
    if (action) this.held[action] = false;
  }

  _onMouseMove(e) {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX || 0;
    this.mouseDY += e.movementY || 0;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this.mouseDown = true;
    this.mouseClicked = true;
  }

  _onMouseUp(e) {
    if (e.button === 0) this.mouseDown = false;
  }

  _onWheel(e) {
    // One weapon step per wheel notch, either direction.
    if (!e.deltaY) return;
    this.wheelDelta += e.deltaY > 0 ? 1 : -1;
  }

  _onLockChange() {
    this.pointerLocked = document.pointerLockElement === document.body
      || document.pointerLockElement === document.getElementById('game-canvas');
  }

  // Ask the browser to capture the mouse for look control. Safe no-op if it fails.
  requestPointerLock() {
    try {
      const el = document.getElementById('game-canvas') || document.body;
      el.requestPointerLock?.();
    } catch { /* pointer lock unavailable */ }
  }

  // Movement axes in -1..1, from held keys.
  axes() {
    const x = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    const y = (this.held.up ? 1 : 0) - (this.held.down ? 1 : 0);
    return { x, y };
  }

  get sprinting() { return !!this.held.sprint; }

  // Consume this frame's mouse delta (call once per frame from the camera code).
  consumeMouseDelta() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  // Consume accumulated wheel steps (call once per frame): +1 = next weapon,
  // -1 = previous weapon, 0 = no wheel movement this frame.
  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  // True once, on the frame the action key went down.
  wasPressed(action) { return !!this.pressed[action]; }

  // Call at the end of each frame so edge presses only fire once.
  endFrame() {
    this.pressed = {};
    this.mouseClicked = false;
    this.wheelDelta = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

export const input = new Input();
export default input;
