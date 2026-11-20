// input.js — keyboard + mouse. Held keys are read every frame; one-shot presses
// (enter car, punch, pause, mute) are queued as flags and taken once by the loop.

export const ACTION_ENTER = 1;
export const ACTION_PUNCH = 2;
export const ACTION_PAUSE = 4;
export const ACTION_MUTE = 8;
export const ACTION_SHOOT = 16;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const BRAKE = new Set(['Space']);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let mouseDX = 0;
  let mouseDY = 0;
  let mouseDown = false;
  let pointerLocked = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'KeyE') actions |= ACTION_ENTER;
    else if (event.code === 'KeyQ') actions |= ACTION_PUNCH;
    else if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACTION_PAUSE;
    else if (event.code === 'KeyM') actions |= ACTION_MUTE;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousedown', (event) => {
    mouseDown = true;
    if (event.button === 0) actions |= ACTION_SHOOT;
    // Clicking the canvas grabs the pointer for mouse-look (desktop Chrome).
    if (!pointerLocked && canvas.requestPointerLock) {
      try { canvas.requestPointerLock(); } catch { /* pointer lock is a nicety, not a need */ }
    }
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (event) => {
    if (pointerLocked) {
      mouseDX += event.movementX || 0;
      mouseDY += event.movementY || 0;
    } else if (dragging) {
      mouseDX += event.clientX - lastX;
      mouseDY += event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
    }
  });
  // Drag-to-look fallback when pointer lock is unavailable (headless shots).
  canvas.addEventListener('mousedown', (event) => { dragging = true; lastX = event.clientX; lastY = event.clientY; });
  window.addEventListener('mouseup', () => { dragging = false; });

  return {
    /** -1..1 forward/back and left/right from held keys. */
    move() {
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      return { forward: f, strafe: s, sprint: [...SPRINT].some((k) => keys.has(k)), brake: [...BRAKE].some((k) => keys.has(k)) };
    },
    isDown(code) { return keys.has(code); },
    mouseDown() { return mouseDown; },
    /** Mouse-look deltas since the last call (pixels). */
    takeMouse() {
      const d = { dx: mouseDX, dy: mouseDY };
      mouseDX = 0; mouseDY = 0;
      return d;
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Test/driver hook: pretend a key is held (used by the shot autopilot). */
    inject(code, down) { if (down) keys.add(code); else keys.delete(code); },
    pressAction(flag) { actions |= flag; },
  };
}
