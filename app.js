const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const flashLayer = document.getElementById("flashLayer");
const statusTitle = document.getElementById("statusTitle");
const scoreLabel = document.getElementById("scoreLabel");
const livesLabel = document.getElementById("livesLabel");
const stageLabel = document.getElementById("stageLabel");
const messageLabel = document.getElementById("messageLabel");
const launchBtn = document.getElementById("launchBtn");
const resetBtn = document.getElementById("resetBtn");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BRICK_ROWS = 5;
const BRICK_COLS = 8;
const BAND_NUDGE = 22;
const DRAG_SCALE = 1.2;
const CONTROL_SMOOTHING = 0.42;
const TAP_MAX_MOVEMENT = 14;
const TAP_MAX_TIME = 520;

const themes = [
  { name: "Glass Garden", a: "rgba(100, 210, 255, 0.22)", b: "rgba(48, 209, 88, 0.18)", c: "rgba(10, 132, 255, 0.2)", hue: 190 },
  { name: "Neon Arcade", a: "rgba(255, 45, 85, 0.24)", b: "rgba(191, 90, 242, 0.22)", c: "rgba(100, 210, 255, 0.16)", hue: 314 },
  { name: "Space Wall", a: "rgba(94, 92, 230, 0.24)", b: "rgba(10, 132, 255, 0.18)", c: "rgba(255, 214, 10, 0.12)", hue: 232 },
  { name: "Ocean Glass", a: "rgba(90, 200, 250, 0.24)", b: "rgba(0, 199, 190, 0.2)", c: "rgba(48, 209, 88, 0.14)", hue: 178 },
  { name: "Lava Core", a: "rgba(255, 69, 58, 0.26)", b: "rgba(255, 159, 10, 0.24)", c: "rgba(255, 214, 10, 0.14)", hue: 22 }
];
const powerTypes = ["wide", "slow", "multi", "shield", "laser", "pierce"];
const audio = { context: null, enabled: true };
const band = {
  lastActionAt: 0,
  repeatMs: 32,
  heldDirection: 0,
  heldUntil: 0
};

const state = {
  score: 0, lives: 3, stage: 1, running: false, gameOver: false,
  paddle: { x: WIDTH / 2 - 48, y: HEIGHT - 34, w: 96, h: 13, targetX: WIDTH / 2 - 48, wideTimer: 0, laserTimer: 0 },
  balls: [], bricks: [], particles: [], powerUps: [], lasers: [], shield: 0, pierceTimer: 0, pointerStart: null, pointerLastX: null, pointerId: null
};

function theme() { return themes[(state.stage - 1) % themes.length]; }
function applyTheme() {
  const active = theme();
  document.body.style.setProperty("--theme-a", active.a);
  document.body.style.setProperty("--theme-b", active.b);
  document.body.style.setProperty("--theme-c", active.c);
}
function getAudioContext() {
  if (!audio.enabled) return null;
  if (!audio.context) audio.context = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.context.state === "suspended") audio.context.resume();
  return audio.context;
}
function tone(freq, duration = 0.08, type = "sine", volume = 0.06, slideTo = null) {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, now);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}
function sound(name) {
  const sounds = {
    launch: () => tone(420, 0.09, "triangle", 0.045, 740),
    wall: () => tone(520, 0.035, "square", 0.02, 650),
    paddle: () => tone(250, 0.055, "triangle", 0.045, 430),
    smash: () => { tone(760, 0.055, "square", 0.04, 420); setTimeout(() => tone(1180, 0.06, "triangle", 0.025, 620), 35); },
    power: () => [660, 990, 1320].forEach((note, i) => setTimeout(() => tone(note, 0.08, "triangle", 0.04), i * 48)),
    laser: () => tone(980, 0.07, "sawtooth", 0.035, 1480),
    nudge: () => tone(360, 0.035, "square", 0.018, 520),
    lose: () => tone(180, 0.18, "sawtooth", 0.06, 70),
    win: () => [523, 659, 784, 1046].forEach((note, i) => setTimeout(() => tone(note, 0.11, "triangle", 0.04), i * 55))
  };
  sounds[name]?.();
}
function setMessage(text) { messageLabel.textContent = text; }
function syncLabels() {
  scoreLabel.textContent = state.score;
  livesLabel.textContent = state.lives;
  stageLabel.textContent = state.stage;
  statusTitle.textContent = state.gameOver ? "Game Over" : theme().name;
}
function createBricks() {
  state.bricks = [];
  const padding = 12, gap = 7, top = 26;
  const brickW = (WIDTH - padding * 2 - gap * (BRICK_COLS - 1)) / BRICK_COLS;
  const brickH = 22;
  const activeTheme = theme();
  for (let row = 0; row < BRICK_ROWS; row += 1) {
    for (let col = 0; col < BRICK_COLS; col += 1) {
      const strong = row < 2 && state.stage > 1;
      const power = Math.random() < 0.22 ? powerTypes[Math.floor(Math.random() * powerTypes.length)] : null;
      state.bricks.push({ x: padding + col * (brickW + gap), y: top + row * (brickH + gap), w: brickW, h: brickH, hp: strong ? 2 : 1, maxHp: strong ? 2 : 1, power, hue: activeTheme.hue + row * 18 + col * 5 });
    }
  }
}
function makeBall(stuck = true, angle = -Math.PI / 2) {
  const speed = 5.1 + state.stage * 0.25;
  return { x: state.paddle.x + state.paddle.w / 2, y: state.paddle.y - 14, r: 7, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, speed, stuck };
}
function resetBall() { state.balls = [makeBall(true)]; }
function resetGame(full = true) {
  if (full) { state.score = 0; state.lives = 3; state.stage = 1; state.gameOver = false; }
  applyTheme();
  state.running = true;
  state.paddle.x = WIDTH / 2 - 48; state.paddle.targetX = state.paddle.x; state.paddle.w = 96; state.paddle.wideTimer = 0; state.paddle.laserTimer = 0;
  state.powerUps = []; state.particles = []; state.lasers = []; state.shield = 0; state.pierceTimer = 0;
  createBricks(); resetBall(); setMessage("Band: slide aim. Pinch launch."); syncLabels();
}
function action() {
  if (state.gameOver) { resetGame(true); return; }
  const stuckBalls = state.balls.filter((ball) => ball.stuck);
  if (stuckBalls.length > 0) {
    stuckBalls.forEach((ball, i) => { ball.stuck = false; ball.vx = (i - 0.5) * 2.4; ball.vy = -ball.speed; });
    setMessage("Launched."); sound("launch"); return;
  }
  if (state.paddle.laserTimer > 0) { fireLaser(); return; }
  setMessage("Slide to aim.");
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function nudgePaddle(direction, amount = BAND_NUDGE) {
  state.paddle.targetX = clamp(
    state.paddle.targetX + direction * amount,
    6,
    WIDTH - state.paddle.w - 6
  );

  if (state.balls.some((ball) => ball.stuck)) {
    state.paddle.x += (state.paddle.targetX - state.paddle.x) * 0.75;
  }
}
function movePaddleTo(clientX) {
  const rect = canvas.getBoundingClientRect();
  const scale = WIDTH / rect.width;
  const x = (clientX - rect.left) * scale;

  state.paddle.targetX = clamp(x - state.paddle.w / 2, 6, WIDTH - state.paddle.w - 6);
}
function movePaddleBy(deltaX) {
  state.paddle.targetX = clamp(
    state.paddle.targetX + deltaX * DRAG_SCALE,
    6,
    WIDTH - state.paddle.w - 6
  );
}
function burst(x, y, color, amount = 14) {
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 3.4;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 26 + Math.random() * 16, maxLife: 42, size: 2 + Math.random() * 4, color });
  }
}
function flash() { flashLayer.classList.remove("flash"); void flashLayer.offsetWidth; flashLayer.classList.add("flash"); }
function spawnPowerUp(brick) {
  if (!brick.power) return;
  state.powerUps.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, r: 9, vy: 1.7, type: brick.power });
}
function smashBrick(brick, force = false) {
  if (brick.hp <= 0) return;
  brick.hp = force ? 0 : brick.hp - 1;
  const color = `hsl(${brick.hue}, 94%, 64%)`;
  burst(brick.x + brick.w / 2, brick.y + brick.h / 2, color, brick.hp <= 0 ? 22 : 10);
  flash(); sound("smash");
  if (brick.hp <= 0) { state.score += 50; spawnPowerUp(brick); } else state.score += 15;
  syncLabels();
}
function applyPower(type) {
  const messages = { wide: "Wide paddle.", slow: "Ball slowed.", multi: "Multi ball.", shield: "Shield floor.", laser: "Laser armed. Pinch fire.", pierce: "Pierce ball." };
  if (type === "wide") { state.paddle.w = 134; state.paddle.wideTimer = 720; }
  if (type === "slow") state.balls.forEach((ball) => { ball.vx *= 0.82; ball.vy *= 0.82; });
  if (type === "multi") {
    const live = state.balls[0] || makeBall(false);
    state.balls.push({ ...live, vx: -Math.abs(live.speed * 0.75), vy: -Math.abs(live.speed * 0.65), stuck: false }, { ...live, vx: Math.abs(live.speed * 0.75), vy: -Math.abs(live.speed * 0.65), stuck: false });
  }
  if (type === "shield") state.shield = 1;
  if (type === "laser") state.paddle.laserTimer = 620;
  if (type === "pierce") state.pierceTimer = 520;
  setMessage(messages[type]); sound("power"); syncLabels();
}
function circleRectCollision(ball, rect) {
  const nearestX = clamp(ball.x, rect.x, rect.x + rect.w);
  const nearestY = clamp(ball.y, rect.y, rect.y + rect.h);
  const dx = ball.x - nearestX, dy = ball.y - nearestY;
  return dx * dx + dy * dy <= ball.r * ball.r;
}
function updateBall(ball) {
  if (ball.stuck) { ball.x = state.paddle.x + state.paddle.w / 2; ball.y = state.paddle.y - 14; return true; }
  ball.x += ball.vx; ball.y += ball.vy;
  if (ball.x - ball.r <= 0 || ball.x + ball.r >= WIDTH) { ball.vx *= -1; ball.x = clamp(ball.x, ball.r, WIDTH - ball.r); sound("wall"); }
  if (ball.y - ball.r <= 0) { ball.vy *= -1; ball.y = ball.r; sound("wall"); }
  if (circleRectCollision(ball, state.paddle) && ball.vy > 0) {
    const hit = (ball.x - (state.paddle.x + state.paddle.w / 2)) / (state.paddle.w / 2);
    ball.vx = hit * ball.speed;
    ball.vy = -Math.sqrt(Math.max(8, ball.speed ** 2 - ball.vx ** 2));
    ball.y = state.paddle.y - ball.r - 1; sound("paddle");
  }
  for (const brick of state.bricks) {
    if (brick.hp <= 0) continue;
    if (!circleRectCollision(ball, brick)) continue;
    smashBrick(brick, state.pierceTimer > 0);
    if (state.pierceTimer <= 0) {
      const fromLeft = Math.abs((ball.x + ball.r) - brick.x);
      const fromRight = Math.abs(ball.x - ball.r - (brick.x + brick.w));
      const fromTop = Math.abs((ball.y + ball.r) - brick.y);
      const fromBottom = Math.abs(ball.y - ball.r - (brick.y + brick.h));
      const min = Math.min(fromLeft, fromRight, fromTop, fromBottom);
      if (min === fromLeft || min === fromRight) ball.vx *= -1; else ball.vy *= -1;
    }
    break;
  }
  if (ball.y - ball.r > HEIGHT) {
    if (state.shield > 0) { state.shield -= 1; ball.y = HEIGHT - 10; ball.vy = -Math.abs(ball.vy); setMessage("Shield saved it."); sound("paddle"); return true; }
    return false;
  }
  return true;
}
function updateBalls() {
  state.balls = state.balls.filter(updateBall);
  if (state.balls.length > 0) return;
  state.lives -= 1; sound("lose");
  if (state.lives <= 0) { state.gameOver = true; setMessage("Game over. Pinch reset."); syncLabels(); return; }
  setMessage("Ball lost. Pinch launch."); resetBall(); syncLabels();
}
function fireLaser() {
  state.lasers.push({ x: state.paddle.x + 18, y: state.paddle.y - 6, vy: -8 }, { x: state.paddle.x + state.paddle.w - 18, y: state.paddle.y - 6, vy: -8 });
  sound("laser"); setMessage("Laser fired.");
}
function updateLasers() {
  state.lasers = state.lasers.filter((laser) => {
    laser.y += laser.vy;
    for (const brick of state.bricks) {
      if (brick.hp <= 0) continue;
      const hit = laser.x >= brick.x && laser.x <= brick.x + brick.w && laser.y >= brick.y && laser.y <= brick.y + brick.h;
      if (hit) { smashBrick(brick, true); return false; }
    }
    return laser.y > -20;
  });
}
function updatePowerUps() {
  state.powerUps = state.powerUps.filter((powerUp) => {
    powerUp.y += powerUp.vy;
    const caught = circleRectCollision({ x: powerUp.x, y: powerUp.y, r: powerUp.r }, state.paddle);
    if (caught) { applyPower(powerUp.type); return false; }
    return powerUp.y < HEIGHT + 20;
  });
}
function updateParticles() {
  state.particles = state.particles.filter((particle) => { particle.x += particle.vx; particle.y += particle.vy; particle.vy += 0.04; particle.life -= 1; return particle.life > 0; });
}
function checkStageClear() {
  if (state.bricks.some((brick) => brick.hp > 0)) return;
  state.stage += 1; state.score += 500; sound("win"); setMessage("Stage clear. New wall."); applyTheme(); createBricks(); state.powerUps = []; state.lasers = []; resetBall(); syncLabels();
}
function update() {
  if (band.heldDirection !== 0 && performance.now() < band.heldUntil) {
    nudgePaddle(band.heldDirection, 9);
  }

  state.paddle.x += (state.paddle.targetX - state.paddle.x) * CONTROL_SMOOTHING;
  if (state.paddle.wideTimer > 0) { state.paddle.wideTimer -= 1; if (state.paddle.wideTimer === 0) { state.paddle.w = 96; state.paddle.targetX = clamp(state.paddle.targetX, 6, WIDTH - state.paddle.w - 6); setMessage("Paddle normal."); } }
  if (state.paddle.laserTimer > 0) state.paddle.laserTimer -= 1;
  if (state.pierceTimer > 0) state.pierceTimer -= 1;
  updateBalls(); updateLasers(); updatePowerUps(); updateParticles(); checkStageClear();
}
function drawRoundedRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const activeTheme = theme();
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT); bg.addColorStop(0, "#07111f"); bg.addColorStop(1, "#03050a"); ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save(); ctx.globalAlpha = 0.22; ctx.strokeStyle = "#64d2ff"; ctx.lineWidth = 1;
  for (let x = 20; x < WIDTH; x += 35) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 80, HEIGHT); ctx.stroke(); }
  ctx.restore();
  for (const brick of state.bricks) {
    if (brick.hp <= 0) continue;
    const gradient = ctx.createLinearGradient(brick.x, brick.y, brick.x + brick.w, brick.y + brick.h);
    gradient.addColorStop(0, `hsla(${brick.hue}, 100%, 72%, 0.98)`); gradient.addColorStop(1, `hsla(${brick.hue + 38}, 100%, 52%, 0.9)`);
    ctx.shadowColor = `hsla(${brick.hue}, 100%, 62%, 0.55)`; ctx.shadowBlur = brick.power ? 18 : 9; ctx.fillStyle = gradient; drawRoundedRect(brick.x, brick.y, brick.w, brick.h, 8);
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.26)"; ctx.fillRect(brick.x + 7, brick.y + 4, brick.w - 14, 2);
    if (brick.maxHp > 1) { ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.font = "900 10px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(`x${brick.hp}`, brick.x + 8, brick.y + brick.h / 2 + 1); }
    if (brick.power) { ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = "900 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("*", brick.x + brick.w / 2, brick.y + brick.h / 2 + 1); }
  }
  for (const powerUp of state.powerUps) {
    ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 18; ctx.fillStyle = { wide: "#30d158", slow: "#64d2ff", multi: "#ffd60a", shield: "#5e5ce6", laser: "#ff2d55", pierce: "#ff9f0a" }[powerUp.type];
    ctx.beginPath(); ctx.arc(powerUp.x, powerUp.y, powerUp.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = "#031018"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(powerUp.type[0].toUpperCase(), powerUp.x, powerUp.y + 1);
  }
  for (const laser of state.lasers) { ctx.shadowColor = "#ff2d55"; ctx.shadowBlur = 18; ctx.strokeStyle = "#ff375f"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(laser.x, laser.y); ctx.lineTo(laser.x, laser.y + 20); ctx.stroke(); }
  for (const particle of state.particles) { const alpha = particle.life / particle.maxLife; ctx.globalAlpha = alpha; ctx.fillStyle = particle.color; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (state.shield > 0) { ctx.shadowColor = "#64d2ff"; ctx.shadowBlur = 18; ctx.strokeStyle = "rgba(100,210,255,.82)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(18, HEIGHT - 6); ctx.lineTo(WIDTH - 18, HEIGHT - 6); ctx.stroke(); }
  ctx.shadowColor = activeTheme.a; ctx.shadowBlur = 20; ctx.fillStyle = "#f7fbff"; drawRoundedRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, 8);
  if (state.paddle.laserTimer > 0) { ctx.fillStyle = "#ff2d55"; ctx.fillRect(state.paddle.x + 14, state.paddle.y - 8, 9, 9); ctx.fillRect(state.paddle.x + state.paddle.w - 23, state.paddle.y - 8, 9, 9); }
  for (const ball of state.balls) { ctx.shadowColor = state.pierceTimer > 0 ? "#ff9f0a" : "rgba(255,255,255,.85)"; ctx.shadowBlur = state.pierceTimer > 0 ? 28 : 18; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.shadowBlur = 0;
}
function loop() { if (state.running && !state.gameOver) update(); draw(); requestAnimationFrame(loop); }
function canBandAct(command) {
  const now = performance.now();
  const repeatMs = command === "left" || command === "right" ? band.repeatMs : 120;

  if (now - band.lastActionAt < repeatMs) return false;

  band.lastActionAt = now;
  return true;
}
function neuralBandCommand(command) {
  if (!canBandAct(command)) return;

  const commands = {
    left: () => {
      band.heldDirection = -1;
      band.heldUntil = performance.now() + 130;
      nudgePaddle(-1);
    },
    right: () => {
      band.heldDirection = 1;
      band.heldUntil = performance.now() + 130;
      nudgePaddle(1);
    },
    pinch: action,
    select: action,
    tap: action,
    reset: () => resetGame(true),
    mute: () => {
      audio.enabled = !audio.enabled;
      setMessage(audio.enabled ? "Audio on." : "Audio muted.");
    }
  };

  commands[command]?.();
}
function handlePointerDown(event) {
  state.pointerStart = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now()
  };
  state.pointerLastX = event.clientX;
  state.pointerId = event.pointerId;

  if (canvas.setPointerCapture) {
    canvas.setPointerCapture(event.pointerId);
  }

  movePaddleTo(event.clientX);
}
function handlePointerMove(event) {
  if (!state.pointerStart) return;
  if (state.pointerId !== null && event.pointerId !== state.pointerId) return;

  const dx = event.clientX - state.pointerLastX;
  state.pointerLastX = event.clientX;
  movePaddleBy(dx);
}
function handlePointerUp(event) {
  if (!state.pointerStart) return;
  if (state.pointerId !== null && event.pointerId !== state.pointerId) return;

  const dx = event.clientX - state.pointerStart.x;
  const elapsed = performance.now() - state.pointerStart.time;

  if (canvas.releasePointerCapture && canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  state.pointerStart = null;
  state.pointerLastX = null;
  state.pointerId = null;

  if (Math.abs(dx) < TAP_MAX_MOVEMENT && elapsed < TAP_MAX_TIME) {
    action();
  }
}
function handleKey(event) {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  const commands = { arrowleft: "left", a: "left", arrowright: "right", d: "right", " ": "pinch", enter: "pinch", p: "pinch", r: "reset", m: "mute" };
  if (!commands[key]) return;
  event.preventDefault(); neuralBandCommand(commands[key]);
}
function handleWheel(event) { event.preventDefault(); neuralBandCommand(event.deltaX < 0 || event.deltaY < 0 ? "left" : "right"); }
canvas.addEventListener("pointerdown", handlePointerDown, { passive: true });
canvas.addEventListener("pointermove", handlePointerMove, { passive: true });
canvas.addEventListener("pointerup", handlePointerUp, { passive: true });
canvas.addEventListener("pointercancel", () => {
  state.pointerStart = null;
  state.pointerLastX = null;
  state.pointerId = null;
}, { passive: true });
canvas.addEventListener("wheel", handleWheel, { passive: false });
if (launchBtn) {
  launchBtn.addEventListener("click", () => neuralBandCommand("pinch"));
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => neuralBandCommand("reset"));
}
window.addEventListener("keydown", handleKey);
window.BrickSmashBand = { left: () => neuralBandCommand("left"), right: () => neuralBandCommand("right"), pinch: () => neuralBandCommand("pinch"), select: () => neuralBandCommand("select"), reset: () => neuralBandCommand("reset"), mute: () => neuralBandCommand("mute") };
resetGame(true);
requestAnimationFrame(loop);

