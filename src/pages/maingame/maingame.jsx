import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import Phaser from "phaser";
import "./maingame.css";
import { selectAdminToken } from "../../admin/sessionSlice";
import { setBackButtonUrl } from "../uiSlice";
import { sendReport, extractReportIdFromResponse } from "../../functions/sendReport";
import { useThemeColors } from "../../functions/useThemeColors";

const USER_DATA_KEY = "userData";
const PLAYER_IMAGE = "/img/Idle.png";
const SKY_IMAGE = "/img/background.png";

/**
 * player_img/enemy_stand/enemy_shoot (below) are the only assets Phaser
 * uploads as a WebGL texture (texImage2D) rather than just drawing to a
 * <canvas> or DOM <img> — and WebGL refuses that upload outright
 * ("SecurityError: ... contains cross-origin data") for any cross-origin
 * image the browser didn't fetch with a CORS response. Our S3 asset bucket
 * doesn't send Access-Control-Allow-Origin, so admin-uploaded overrides for
 * these three slots have to be routed through our own backend's /proxyImage
 * endpoint, which re-fetches the object server-side (not subject to browser
 * CORS) and re-serves it with a permissive CORS header. Bundled local
 * defaults (already same-origin) are left untouched.
 */
function toGameTextureUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  const base = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) return url;
  return `${base}/proxyImage?url=${encodeURIComponent(url)}`;
}

/**
 * Strip a GIF's NETSCAPE2.0 Application Extension — the block that tells the
 * browser to loop — out of its raw bytes. A plain <img> gives no way to cap
 * a GIF at "loop once and stop" directly: the extension's loop count is the
 * number of *additional* passes after the first (0 meaning "forever"), and
 * per the GIF89a spec a file with no such extension simply plays once and
 * holds its last frame, which is exactly the single-playthrough behavior the
 * Victory gif needs. The block is self-contained and parsed sequentially
 * (nothing else in the file references it by offset), so splicing it out
 * leaves a valid GIF stream.
 */
function stripGifLoopExtension(bytes) {
  const sig = [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]; // "NETSCAPE2.0"
  for (let i = 0; i < bytes.length - (sig.length + 8); i++) {
    if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xff || bytes[i + 2] !== 0x0b) continue;
    let match = true;
    for (let j = 0; j < sig.length; j++) {
      if (bytes[i + 3 + j] !== sig[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const subBlockStart = i + 3 + sig.length; // sub-block size byte, should be 0x03
    if (bytes[subBlockStart] !== 0x03) continue;
    const blockEnd = subBlockStart + 1 + 3 + 1; // size + (loop-flag, lo, hi) + terminator
    if (bytes[blockEnd - 1] !== 0x00) continue;
    const out = new Uint8Array(bytes.length - (blockEnd - i));
    out.set(bytes.subarray(0, i), 0);
    out.set(bytes.subarray(blockEnd), i);
    return out;
  }
  return bytes; // no loop extension present — already a single-play gif
}

/** Fetches `sourceUrl` (proxied if cross-origin, see toGameTextureUrl), strips
 * its loop directive, and returns a blob: URL that plays exactly once. */
async function loadPlayOnceGifObjectUrl(sourceUrl) {
  const res = await fetch(toGameTextureUrl(sourceUrl));
  if (!res.ok) throw new Error(`GIF fetch failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const blob = new Blob([stripGifLoopExtension(bytes)], { type: "image/gif" });
  return URL.createObjectURL(blob);
}

// Player action GIFs, layered over the (otherwise invisible while animating)
// Phaser sprite as a plain HTML <img> — Phaser's texture/canvas pipeline only
// ever shows a GIF's first frame (it decodes the source once into a static
// texture), so real GIF playback has to happen in the DOM, not on canvas.
const PLAYER_GIFS = {
  run: "/img/Run.gif",
  jump1: "/img/Jump1.gif",
  jump2: "/img/Jump2.gif",
  shoot: "/img/Shoot.gif",
  victory: "/img/Victory.gif",
};

// The run/jump/shoot gifs draw the character noticeably smaller within their
// own (otherwise identically-sized) canvas than Idle.png does, so at a shared
// display box they visibly shrink the moment the player starts moving/firing.
// These per-state multipliers zoom each gif back up to Idle's apparent size;
// scaling is applied from the bottom-center (see transformOrigin below) so
// the character's feet stay planted instead of drifting as it scales. Jump
// and shoot are bumped up further (beyond just matching Idle) so those beats
// read as more prominent, and all four now share one common scale so no
// state pops noticeably bigger/smaller than the others mid-animation.
const PLAYER_GIF_UNIFORM_SCALE = 1.3;
// Run reads as too large next to the other states at the shared uniform
// scale, so it gets its own smaller multiplier instead.
const PLAYER_RUN_GIF_SCALE = 1.15;
// Victory gets its own (bigger) scale, unlike the other states above — it's
// the one-off "you won" beat held on screen for the whole summit hold, so it
// reads better sized up well past just matching Idle's apparent size.
const PLAYER_VICTORY_GIF_SCALE = 2;
const PLAYER_GIF_SCALE = {
  run: PLAYER_RUN_GIF_SCALE,
  jump1: PLAYER_GIF_UNIFORM_SCALE,
  jump2: PLAYER_GIF_UNIFORM_SCALE,
  shoot: PLAYER_GIF_UNIFORM_SCALE,
  victory: PLAYER_VICTORY_GIF_SCALE,
};

// Enemy (guard) action visuals. EnemyShoot is loaded in ClimbScene.preload()
// as a plain Phaser image texture and swapped onto the guard sprite on a
// wrong answer — Phaser's canvas texture pipeline only ever decodes a GIF's
// first frame (see the PLAYER_GIFS comment above), so it renders as a single
// static "firing" pose rather than looping, which is what's wanted here.
// EnemyDie needs to actually play, so — like the player action gifs — it's
// layered in as a plain HTML <img> over the canvas instead, shown once at
// the guard's position on a correct answer.
const ENEMY_STAND_IMAGE = "/img/enemystand.png";
const ENEMY_SHOOT_IMAGE = "/img/EnemyShoot.gif";
const ENEMY_GIFS = {
  die: "/img/EnemyDie.gif",
  // Same file as ENEMY_SHOOT_IMAGE — that one's loaded as a static Phaser
  // texture and swapped in briefly on a wrong answer (see ENEMY_SHOOT_LOOP_*
  // below); this DOM copy is what actually plays (looped) for that beat.
  shoot: ENEMY_SHOOT_IMAGE,
};
// Display height for the guard sprite, in the same pre-visualScale "source"
// units as PLAYER_DISPLAY_HEIGHT — width is derived from enemystand.png's
// own aspect ratio at create() so it never gets squeezed into a square.
const ENEMY_DISPLAY_HEIGHT = 64;
// How far (px, pre-visualScale) above the platform surface the guard's feet
// are pinned — kept a bit higher than a flush stand so the guard reads as
// perched just above the platform edge instead of sunk into it.
const ENEMY_PLATFORM_LIFT = 30;
// Same idea as PLAYER_GIF_SCALE above: EnemyShoot.gif / EnemyDie.gif draw
// the guard noticeably smaller within their own canvas than enemystand.png
// does, so at the same display box (see setEnemyVisual/onEnemyVisual) they
// visibly shrink the moment either gif starts playing. These per-state
// multipliers scale the overlay box back up to match the standing pose's
// apparent size.
const ENEMY_GIF_SCALE = {
  shoot: 1.6,
  die: 1.6,
};
// EnemyShoot.gif's approximate single-loop playback time (no frame-timing
// metadata is read from the file, so this is a tuned estimate) — on a wrong
// answer the animated overlay is kept visible for this many loops before the
// guard is destroyed, instead of showing it for just one uncertain pass.
const ENEMY_SHOOT_LOOP_MS = 500;
const ENEMY_SHOOT_LOOP_COUNT = 3;

// How long the Victory.gif keeps playing (looping freely, the same as any
// other animated gif file) on the summit before redirecting to the
// thank-you page.
const VICTORY_REDIRECT_DELAY_MS = 5000;

// Each level folder supplies its own backdrop ("bottom.png") and three
// platform-block variants (p1/p2/p3.png). Which band a platform draws from
// is driven by quiz progress (see levelForQuizFrac / create()) rather than
// raw climb height, so the scenery advances level1 -> level2 -> level3 as
// the player answers more questions. "lavel2" is a pre-existing typo in the
// asset folder name on disk, not a typo here.
const LEVELS = [
  { key: "level1", dir: "/img/level1" },
  { key: "level2", dir: "/img/lavel2" },
  { key: "level3", dir: "/img/level3" },
  { key: "level4", dir: "/img/level4" },
];

const WORLD_WIDTH = 480;
// Floor values only — the scene computes its real platform count/world
// height per run from the actual question count (see create()), so the
// climb is always exactly long enough to fit every question's guard before
// the summit, however many questions there are. These are just what a short
// quiz (or none) falls back to.
const MIN_PLATFORM_COUNT = 40;
const MIN_WORLD_HEIGHT = 4800;
// Matches the sky art's own top (bluest) tone. The single scaled sky image
// already covers the whole world height by itself, but this is the canvas's
// clear color underneath it — a safety net so that if the climb ever needs
// to extend past what the art covers (e.g. a very tall/odd viewport), it
// continues in the same blue with no visible seam, for as long as the run
// lasts (game only ends on summit or health hitting 0).
const SKY_FALLBACK_COLOR = 0x2599f5;
const GROUND_HEIGHT = 100;
// Player starts this far above the ground's top surface at game start.
const GROUND_START_GAP = 60;

const GROUND_OVERLAP = 15;
// Flagpole planted on the summit (last) platform — pure vector art (see
// makeTextures' "summitFlag" texture below), since no flag/pole image asset
// is supplied. Sized in the same pre-visualScale "source" units as the other
// world dimensions above.
const SUMMIT_FLAG_POLE_WIDTH = 6;
const SUMMIT_FLAG_POLE_HEIGHT = 110;
const SUMMIT_FLAG_WIDTH = 48;
const SUMMIT_FLAG_HEIGHT = 32;

// Distance (px) from the player's feet to the bottom edge of the screen —
// the camera keeps this constant regardless of viewport height. This also
// caps how much of the ground art below the player's feet fits on screen, so
// it's kept comfortably taller than GROUND_HEIGHT — otherwise only a sliver
// of the ground band (or none of it) would ever be in view.
const PLAYER_BOTTOM_GAP = 130;
const PLAYER_SPEED = 300;
const JUMP_VELOCITY = -700;
const GRAVITY_Y = 1500;

// Player display footprint (kept in one place so the generator's clearance math
// and the sprite's actual setDisplaySize stay in sync).
const PLAYER_DISPLAY_WIDTH = 56;
const PLAYER_DISPLAY_HEIGHT = 72;

// Platform tiles/player/ground art are all sized in fixed pixels, tuned by
// eye against WORLD_WIDTH (480). On a narrow phone viewport the Phaser world
// is only as wide as the actual screen (see viewWidth below), so those same
// fixed-pixel sizes eat a much bigger share of the width than on desktop —
// platforms read as oversized. This scales every *visual* dimension down
// proportionally to how much narrower than WORLD_WIDTH the viewport is,
// while leaving speed/gravity/jump/gap constants untouched, so difficulty
// and layout stay identical — only how big things are drawn changes.
const MIN_VISUAL_SCALE = 0.6;
function getVisualScale(viewWidth) {
  return Math.max(MIN_VISUAL_SCALE, Math.min(1, viewWidth / WORLD_WIDTH));
}

// Every platform gap is fixed at this height. A single jump's max height is
// (JUMP_VELOCITY^2)/(2*GRAVITY_Y) ≈ 163px, so at 170px, clearing every gap
// still relies on the double jump, just a bit less of one.
const PLATFORM_GAP = 170;
const DOUBLE_JUMP_MAX_HEIGHT = ((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_Y)) * 2;

// How far below the last platform the player actually stood on counts as a
// "missed the jump, fell" instead of just settling on a lower platform they
// happened to catch. Past this, they're dropped back onto a real platform a
// few steps below the one they fell from (see respawnAfterFall) instead of
// being left to plunge indefinitely toward the ground floor.
const CHECKPOINT_FALL_DISTANCE = PLATFORM_GAP * 2.2;

// respawnAfterFall lands the player on a platform this many steps below the
// one they fell from (a random pick in this range) — always a real platform
// with a real collider under it, so the recovery is guaranteed to catch them
// instead of occasionally re-triggering the same fall check on repeat (which
// read as falling in an endless loop with no platform ever catching them).
const FALL_RECOVERY_MIN_DROP = 3;
const FALL_RECOVERY_MAX_DROP = 5;
// Player is placed this far above the recovery platform's surface, not flush
// on it — landing "in the air" by a hair and letting normal gravity/collision
// settle them onto it the next couple of frames reads as an actual landing,
// and avoids any pixel-perfect surface-offset math being slightly off and
// spawning the player half-embedded in the platform.
const FALL_RECOVERY_DROP_GAP = 6;

// Checkpoint respawn lands the player near the edge of the fell-from
// platform closest to the next one ahead (a head start toward the jump they
// missed) rather than dead-center — but never right at the physical edge,
// which risks the collider not catching them at all. This is how far in
// from that edge the respawn point is kept.
const CHECKPOINT_EDGE_MARGIN = PLAYER_DISPLAY_WIDTH / 2 + 12;

// How far sideways a double jump covering PLATFORM_GAP can actually reach —
// the next platform's X is kept within this, so every gap the generator
// places is honestly jumpable, not just randomly scattered across the width.
const MIN_HORIZONTAL_SHIFT = PLAYER_DISPLAY_WIDTH + 40;
const HORIZONTAL_SAFETY = 0.8;

// On a narrow phone viewport, platforms sized at the same fixed pixels as
// desktop read as oversized relative to how little screen width there is,
// and the tightest-allowed platform-to-platform gaps land close enough
// together that lining a jump up between them feels cramped rather than
// smooth. Below this width, platform tiles are shrunk an extra bit beyond
// the general getVisualScale() reduction (player/enemy/ground sizing is
// untouched), and the minimum horizontal gap between platforms is widened —
// same jump physics, just fewer awkwardly-close jumps.
const MOBILE_VIEW_WIDTH_THRESHOLD = 700;
const MOBILE_PLATFORM_SCALE = 0.82;
const MOBILE_MIN_SHIFT_MULTIPLIER = 1.3;

// Once the climb has moved past level1's scenery, ordinary (non-guard)
// platforms drift side to side on the x axis — not a real moving platform,
// just enough to make the higher levels read as less static. Guard platforms
// are excluded so the quiz-encounter platform stays put.
const MOVING_PLATFORM_AMPLITUDE = 50;
const MOVING_PLATFORM_ANGULAR_SPEED = 0.0018;

/**
 * Max horizontal distance a jump with the given apex height can cover while
 * climbing `gap` px upward, using the descending-crossing time (the player
 * rises past the platform height, then the arc is timed to land on the way
 * back down) — the true worst-case-best-case reach for a jump of that power,
 * not just the naive "speed * time-to-apex" estimate.
 */
function jumpHorizontalReach(gap, apexHeight) {
  const v0 = Math.sqrt(2 * GRAVITY_Y * apexHeight);
  const h = Math.min(gap, apexHeight);
  const t = (v0 + Math.sqrt(Math.max(0, v0 * v0 - 2 * GRAVITY_Y * h))) / GRAVITY_Y;
  return PLAYER_SPEED * t;
}

// Platforms are a single tile block each, displayed at this fixed height with
// width derived from the texture's own aspect ratio (see the platform-building
// loop in create()) — so wider source art (p2's connector tile) reads as a
// visibly bigger platform instead of being stretched to one fixed width.
const TILE_HEIGHT = 72;

function readSessionUserData() {
  try {
    // Embedded/preview sessions (adminRedirect, admin iframe, etc.) write the
    // session's user data to sessionStorage — checked first. A normal login
    // (loginSlice.js) only ever persists to localStorage, though, and nothing
    // copies it into sessionStorage, so that's the fallback for a regular
    // logged-in player — without it, userId (and everything else) reads as
    // missing here even though the user is genuinely logged in, which silently
    // blocked every report/API call keyed on userId.
    const raw = sessionStorage.getItem(USER_DATA_KEY) || localStorage.getItem(USER_DATA_KEY) || "{}";
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Reverses formatTime's "mm:ss" back into seconds, for resuming elapsed time. */
function parseTimeToSeconds(time) {
  const match = /^(\d+):(\d{1,2})$/.exec(String(time || "").trim());
  if (!match) return 0;
  const mm = Number(match[1]);
  const ss = Number(match[2]);
  return Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : 0;
}

/** Minimal Web Audio beep-based SFX — no audio asset files are provided. */
class PFSound {
  constructor() {
    // Every oscillator currently sounding, and every setTimeout still
    // waiting to fire a *later* beep in a multi-note sequence (correct/
    // victory) — both are needed by stopAll() below to make muting mid-run
    // actually silence everything immediately, not just future beeps.
    this.activeNodes = [];
    this.pendingTimeouts = [];
  }
  ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    return this.ctx;
  }
  beep(freq = 440, duration = 0.12, type = "sine", volume = 0.15) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration + 0.02);
    const entry = { osc, gain };
    this.activeNodes.push(entry);
    osc.onended = () => {
      this.activeNodes = this.activeNodes.filter((n) => n !== entry);
    };
  }
  jump() {
    this.beep(520, 0.08, "square", 0.1);
  }
  correct() {
    this.beep(880, 0.12, "sine", 0.15);
    this.pendingTimeouts.push(setTimeout(() => this.beep(1046, 0.14, "sine", 0.12), 90));
  }
  wrong() {
    this.beep(180, 0.2, "sawtooth", 0.15);
  }
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => {
      this.pendingTimeouts.push(setTimeout(() => this.beep(f, 0.2, "sine", 0.15), i * 120));
    });
  }
  /** Immediately silences every beep currently sounding and cancels any
   * still-queued note in a multi-beep sequence (e.g. the victory fanfare) —
   * used when the player hits mute mid-sound, so it reads as an instant cutoff
   * instead of "the rest of this sequence keeps playing anyway". */
  stopAll() {
    this.pendingTimeouts.forEach(clearTimeout);
    this.pendingTimeouts = [];
    const ctx = this.ctx;
    this.activeNodes.forEach(({ osc, gain }) => {
      try {
        const now = ctx.currentTime;
        // Ramp to silence over a few ms rather than cutting the gain
        // instantly — an abrupt stop on a still-sounding oscillator is an
        // audible click/pop.
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.03);
        osc.stop(now + 0.04);
      } catch {
        // Already stopped/ended — nothing left to silence.
      }
    });
    this.activeNodes = [];
  }
}

class ClimbScene extends Phaser.Scene {
  constructor() {
    super("ClimbScene");
  }

  init(data) {
    this.emitter = data.emitter;
    this.questions = data.questions;
    this.worldWidth = data.viewWidth || WORLD_WIDTH;
    this.visualScale = data.visualScale || getVisualScale(this.worldWidth);
    // Per-org/theme overrides for the static textures below (see the
    // "playing" phase effect's effectivePlayerImage/effectiveEnemyStandImage
    // — falls back to the bundled defaults when nothing's uploaded).
    this.playerImgUrl = data.playerImgUrl || PLAYER_IMAGE;
    this.enemyStandUrl = data.enemyStandUrl || ENEMY_STAND_IMAGE;
    this.enemyShootUrl = data.enemyShootUrl || ENEMY_SHOOT_IMAGE;
    this.busy = false;
    this.victoryDone = false;
    this.canJump = true;
    this.coyote = 0;
    this.jumpsUsed = 0;
    this.maxJumps = 2;
    this.lastProgressEmit = 0;
    this.touchState = { left: false, right: false, jump: false };
    this.actionState = null;
    this.actionUntil = 0;
  }

  preload() {
    // player_img/enemy_stand/enemy_shoot can point at an admin-uploaded S3
    // image (see the "playing" phase effect's effective*Image resolution) —
    // if that URL 404s/403s (deleted object, bad key, bucket permissions),
    // Phaser never gets a real texture for that key and silently renders its
    // built-in placeholder instead (a black square with a green diagonal
    // line) for the rest of the run. Re-queue the bundled default art for
    // that same key the moment a load actually fails, so the sprite always
    // has *something* real to show instead of that placeholder. Guarded by
    // `url !== fallback` so a failing local default doesn't retry itself
    // forever.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
      const retry = { player_img: PLAYER_IMAGE, enemy_stand: ENEMY_STAND_IMAGE, enemy_shoot: ENEMY_SHOOT_IMAGE }[
        file.key
      ];
      if (retry && file.url !== retry) {
        this.load.image(file.key, retry);
      }
    });

    this.load.image("player_img", this.playerImgUrl);
    this.load.image("sky", SKY_IMAGE);
    // Guard's default standing pose — a real static PNG now, not a GIF held
    // on its first frame.
    this.load.image("enemy_stand", this.enemyStandUrl);
    // Only the first frame of this GIF ever gets decoded onto the canvas
    // texture — kept loaded for the brief wrong-answer swap; see the
    // "shoot" branch of resolveEncounter, which uses the animated DOM copy
    // instead (see the ENEMY_SHOOT_IMAGE comment up top).
    this.load.image("enemy_shoot", this.enemyShootUrl);
    LEVELS.forEach((lvl) => {
      this.load.image(`${lvl.key}_bottom`, `${lvl.dir}/bottom.png`);
      this.load.image(`${lvl.key}_p1`, `${lvl.dir}/p1.png`);
      this.load.image(`${lvl.key}_p2`, `${lvl.dir}/p2.png`);
      this.load.image(`${lvl.key}_p3`, `${lvl.dir}/p3.png`);
    });
  }

  /** Which level band a point in the quiz (0..1, 0 = no questions answered yet,
   * 1 = every question already passed) falls into. */
  levelForQuizFrac(frac) {
    return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, Math.floor(frac * LEVELS.length)))];
  }

  /** Picks the tile texture for one platform — always a single standalone
   * tile, so any of the three variants works (both edges show anyway). */
  platformTileTexture(levelKey) {
    return `${levelKey}_p${1 + Math.floor(Math.random() * 3)}`;
  }

  /** Forces the camera's vertical scroll every frame so the player's feet sit
   * exactly PLAYER_BOTTOM_GAP px above the bottom edge of the screen — always,
   * with no lag and no dependency on Phaser's follow/lerp/origin math. (Y-axis
   * follow lerp is set to 0 in create() specifically so this direct write is
   * never fought or overwritten by the built-in follow behavior; X still uses
   * normal smoothed follow.) A fraction-of-height offset was tried first, but
   * that keeps the player at the same *relative* screen height regardless of
   * viewport size — on a tall viewport that leaves a big pixel gap under the
   * player, which reads as the camera/world sinking rather than the character
   * staying put. Pinning scrollY directly is what actually keeps the
   * character fixed at the bottom on every screen size. */
  pinCameraToPlayer() {
    const cam = this.cameras.main;
    const desiredScrollY = this.player.y - (cam.height - this.playerBottomGap - this.playerDisplayHeight / 2);
    const maxScrollY = Math.max(0, this.worldHeight - cam.height);
    cam.scrollY = Phaser.Math.Clamp(desiredScrollY, 0, maxScrollY);
  }

  /** Drives the HTML GIF overlay (see the React side's "player:visual" listener):
   * hides the real sprite whenever a GIF should show instead, and reports the
   * player's current screen position so the overlay can track it. A timed
   * "action" state (set via playAction) overrides the normal idle/run/jump
   * read for its duration, e.g. the brief Shoot.gif on a correct answer. */
  setVisualState(state) {
    const now = this.time.now;
    const effective = this.actionUntil && now < this.actionUntil ? this.actionState : state;
    this.player.setAlpha(effective ? 0 : 1);
    const cam = this.cameras.main;
    this.emitter.emit("player:visual", {
      x: this.player.x - cam.scrollX,
      y: this.player.y - cam.scrollY,
      flipX: this.player.flipX,
      state: effective,
    });
  }

  /** Forces the overlay into `state` for `duration` ms, overriding whatever
   * update() would otherwise compute (used for the one-shot Shoot.gif). */
  playAction(state, duration) {
    this.actionState = state;
    this.actionUntil = this.time.now + duration;
    this.setVisualState(state);
  }

  /** Drives the HTML EnemyDie.gif overlay (see the React side's "enemy:visual"
   * listener) at a guard's current screen position. `state` null hides it.
   * Passes the guard's own display size along so the die overlay renders at
   * exactly the same size as the static EnemyShoot.gif sprite it replaces,
   * instead of some independently-guessed box. */
  setEnemyVisual(enemy, state, flipX = false) {
    const cam = this.cameras.main;
    this.emitter.emit("enemy:visual", {
      x: enemy.x - cam.scrollX,
      y: enemy.y - cam.scrollY,
      width: enemy.displayWidth,
      height: enemy.displayHeight,
      flipX,
      state,
    });
  }

  /** Flat, vector-style textures drawn with Graphics for elements with no supplied art. */
  makeTextures() {
    if (!this.textures.exists("bullet")) {
      const g = this.add.graphics();
      g.fillStyle(0xffe066, 1);
      g.fillRect(0, 0, 14, 5);
      g.generateTexture("bullet", 14, 5);
      g.destroy();
    }

    if (!this.textures.exists("cloud")) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0.95);
      g.fillEllipse(32, 26, 62, 30);
      g.fillEllipse(64, 18, 46, 26);
      g.fillEllipse(94, 26, 52, 26);
      g.generateTexture("cloud", 134, 48);
      g.destroy();
    }

    // Summit flag: a wooden pole with a gold pennant near the top, planted on
    // the last platform (see create()) so the finish line reads as an actual
    // landmark instead of just "whichever platform happens to be highest".
    if (!this.textures.exists("summitFlag")) {
      const g = this.add.graphics();
      g.fillStyle(0x6b4a2f, 1);
      g.fillRect(0, 0, SUMMIT_FLAG_POLE_WIDTH, SUMMIT_FLAG_POLE_HEIGHT);
      g.fillStyle(0xffd542, 1);
      g.beginPath();
      g.moveTo(SUMMIT_FLAG_POLE_WIDTH, 6);
      g.lineTo(SUMMIT_FLAG_POLE_WIDTH + SUMMIT_FLAG_WIDTH, 6 + SUMMIT_FLAG_HEIGHT / 2);
      g.lineTo(SUMMIT_FLAG_POLE_WIDTH, 6 + SUMMIT_FLAG_HEIGHT);
      g.closePath();
      g.fillPath();
      g.generateTexture("summitFlag", SUMMIT_FLAG_POLE_WIDTH + SUMMIT_FLAG_WIDTH, SUMMIT_FLAG_POLE_HEIGHT);
      g.destroy();
    }
  }

  create() {
    const worldWidth = this.worldWidth;
    const s = this.visualScale;
    const isMobileView = worldWidth < MOBILE_VIEW_WIDTH_THRESHOLD;
    const tileHeight = TILE_HEIGHT * s * (isMobileView ? MOBILE_PLATFORM_SCALE : 1);
    const minHorizontalShift = MIN_HORIZONTAL_SHIFT * (isMobileView ? MOBILE_MIN_SHIFT_MULTIPLIER : 1);
    const playerWidth = PLAYER_DISPLAY_WIDTH * s;
    const playerHeight = PLAYER_DISPLAY_HEIGHT * s;
    const groundStartGap = GROUND_START_GAP * s;
    const groundOverlap = GROUND_OVERLAP * s;
    this.playerDisplayWidth = playerWidth;
    this.playerDisplayHeight = playerHeight;
    this.playerBottomGap = PLAYER_BOTTOM_GAP * s;

    // The climb's length is driven by how many questions there actually are,
    // not a fixed constant — otherwise a longer quiz than the world was sized
    // for runs out of platforms before every question's guard fits, and the
    // player hits the (invisible) world-bounds ceiling partway up, well
    // before the last few questions/guards, which are placed beyond it and
    // so can never be reached. Guarantee at least one empty platform between
    // guards even when there are almost as many questions as platforms, so
    // guards never line up back to back.
    const enemyCount = this.questions.length;
    const MIN_ENEMY_SPACING = 2;
    this.platformCount = Math.max(MIN_PLATFORM_COUNT, (enemyCount + 1) * (MIN_ENEMY_SPACING + 1));
    // Ground + every platform gap + headroom above the last platform for the
    // summit zone, so those always land safely inside world bounds too.
    this.worldHeight = Math.max(
      MIN_WORLD_HEIGHT,
      GROUND_HEIGHT + this.platformCount * PLATFORM_GAP + 600
    );
    const worldHeight = this.worldHeight;
    const platformCount = this.platformCount;

    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.scale.on("resize", (gameSize) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
    });

    this.makeTextures();

    const half = worldWidth / 2;

    // Backdrop: background.png's blue-sky-to-warm-haze gradient (tall portrait
    // art), a single copy anchored to the ground and scaled up until it's tall
    // enough to span the entire world height by itself — so the art always
    // covers the whole climb with no repeating (which would show a hard color
    // seam at the tile boundary) and no flat color hand-off once it "ends".
    // scrollFactor is left at the default (1, moves 1:1 with the camera) —
    // anything less makes the image's anchored bottom edge visually drift
    // away from the true ground as the camera scrolls, so its yellow base
    // would no longer line up with the ground/platforms. The clouds below
    // are what give the actual parallax depth cue instead.
    const sky = this.textures.get("sky").getSourceImage();
    const scale = Math.max(worldWidth / sky.width, worldHeight / sky.height);
    this.sky = this.add
      .image(half, worldHeight, "sky")
      .setOrigin(0.5, 1)
      .setDepth(-100)
      .setScale(scale);

    // Clouds spaced up the whole climb — bottom.png is intentionally NOT
    // repeated here; it's placed exactly once, at the ground floor below.
    for (let y = worldHeight - 200; y > 100; y -= 640) {
      const side = Math.sin(y * 0.01) >= 0 ? -1 : 1;
      this.add.image(half - side * (worldWidth * 0.3), y - 260, "cloud").setScrollFactor(0.2).setAlpha(0.85);
    }

    // Solid ground floor spanning the full world width — the player starts
    // standing on it, and the climb up to the first platform uses the exact
    // same jump-gap logic as every platform-to-platform step above it. It's
    // skinned with level 1's bottom.png so the very base of the climb reads
    // as its own ground art.
    const groundHeight = GROUND_HEIGHT * s;
    const groundTopY = worldHeight - groundHeight;

    this.platforms = this.physics.add.staticGroup();
    this.platforms
      .create(half, worldHeight - groundHeight / 2, `${LEVELS[0].key}_bottom`)
      .setDisplaySize(worldWidth, groundHeight)
      .refreshBody();
    this.movingPlatforms = [];
    const platformData = [];

    // Which platform index each question's guard will stand on — worked out
    // up front (before the platforms themselves are built) so the scenery
    // level of a platform can be driven by how many questions the player will
    // already have passed by the time they reach it, not by raw climb height.
    const spacing = Math.max(MIN_ENEMY_SPACING, Math.floor(platformCount / (enemyCount + 1)));
    const enemyPlatformIndices = [];
    const usedPlatformIndices = new Set();
    for (let i = 0; i < enemyCount; i++) {
      let platIndex = Math.min(platformCount - 1, (i + 1) * spacing);
      while (usedPlatformIndices.has(platIndex) && platIndex < platformCount - 1) {
        platIndex += 1;
      }
      usedPlatformIndices.add(platIndex);
      enemyPlatformIndices.push(platIndex);
    }

    let y = groundTopY;
    let x = half;
    let dir = Math.random() < 0.5 ? -1 : 1;
    let dirRun = 0;

    for (let i = 0; i < platformCount; i++) {
      y -= PLATFORM_GAP;

      // How many questions the player will already have passed by the time
      // they reach this platform, as a 0..1 fraction of the whole quiz. Worked
      // out before the tile is picked (it only depends on `i`, not on x) so
      // the texture's own size can drive this platform's width below — p2's
      // connector art is naturally wider than p1/p3's end-caps, and stretching
      // everything to one fixed width was flattening that "bigger platform"
      // read out of the art entirely.
      const questionsPassed = enemyCount > 0
        ? enemyPlatformIndices.filter((idx) => idx <= i).length / enemyCount
        : 0;
      const lvl = this.levelForQuizFrac(questionsPassed);
      const texture = this.platformTileTexture(lvl.key);
      const src = this.textures.get(texture).getSourceImage();
      const platformWidth = Math.round(tileHeight * (src.width / src.height));
      const minX = platformWidth / 2 + 10;
      const maxX = worldWidth - platformWidth / 2 - 10;

      // Keep the shift within what a double jump covering PLATFORM_GAP can
      // actually reach, so every platform is honestly jumpable from the last.
      const rawReach = jumpHorizontalReach(PLATFORM_GAP, DOUBLE_JUMP_MAX_HEIGHT) * HORIZONTAL_SAFETY;
      const reachMax = Math.max(minHorizontalShift + 20, Math.round(rawReach));
      const shift = minHorizontalShift + Math.random() * (reachMax - minHorizontalShift);

      const mustFlip = dirRun >= 1;
      if (mustFlip || Math.random() < 0.55) {
        dir *= -1;
        dirRun = 0;
      } else {
        dirRun += 1;
      }
      const prevX = x;
      let nextX = x + dir * shift;
      // Bounce back inward instead of clamping into a wall so platforms don't
      // pile up against the world edge.
      if (nextX < minX || nextX > maxX) {
        dir *= -1;
        dirRun = 0;
        nextX = x + dir * shift;
      }
      x = Phaser.Math.Clamp(nextX, minX, maxX);

      // The bounce-then-clamp above can still land `x` within minHorizontalShift
      // of prevX when the bounce happens near a world edge (both the outward
      // and the bounced-back nextX get clamped to nearly the same boundary
      // value) — most visible on the narrower mobile viewport, where minX/maxX
      // are much closer together to begin with. That reads as two platforms
      // stacked almost directly on top of one another instead of offset
      // sideways. Push `x` out to whichever side still has room for the full
      // minimum shift so every platform-to-platform step stays honestly
      // separated, not just honestly jumpable.
      if (Math.abs(x - prevX) < minHorizontalShift) {
        const canGoRight = prevX + minHorizontalShift <= maxX;
        const canGoLeft = prevX - minHorizontalShift >= minX;
        if (canGoRight && (dir > 0 || !canGoLeft)) {
          x = prevX + minHorizontalShift;
          dir = 1;
        } else if (canGoLeft) {
          x = prevX - minHorizontalShift;
          dir = -1;
        }
        // If neither side has room (an unusually narrow viewport), leave the
        // clamped value as-is — there's nowhere honestly further to put it.
      }

      const tile = this.platforms
        .create(x, y, texture)
        .setDisplaySize(platformWidth, tileHeight)
        .refreshBody();
      // Lets the collider below (which only sees the tile, not the loop
      // index) look up this platform's own record — its width and its
      // neighbor in platformData — to work out the fall checkpoint.
      tile.platformIndex = i;

      // The very last platform is the summit — landing on it triggers
      // victory() below — keep it static even at levels that otherwise
      // drift platforms side to side, same as guard platforms are excluded,
      // so the finish line never moves out from under a landing player.
      const isTopPlatform = i === platformCount - 1;
      if (isTopPlatform) {
        this.topPlatformTile = tile;
        // Planted a bit off-center so the flag doesn't sit exactly where the
        // player lands — origin (0, 1) anchors the pole's bottom-left corner
        // to this point, so `flagX` is where the pole itself starts, not the
        // flag's center.
        const flagX = x - platformWidth * 0.32;
        const flagBaseY = y - tileHeight / 2;
        this.add
          .image(flagX, flagBaseY, "summitFlag")
          .setOrigin(0, 1)
          .setDisplaySize((SUMMIT_FLAG_POLE_WIDTH + SUMMIT_FLAG_WIDTH) * s, SUMMIT_FLAG_POLE_HEIGHT * s)
          .setDepth(5);
      } else if (lvl.key !== LEVELS[0].key && !usedPlatformIndices.has(i)) {
        this.movingPlatforms.push({ tile, baseX: x, minX, maxX, phase: Math.random() * Math.PI * 2 });
      }

      platformData.push({ x, y, width: platformWidth });
    }

    // Stashed for the fall-recovery logic in update() (see respawnAfterFall),
    // which needs every platform's own position/width to place the player
    // back onto a real platform rather than an arbitrary point in space.
    this.platformData = platformData;
    this.tileHeight = tileHeight;

    const startX = half;
    const startY = groundTopY - groundStartGap;
    this.lastSafe = { x: startX, y: startY, index: -1 };

    // Player uses the real character art from public/img (Idle.png), scaled to a
    // fixed display size once at creation. The body size/offset is computed in
    // "source" units (size / scale) so the final hitbox is an exact, unchanging
    // (30*s)x(56*s) rectangle regardless of the image's native pixel dimensions —
    // the texture is never swapped afterward, so that size can't drift.
    this.player = this.physics.add.sprite(startX, startY, "player_img");
    this.player.setDisplaySize(playerWidth, playerHeight);
    const sx = this.player.scaleX;
    const sy = this.player.scaleY;
    this.player.body.setSize((30 * s) / sx, (56 * s) / sy);
    // The body's bottom sits groundOverlap px above the sprite's actual visual
    // bottom (feet) — collision stops exactly where it always did, but the
    // rendered art now visibly overlaps into whatever's underneath (ground or
    // platform), instead of the feet appearing to hover right at the surface.
    this.player.body.setOffset(
      (this.player.width - (30 * s) / sx) / 2,
      this.player.height - (56 * s) / sy - groundOverlap / sy
    );
    this.player.setCollideWorldBounds(true);
    this.player.setMaxVelocity(PLAYER_SPEED, 1400);

    this.physics.add.collider(this.player, this.platforms, (player, tile) => {
      // Carry the player along with a moving platform while standing on top
      // of it — a static body's own x change otherwise has no effect on
      // whoever's resting on it (Arcade physics only resolves overlap, it
      // doesn't push riders for a manually-repositioned static body).
      if (tile.moveDeltaX && player.body.touching.down) {
        player.x += tile.moveDeltaX;
      }
      // Only actually *standing on top of* a platform counts as a safe
      // checkpoint — this collider also fires for a side bump or an
      // underside head-bonk mid-jump, and recording lastSafe there planted
      // the checkpoint respawn at a spot with no floor under it. Respawning
      // there just dropped the player straight through again, past
      // CHECKPOINT_FALL_DISTANCE, re-triggering the same respawn in a loop.
      // Checkpoint x is worked out from the platform itself (tile.x / its
      // record in platformData), not wherever the player's feet happened to
      // land on it — landing near an edge shouldn't leave the respawn point
      // sitting right at that same risky edge. Specifically: the edge of
      // this platform closest to the next one ahead, so a respawn starts
      // with a head start toward the jump that was missed, instead of dead
      // center or back at the exact spot the player fell from.
      if (player.body.touching.down) {
        const idx = tile.platformIndex;
        const here = Number.isInteger(idx) ? platformData[idx] : null;
        const next = Number.isInteger(idx) ? platformData[idx + 1] : null;
        let safeX = tile.x;
        if (here && next) {
          const dir = next.x >= tile.x ? 1 : -1;
          const halfSpan = Math.max(0, here.width / 2 - CHECKPOINT_EDGE_MARGIN);
          safeX = tile.x + dir * halfSpan;
        }
        this.lastSafe = { x: safeX, y: player.y, index: Number.isInteger(idx) ? idx : this.lastSafe?.index };
      }
      // Win the moment the player actually lands on the summit (static, see
      // above) platform, rather than merely flying through a trigger zone
      // above it — touching.down means standing on top of it, not just
      // brushing its side/underside mid-jump.
      if (tile === this.topPlatformTile && player.body.touching.down && !this.busy && !this.victoryDone) {
        this.victory();
      }
    });

    // Guards use enemystand.png as their standing texture. Sized from the
    // source art's own aspect ratio (not forced to a square) so it doesn't
    // squeeze, and bigger than the old 40x40 placeholder icon so it actually
    // reads. Anchored so the guard's feet stay planted in the same spot the
    // old, shorter icon stood at, since a taller sprite still draws from a
    // center origin.
    const enemyStandSrc = this.textures.get("enemy_stand").getSourceImage();
    const enemyDisplayHeight = ENEMY_DISPLAY_HEIGHT * s;
    const enemyDisplayWidth = Math.round(enemyDisplayHeight * (enemyStandSrc.width / enemyStandSrc.height));
    const enemyFeetY = (p) => p.y - ENEMY_PLATFORM_LIFT * s;

    this.enemies = this.physics.add.staticGroup();
    for (let i = 0; i < enemyCount; i++) {
      const p = platformData[enemyPlatformIndices[i]];
      const enemy = this.enemies
        .create(p.x, enemyFeetY(p) - enemyDisplayHeight / 2, "enemy_stand")
        .setDisplaySize(enemyDisplayWidth, enemyDisplayHeight)
        .refreshBody();
      enemy.qIndex = i;
    }

    const topPlat = platformData[platformData.length - 1];
    // Used only for the progress-% readout below now — the actual win
    // condition is landing on topPlatformTile (see the platform collider
    // above), not a trigger zone up here, so this tracks the platform's own
    // height (where the player actually ends up standing).
    this.summitY = topPlat.y;
    // No summit flag/pole anymore — the platform itself is the finish line.

    // lerpY 0 disables Phaser's built-in vertical follow entirely — Y is driven
    // every frame by pinCameraToPlayer() instead. X keeps normal smoothed follow.
    this.cameras.main.startFollow(this.player, true, 0.12, 0);
    this.pinCameraToPlayer();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({ w: "W", a: "A", d: "D", space: "SPACE" });

    this.emitter.on("touch", (dir, val) => {
      this.touchState[dir] = val;
    });
    this.emitter.on("quiz:resolve", (correct) => this.resolveEncounter(correct));

    this.physics.add.overlap(this.player, this.enemies, (_player, enemy) => {
      if (this.busy) return;
      this.triggerEncounter(enemy);
    });

    // Victory now fires from landing on topPlatformTile (see the platform
    // collider above) instead of an overlap zone here.

    // Everything (textures loaded, world built, player/camera in place) is
    // ready to render — this is what the React side's loader waits on before
    // revealing the canvas.
    this.emitter.emit("scene:ready");
  }

  triggerEncounter(enemy) {
    this.busy = true;
    this.activeEnemy = enemy;
    this.player.setVelocity(0, 0);
    this.setVisualState(null);
    this.physics.pause();
    const q = this.questions[enemy.qIndex % this.questions.length];
    this.emitter.emit("ENEMY_TRIGGER", { question: q, qIndex: enemy.qIndex });
  }

  resolveEncounter(correct) {
    const enemy = this.activeEnemy;
    const baseScaleX = this.player.scaleX;
    const baseScaleY = this.player.scaleY;

    if (correct && enemy) {
      // Face the player toward whichever side the guard is actually standing
      // on before firing, instead of whatever direction they last walked in.
      this.player.setFlipX(enemy.x < this.player.x);
      this.playAction("shoot", 650);
      const startX = this.player.x;
      const startY = this.player.y - 10;

      // Player "fires" — a quick recoil punch on the sprite makes the shot read
      // as an action the character is doing, not just a projectile appearing.
      this.tweens.add({
        targets: this.player,
        scaleX: baseScaleX * 1.1,
        scaleY: baseScaleY * 0.92,
        duration: 90,
        yoyo: true,
      });

      const bullet = this.add.image(startX, startY, "bullet");
      bullet.setRotation(Math.atan2(enemy.y - startY, enemy.x - startX));
      this.tweens.add({
        targets: bullet,
        x: enemy.x,
        y: enemy.y,
        duration: 150,
        onComplete: () => {
          bullet.destroy();
          this.cameras.main.flash(200, 76, 175, 80);
          // Swap to the animated EnemyDie.gif (DOM overlay) in place of the
          // static guard sprite, which is hidden for the same span. Faced
          // toward the player/bullet's origin, same as the shoot-back flip.
          enemy.setAlpha(0);
          const dieFlipX = this.player.x < enemy.x;
          this.setEnemyVisual(enemy, "die", dieFlipX);
          this.time.delayedCall(400, () => {
            this.setEnemyVisual(enemy, null);
            enemy.destroy();
          });
        },
      });
      this.time.delayedCall(650, () => {
        this.physics.resume();
        this.busy = false;
        this.activeEnemy = null;
        this.emitter.emit("encounter:resolved", { correct });
      });
    } else {
      // Enemy fires back — bullet travels from the guard to the player, then
      // the player dips to a low opacity ("killed") and eases back to fully
      // visible as play resumes, so a wrong answer visibly registers as a hit.
      if (enemy) {
        // Hide the guard's static enemystand.png pose and play the animated
        // EnemyShoot.gif DOM overlay in its place, looped ENEMY_SHOOT_LOOP_COUNT
        // times, so firing back on a wrong answer visibly plays — facing
        // whichever side the player is actually standing on.
        const shootDuration = ENEMY_SHOOT_LOOP_MS * ENEMY_SHOOT_LOOP_COUNT;
        const enemyFlipX = this.player.x > enemy.x;
        enemy.setAlpha(0);
        this.setEnemyVisual(enemy, "shoot", enemyFlipX);
        this.time.delayedCall(shootDuration, () => this.setEnemyVisual(enemy, null));

        const targetX = this.player.x;
        const targetY = this.player.y - 10;
        const bullet = this.add.image(enemy.x, enemy.y, "bullet").setTint(0xff4d4d);
        bullet.setRotation(Math.atan2(targetY - enemy.y, targetX - enemy.x));
        this.tweens.add({
          targets: bullet,
          x: targetX,
          y: targetY,
          duration: 180,
          onComplete: () => {
            bullet.destroy();
            this.cameras.main.shake(200, 0.01);
            this.cameras.main.flash(200, 226, 59, 59);
            this.player.setTint(0xff2f2f);
            this.tweens.add({
              targets: this.player,
              alpha: 0.2,
              duration: 220,
              yoyo: true,
              ease: "Sine.easeInOut",
              onComplete: () => {
                this.player.clearTint();
                this.player.setAlpha(1);
              },
            });
          },
        });
        this.time.delayedCall(Math.max(700, shootDuration + 100), () => {
          enemy.destroy();
          this.physics.resume();
          this.busy = false;
          this.activeEnemy = null;
          this.emitter.emit("encounter:resolved", { correct });
        });
      } else {
        this.cameras.main.shake(200, 0.01);
        this.cameras.main.flash(200, 226, 59, 59);
        this.time.delayedCall(400, () => {
          this.physics.resume();
          this.busy = false;
          this.activeEnemy = null;
          this.emitter.emit("encounter:resolved", { correct });
        });
      }
    }
  }

  victory() {
    this.victoryDone = true;
    this.busy = true;
    this.player.setVelocity(0, 0);
    // Clear any still-running timed action (the 650ms Shoot.gif from firing
    // on the last guard, playAction() above) before switching state — left
    // alone, setVisualState below reads `effective` as that action's state
    // instead of "victory" whenever the player lands on the summit within
    // that window, and since update() (the only other caller of
    // setVisualState) never runs again once `busy` is true, the overlay
    // would be stuck showing Shoot.gif for the whole summit hold instead of
    // ever switching to the victory pose at all.
    this.actionUntil = 0;
    this.setVisualState("victory");
    // Play the victory sound right as the Victory.gif sequence starts, not
    // when SUMMIT_REACHED fires — that only happens after the full
    // VICTORY_REDIRECT_DELAY_MS hold (see the delayedCall below), by which
    // point the sound used to fire mere milliseconds before navigate() tore
    // the page down, cutting it off before it was audible.
    this.emitter.emit("sfx:victory");
    // Victory.gif just plays/loops on its own for the whole summit hold
    // (like any other animated gif) instead of being frozen on a single
    // frame after one loop.
    this.time.delayedCall(VICTORY_REDIRECT_DELAY_MS, () => this.emitter.emit("SUMMIT_REACHED"));
  }

  update() {
    if (this.busy || this.victoryDone) return;

    const left = this.cursors.left.isDown || this.keys.a.isDown || this.touchState.left;
    const right = this.cursors.right.isDown || this.keys.d.isDown || this.touchState.right;
    const jumpDown = this.cursors.up.isDown || this.keys.space.isDown || this.touchState.jump;

    const onGround = this.player.body.blocked.down || this.player.body.touching.down;
    this.coyote = onGround ? 150 : Math.max(0, this.coyote - 16);
    if (onGround) this.jumpsUsed = 0;

    if (left) {
      this.player.setVelocityX(-PLAYER_SPEED);
      this.player.setFlipX(true);
    } else if (right) {
      this.player.setVelocityX(PLAYER_SPEED);
      this.player.setFlipX(false);
    } else {
      this.player.setVelocityX(0);
    }

    // First jump comes from the ground (with coyote-time forgiveness); the second
    // (double) jump can be triggered anytime while airborne. jumpsUsed caps it at
    // two total jumps until the player touches ground again.
    const canFirstJump = this.coyote > 0 && this.jumpsUsed === 0;
    const canDoubleJump = !onGround && this.jumpsUsed === 1;
    if (jumpDown && this.canJump && this.jumpsUsed < this.maxJumps && (canFirstJump || canDoubleJump)) {
      this.player.setVelocityY(JUMP_VELOCITY);
      this.coyote = 0;
      this.canJump = false;
      this.jumpsUsed += 1;
      this.emitter.emit("sfx:jump");
    }
    if (!jumpDown) this.canJump = true;

    // Checkpoint: a missed jump that falls more than CHECKPOINT_FALL_DISTANCE
    // past the last platform actually stood on is treated as "fell off", and
    // drops the player onto a real platform a few steps below instead of
    // leaving them to plunge all the way down to the ground floor.
    if (this.lastSafe && this.player.y - this.lastSafe.y > CHECKPOINT_FALL_DISTANCE) {
      this.respawnAfterFall();
    }

    const now = this.time.now;
    if (now - this.lastProgressEmit > 200) {
      this.lastProgressEmit = now;
      const pct = Phaser.Math.Clamp(((this.worldHeight - this.player.y) / (this.worldHeight - this.summitY)) * 100, 0, 100);
      this.emitter.emit("PROGRESS", pct);
    }

    if (!onGround) {
      this.setVisualState(this.jumpsUsed >= 2 ? "jump2" : "jump1");
    } else if (left || right) {
      this.setVisualState("run");
    } else {
      this.setVisualState(null);
    }

    this.updateMovingPlatforms();
    this.pinCameraToPlayer();
  }

  /** Called once a fall has gone on for more than CHECKPOINT_FALL_DISTANCE
   * past the last platform actually stood on — drops the player onto a real
   * platform FALL_RECOVERY_MIN_DROP..FALL_RECOVERY_MAX_DROP steps below the
   * platform they fell from, rather than teleporting them back to that exact
   * x/y (lastSafe). Teleporting back to lastSafe could put the player at an x
   * that no longer has solid ground directly under it once platforms have
   * shifted (moving platforms, or simply not being lined up with where the
   * fall started from), so gravity immediately resumed the same fall and
   * re-triggered this same check on the next frame — an endless "falling in
   * a loop" with no platform ever actually catching them. Picking an explicit
   * platform from platformData and placing the player just above its surface
   * guarantees a real collider is waiting right there. */
  respawnAfterFall() {
    const platformData = this.platformData;
    if (!platformData || platformData.length === 0) return;

    const fellFromIndex = Number.isInteger(this.lastSafe?.index) ? this.lastSafe.index : 0;
    const drop =
      FALL_RECOVERY_MIN_DROP +
      Math.floor(Math.random() * (FALL_RECOVERY_MAX_DROP - FALL_RECOVERY_MIN_DROP + 1));
    const targetIndex = Phaser.Math.Clamp(fellFromIndex - drop, 0, platformData.length - 1);
    const target = platformData[targetIndex];
    if (!target) return;

    const landY =
      target.y - this.tileHeight / 2 - this.playerDisplayHeight / 2 - FALL_RECOVERY_DROP_GAP * this.visualScale;

    this.player.setVelocity(0, 0);
    this.player.setPosition(target.x, landY);
    this.jumpsUsed = 0;
    this.coyote = 0;
    // Provisional — the platform collider overwrites this with the exact
    // resting position the instant the player actually touches down on it.
    this.lastSafe = { x: target.x, y: landY, index: targetIndex };
  }

  /** Sways non-guard, non-level1 platforms side to side on the x axis. Static
   * bodies don't move on their own, so the tile's x is driven directly and
   * the body is re-synced from it every frame via updateFromGameObject().
   * Each tile's frame-to-frame delta is stashed on it (`moveDeltaX`) so the
   * player collider below can carry a standing player along with it. */
  updateMovingPlatforms() {
    if (!this.movingPlatforms || this.movingPlatforms.length === 0) return;
    const now = this.time.now;
    for (const mp of this.movingPlatforms) {
      const offset = Math.sin(now * MOVING_PLATFORM_ANGULAR_SPEED + mp.phase) * MOVING_PLATFORM_AMPLITUDE;
      const newX = Phaser.Math.Clamp(mp.baseX + offset, mp.minX, mp.maxX);
      mp.tile.moveDeltaX = newX - mp.tile.x;
      mp.tile.x = newX;
      mp.tile.body.updateFromGameObject();
    }
  }
}

export default function MainAme() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const adminToken = useSelector(selectAdminToken);
  const { data: themeData } = useSelector((state) => state.theme);
  const { status, user } = useSelector((state) => state.auth);
  const storedUserData = useMemo(() => readSessionUserData(), []);

  const organizationId = storedUserData?.organizationId || "admin";
  const sessionId = storedUserData?.sessionId || "admin";
  const currentTheme = themeData?.themename ?? themeData?.themeName ?? themeData?.themeId ?? null;
  const pointsPerCorrect = Number(themeData?.points ?? 10) || 10;
  const configuredLives = Number(themeData?.total_question);

  const { textStyle: themeTextStyle, buttonStyle: themeButtonStyle } = useThemeColors();

  const [phase, setPhase] = useState("howto");
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Whether the theme actually has any valid questions at all, BEFORE the
  // already-answered ones are filtered out — distinct from `questions`
  // itself (which is post-filter and legitimately empty once every question
  // has been answered in a prior session). Used to tell "this theme has no
  // questions configured" (a real error) apart from "you've already
  // answered everything" (not an error — the render below still lets the
  // climb start with zero enemies so the player can free-climb to the
  // summit and finish the run).
  const [hasAnyQuestions, setHasAnyQuestions] = useState(true);

  // The number of questions the run actually uses/lives given — capped to
  // the admin-configured total_question (e.g. 10) when set, so completing
  // that many questions ends the run instead of ploughing through every
  // question the pool happens to have loaded.
  const maxHealth = Number.isFinite(configuredLives) && configuredLives > 0 ? configuredLives : questions.length;

  const [health, setHealth] = useState(0);
  const [points, setPoints] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  // Right-side vertical bar tracks quiz progress (questions answered so
  // far / total questions) — distinct from progressPct above, which tracks
  // how far up the climb the player physically is. Denominator is maxHealth
  // (the admin-configured themeData.total_question), same cap the question
  // pool itself is sliced to below — not questions.length, which is however
  // many questions happen to be loaded and can be larger than what the run
  // actually uses.
  const answeredQuestions = correctCount + wrongCount;
  const questionProgressPct =
    maxHealth > 0 ? Math.round((answeredQuestions / maxHealth) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  // The big "playing" phase effect below (onJumpSfx/onVictorySfx) is set up
  // once via emitter.on and never re-runs when `muted` changes (its effect's
  // deps are [phase, shuffledQuestions]), so those callbacks would otherwise
  // close over whatever `muted` was at effect-setup time forever — toggling
  // mute mid-run silenced the answer-feedback beeps (read fresh each render
  // in resolveAnswer) but not jump/victory. Reading mutedRef.current instead
  // keeps them checking the live value.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  const [paused, setPaused] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [feedback, setFeedback] = useState(null);
  // Only used for the "typetext" question type's free-text answer box —
  // reset whenever a new question comes up (see the effect near the touch-
  // control release one below) so a leftover typed value never carries over
  // into the next Text Input question.
  const [textAnswer, setTextAnswer] = useState("");
  // True once the Phaser scene has built the world AND every player gif has
  // finished loading/decoding — gates the canvas behind a loader so the
  // player never sees an unbuilt scene or a gif popping in mid-animation.
  const [assetsReady, setAssetsReady] = useState(false);
  // External report id (game-server). Seeded from the saved session if present,
  // then kept in sync so repeated calls update the same report instead of
  // creating a new one each time.
  const [reportId, setReportId] = useState(
    storedUserData?.reportId || storedUserData?.report_id || null
  );
  // True once fetchReport has restored real in-progress points/time — lets
  // startGame() skip its normal reset-to-zero so a page refresh mid-run
  // doesn't wipe the score/time that were already saved server-side.
  const [resumedProgress, setResumedProgress] = useState(false);
  // Ids of questions already answered — seeded from fetchReport's `current`
  // on a refresh (so those questions/enemies are excluded from the pool
  // entirely) and appended to as the player answers more this session.
  const [answeredIds, setAnsweredIds] = useState([]);
  const [answerLog, setAnswerLog] = useState([]);
  // How many questions were already answered in a PRIOR session, captured
  // once at fetch time and never touched again afterward (unlike
  // answeredIds, which keeps growing as this session's own answers come in)
  // — shuffledQuestions below subtracts this from maxHealth so a refresh
  // mid-run doesn't hand out a full fresh maxHealth's worth of NEW enemies
  // on top of the ones already answered before the refresh. Without this,
  // resuming after e.g. 2 answered still sliced the remaining pool down to
  // a full 10, so the run ended up asking 12 questions total instead of 10,
  // and the right-side "answered/total" readout could climb past 100%
  // (e.g. showing "11/10").
  const [resumedAnsweredCount, setResumedAnsweredCount] = useState(0);

  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const emitterRef = useRef(null);
  const soundRef = useRef(null);
  const healthRef = useRef(health);
  const pointsRef = useRef(points);
  const countsRef = useRef({ correct: 0, wrong: 0 });
  const elapsedRef = useRef(elapsed);
  const answeredIdsRef = useRef(answeredIds);
  const answerLogRef = useRef(answerLog);
  // Mirrors `reportId` state, updated synchronously (see pushExternalReport)
  // instead of only on re-render — pushExternalReport is fired fire-and-forget
  // on every answer without awaiting the previous call, so reading the state
  // value directly could still see the pre-update null/old id while an
  // earlier call's response was already in flight, causing a second POST
  // (insert) instead of a PUT (update) and a duplicate report row in the DB.
  const reportIdRef = useRef(reportId);
  // Correct/wrong counts recovered from a resumed report (see the
  // fetchReport effect below) — read by startGame() to seed correctCount/
  // wrongCount/health instead of always starting a resumed run back at 0/full
  // health, which was wiping the right-side progress bar and heart count on
  // every refresh even though the already-answered questions themselves were
  // correctly excluded from the pool.
  const resumedCorrectRef = useRef(0);
  const resumedWrongRef = useRef(0);
  // Per-organization/theme action-visual overrides, keyed by GIF_SLOTS slot
  // name (see admin/pages/themeupdate/themeupdate.jsx's "Add Gif" tab) —
  // populated once on mount (see the fetchReport/getPeakForceQuestions
  // effect below) and read when the "playing" phase effect builds the
  // effective gif/image URLs, so an admin's uploaded gifs actually show up
  // in-game instead of the bundled /img/*.gif defaults always winning.
  const gifSettingsRef = useRef({});
  // Maps an in-flight touch's pointerId -> which direction/jump button it
  // pressed. Used by the window-level safety net below (see that effect) to
  // release the *right* control when a pointerup/cancel never reaches the
  // button itself.
  const activeTouchPointersRef = useRef({});

  if (!emitterRef.current) emitterRef.current = new Phaser.Events.EventEmitter();
  if (!soundRef.current) soundRef.current = new PFSound();

  // The on-screen touch controls get `display:none`'d (via the "is-hidden"
  // class) the instant a quiz/feedback/pause/info overlay opens — which can
  // happen mid-press, while a finger is still down on a direction button.
  // Hiding the element doesn't reliably fire pointerup/pointercancel on it
  // (support for that varies by browser), so without this the scene's
  // touchState for that direction stays stuck "true" forever: movement
  // keeps applying every update() tick with no way to release it, since the
  // finger is no longer over any element that could fire the up event. The
  // player then drifts on their own and pins against the world's left/right
  // edge, unable to move off it even when the other direction button is
  // tapped (left/right are checked with left taking priority in update()).
  // Forcing a release the moment the controls hide keeps input state honest.
  useEffect(() => {
    if (activeQuestion || feedback || paused || showInfo) {
      const emitter = emitterRef.current;
      emitter.emit("touch", "left", false);
      emitter.emit("touch", "right", false);
      emitter.emit("touch", "jump", false);
      activeTouchPointersRef.current = {};
    }
  }, [activeQuestion, feedback, paused, showInfo]);

  // Belt-and-suspenders fallback for the same class of bug as the effect
  // above, for the cases it can't reach: some Android WebViews/browsers
  // (reported concretely at a narrow 388x861 viewport) drop a touch's
  // pointerup/pointercancel/pointerleave on the *button* entirely — the
  // finger lifts a hair off the tiny circular target, or the OS delivers the
  // up event to a different element than the one that had setPointerCapture
  // — and with no matching release, touchState for that direction is stuck
  // "true" forever, pinning the player against whichever screen edge that
  // direction pushes toward (and since update() checks left before right,
  // the other direction button then does nothing either). Listening on
  // window catches the up/cancel event even when it never reaches the
  // button, and activeTouchPointersRef (populated by touchHandlers below)
  // lets it release only the specific direction that pointerId was actually
  // pressing — so a second finger tapping Jump can't spuriously cancel a
  // still-held Left/Right from a different finger.
  useEffect(() => {
    const release = (e) => {
      const dir = activeTouchPointersRef.current[e.pointerId];
      if (!dir) return;
      delete activeTouchPointersRef.current[e.pointerId];
      emitterRef.current.emit("touch", dir, false);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  // Clear any typed text the moment a (new, or no) question comes up, so a
  // Text Input question never opens pre-filled with whatever was typed for
  // the previous one.
  useEffect(() => {
    setTextAnswer("");
  }, [activeQuestion]);

  // Demo sessions ("demo..." sessionId) are time-boxed: kick the player back
  // to the plan page after 30s instead of letting them play the full game.
  useEffect(() => {
    if (!String(sessionId).startsWith("demo")) return undefined;
    const timer = setTimeout(() => {
      window.location.href = `${process.env.REACT_APP_BASE_URL}/plan`;
    }, 30000);
    return () => clearTimeout(timer);
  }, [sessionId]);

  useEffect(() => {
    dispatch(setBackButtonUrl("/rules"));
  }, [status, user]);

  useEffect(() => {
    healthRef.current = health;
  }, [health]);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  useEffect(() => {
    countsRef.current = { correct: correctCount, wrong: wrongCount };
  }, [correctCount, wrongCount]);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);
  useEffect(() => {
    answeredIdsRef.current = answeredIds;
  }, [answeredIds]);
  useEffect(() => {
    answerLogRef.current = answerLog;
  }, [answerLog]);

  // Last-chance flush of whichever question was just answered, right vs.
  // wrong doesn't matter, to the `stages` row's `current`/`answers` columns.
  // handleAnswer's own pushExternalReport call already does this on every
  // answer, but it's fire-and-forget (never awaited) — if the player
  // refreshes right after killing a guard, that in-flight request can still
  // be sitting in the browser's queue and gets aborted when the page tears
  // down, so the DB never learns that question was answered and the same
  // guard reappears on refresh. Firing the same upsert again here, from
  // pagehide/visibilitychange (hidden), with `keepalive: true` so the
  // request survives the unload instead of being cancelled by it, closes
  // that window: whichever of the two calls actually lands last just
  // re-saves the same (by-then-current) answeredIdsRef/answerLogRef state.
  // sendBeacon can't be used here instead — this endpoint requires a Bearer
  // Authorization header, which sendBeacon has no way to attach.
  useEffect(() => {
    const flush = () => {
      const role = storedUserData?.role || storedUserData?.source;
      if (role === "demobypass" || role === "DEMO") return;
      const userId = storedUserData?.userId || storedUserData?.userid || storedUserData?.id || "";
      if (!userId || !adminToken || !reportIdRef.current) return;
      try {
        fetch(`${process.env.REACT_APP_BACKEND_URL}/addReport`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          keepalive: true,
          body: JSON.stringify({
            organizationId,
            sessionId,
            userId,
            email: storedUserData?.email || storedUserData?.employeeId || "",
            reportId: reportIdRef.current,
            name: storedUserData?.name || "",
            themeName: currentTheme,
            current: answeredIdsRef.current,
            answers: answerLogRef.current,
            points: pointsRef.current,
            total_score: pointsRef.current,
            time: formatTime(elapsedRef.current),
          }),
        }).catch(() => {});
      } catch (_) {
        /* ignore */
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [adminToken, organizationId, sessionId, currentTheme]);

  // Resume previous progress first, THEN fetch the question pool and filter
  // out whatever was already answered — sequenced in one effect (rather than
  // two independent ones) so the filter always has the resumed ids in hand
  // before the pool is built, instead of racing two fetches against each other.
  useEffect(() => {
    if (!adminToken || !currentTheme) return undefined;
    let cancelled = false;
    (async () => {
      let resumedIds = [];

      const userId = storedUserData?.userId || storedUserData?.userid || storedUserData?.id || "";
      if (userId) {
        try {
          const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/fetchReport`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ organizationId, sessionId, userId }),
          });
          const data = await res.json();
          if (!cancelled && data.success && data.report) {
            const prevPoints = Number(data.report.points) || 0;
            const prevSeconds = parseTimeToSeconds(data.report.time);

            // Already finished a prior run — don't let them play again, send
            // them straight to the thank-you page with the score they ended on.
            if (data.report.gameover) {
              navigate("/thankyou", { replace: true, state: { points: prevPoints, time: prevSeconds } });
              return;
            }

            if (data.report.reportId) {
              setReportId(data.report.reportId);
              reportIdRef.current = data.report.reportId;
            }
            if (Array.isArray(data.report.current) && data.report.current.length) {
              resumedIds = data.report.current.map(String);
              setAnsweredIds(resumedIds);
              setResumedAnsweredCount(resumedIds.length);
            }

            // Recover how many of those already-answered questions were
            // right vs. wrong, so a refresh can restore the progress
            // bar/hearts to where they actually were instead of resetting
            // them to 0/full (startGame() below reads these refs). Prefer
            // the exact per-answer log; fall back to deriving a correct
            // count from points/pointsPerCorrect when the log is missing but
            // ids/points are present, so the counts are still close even
            // then.
            let rCorrect = 0;
            let rWrong = 0;
            if (Array.isArray(data.report.answers) && data.report.answers.length) {
              setAnswerLog(data.report.answers);
              rCorrect = data.report.answers.filter((a) => a && a.correct).length;
              rWrong = data.report.answers.length - rCorrect;
            } else if (resumedIds.length && pointsPerCorrect > 0) {
              rCorrect = Math.min(resumedIds.length, Math.round(prevPoints / pointsPerCorrect));
              rWrong = Math.max(0, resumedIds.length - rCorrect);
            }
            resumedCorrectRef.current = rCorrect;
            resumedWrongRef.current = rWrong;
            setCorrectCount(rCorrect);
            setWrongCount(rWrong);

            if (prevPoints > 0 || prevSeconds > 0 || resumedIds.length > 0) {
              setPoints(prevPoints);
              setElapsed(prevSeconds);
              setResumedProgress(true);
            }
          }
        } catch (e) {
          console.error("Failed to fetch previous report:", e);
        }
      }

      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/getGifSettings`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ organizationId, sessionId, currentTheme }),
        });
        const data = await res.json();
        if (!cancelled && data.success && data.gifs) {
          gifSettingsRef.current = data.gifs;
        }
      } catch (e) {
        console.error("Failed to fetch gif settings:", e);
      }

      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/getPeakForceQuestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ organizationId, sessionId, currentTheme }),
        });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.questions)) {
          throw new Error(data.message || "Failed to load questions");
        }
        const validQuestions = data.questions
          .map((q) => {
            const options = [q.option_one, q.option_two, q.option_three].filter((o) => o && String(o).trim());
            const answerIndex = options.findIndex(
              (o) => String(o).trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase()
            );
            // "typetext" questions (Add Content -> Text Input) carry no
            // option_one/two/three at all — they're answered by typing the
            // correct_answer in directly rather than picking an option. Kept
            // as its own `isTextInput` question here rather than folded into
            // the options/answerIndex shape the MCQ/True-False types use.
            //
            // Deliberately NOT `q.type_question === "typetext"` — rows
            // inserted outside the save form/CSV importer (both of which
            // enforce type_question to be exactly one of radioselect/
            // truefalse/typetext) can have type_question as ""/null while
            // still being real, playable text-answer questions (correct_
            // answer set, no options). Treating "has no usable options but
            // has a correct answer" as text-input — the same fallback the
            // admin question list already uses to label these "Text" — means
            // those rows aren't silently dropped from the game just because
            // an exact label was never set.
            const isTextInput = options.length < 2 && Boolean(String(q.correct_answer || "").trim());
            return {
              id: String(q.id),
              category: "Peak Force",
              question: q.question || "",
              options,
              answerIndex: answerIndex >= 0 ? answerIndex : 0,
              isTextInput,
              correctAnswerText: String(q.correct_answer || "").trim(),
              image: q.image || "",
              didYouKnow: q.did_you_know || "",
            };
          })
          // MCQ/True-False questions need at least 2 real options to be
          // playable; Text Input questions instead just need a non-empty
          // correct_answer to check typed answers against. Previously this
          // required options.length >= 2 unconditionally, which silently
          // dropped every Text Input question from the game (0 options by
          // design) — a theme with only Text Input questions saved in the
          // admin panel would show "No questions are available" in-game
          // despite having questions.
          .filter((q) => q.question && (q.isTextInput ? q.correctAnswerText : q.options.length >= 2));
        // Already answered (from a previous run before a refresh) — don't show it again.
        const pool = validQuestions.filter((q) => !resumedIds.includes(q.id));
        if (!cancelled) {
          setQuestions(pool);
          setHasAnyQuestions(validQuestions.length > 0);
          setLoadingQuestions(false);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e.message || "Failed to load questions");
          setLoadingQuestions(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken, currentTheme, organizationId, sessionId]);

  const shuffledQuestions = useMemo(() => {
    const arr = [...questions];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Cap to the configured total_question count — the climb only ever asks
    // (and gives lives for) that many questions, however many are loaded.
    // `questions` here already excludes anything answered in a prior session
    // (see the fetchReport effect above), but that alone isn't enough: this
    // slice also has to shrink by however many were already answered before
    // the refresh, or a resumed run hands out a full fresh maxHealth's worth
    // of NEW enemies on top of the ones already killed, so the run ends up
    // asking more than maxHealth questions in total (and the answered/total
    // readout can climb past 100%, e.g. "11/10").
    return arr.slice(0, Math.max(0, maxHealth - resumedAnsweredCount));
  }, [questions, maxHealth, resumedAnsweredCount]);

  useEffect(() => {
    if (phase !== "playing" || paused) return undefined;
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase, paused]);

  useEffect(() => {
    // Deliberately NOT gated on shuffledQuestions.length > 0 — once every
    // question has already been answered (a resumed run picking back up
    // after finishing its question budget), shuffledQuestions is correctly
    // empty (see the memo above), but the climb still needs to build: with
    // zero enemies, ClimbScene just places no guards and the player free-
    // climbs empty platforms straight to the summit to finish the run. The
    // old `|| shuffledQuestions.length === 0` guard here skipped building
    // the Phaser game entirely in that case, which left the "Loading
    // climb..." spinner (gated on assetsReady, which only ever flips once
    // scene:ready fires) stuck forever since no scene was ever created.
    if (phase !== "playing" || !containerRef.current) return undefined;
    const emitter = emitterRef.current;
    setAssetsReady(false);

    // Shared with ClimbScene (passed in via game.scene.start below) so the
    // HTML gif overlay is sized/positioned exactly like the Phaser sprite it
    // stands in for.
    const visualScale = getVisualScale(containerRef.current.clientWidth || window.innerWidth);
    const overlayWidth = PLAYER_DISPLAY_WIDTH * visualScale;
    const overlayHeight = PLAYER_DISPLAY_HEIGHT * visualScale;

    // Per-org/theme uploads (Add Gif admin tab) override the bundled
    // /img/*.gif defaults slot-for-slot, falling back to the default
    // whenever a slot hasn't been customized. GIF_SLOTS keys (see
    // themeupdate.jsx) don't line up 1:1 with the run/jump1/jump2/shoot
    // state names used here — "jumping" covers both jump poses, "running"
    // covers run, etc.
    const gifs = gifSettingsRef.current || {};
    const resolveGif = (slot, fallback) =>
      gifs[slot] ? `${process.env.REACT_APP_S3_PATH}${gifs[slot]}` : fallback;
    const effectivePlayerGifs = {
      run: resolveGif("running", PLAYER_GIFS.run),
      jump1: resolveGif("jumping", PLAYER_GIFS.jump1),
      jump2: resolveGif("jumping", PLAYER_GIFS.jump2),
      shoot: resolveGif("shooting", PLAYER_GIFS.shoot),
      victory: resolveGif("victory", PLAYER_GIFS.victory),
    };
    const effectiveEnemyGifs = {
      die: resolveGif("enemydie", ENEMY_GIFS.die),
      // Same source as ENEMY_SHOOT_IMAGE below — see its own comment.
      shoot: resolveGif("enemyshooting", ENEMY_GIFS.shoot),
    };
    const effectivePlayerImage = toGameTextureUrl(resolveGif("static", PLAYER_IMAGE));
    const effectiveEnemyStandImage = toGameTextureUrl(resolveGif("enenystatic", ENEMY_STAND_IMAGE));

    const onEnemyTrigger = ({ question, qIndex }) => setActiveQuestion({ ...question, qIndex });
    const onProgress = (pct) => setProgressPct(pct);
    const onJumpSfx = () => {
      if (!mutedRef.current) soundRef.current.jump();
    };
    const onVictorySfx = () => {
      if (!mutedRef.current) soundRef.current.victory();
    };
    // Preload every action gif up front and keep references alive for the
    // whole "playing" session — without this, the very first time a state
    // (say, a jump) is triggered, swapping the overlay's src kicks off a
    // fresh network fetch + decode, and the gif visibly pops in a beat late
    // ("hide/show") instead of appearing instantly on the frame it's needed.
    const preloadedGifs = [...Object.values(effectivePlayerGifs), ...Object.values(effectiveEnemyGifs)].map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    });

    // The loader only clears once BOTH the Phaser scene has finished building
    // the world (textures loaded, platforms/player/camera placed) AND every
    // gif has actually finished decoding — whichever is slower gates the other.
    let sceneReady = false;
    let gifsReady = false;
    let cancelled = false;
    const revealIfReady = () => {
      if (sceneReady && gifsReady && !cancelled) setAssetsReady(true);
    };
    Promise.all(
      preloadedGifs.map((img) =>
        img.decode
          ? img.decode().catch(() => {})
          : new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            })
      )
    ).then(() => {
      gifsReady = true;
      revealIfReady();
    });
    const onSceneReady = () => {
      sceneReady = true;
      revealIfReady();
    };
    emitter.on("scene:ready", onSceneReady);

    // Two stacked <img> overlays, cross-faded on state change, instead of one
    // element whose src/size is hard-swapped. A hard swap (old code) makes
    // every run<->jump<->shoot<->idle transition pop instantly to the new
    // gif's own size/first-frame pose in a single tick — that's the visible
    // "resize" jump and the jitter/"shaking" reported switching between
    // jump1 and jump2 mid-air. Fading the incoming gif in over the outgoing
    // one (both already decoded, see preloadedGifs above, so there's no
    // network/decode delay to fade in on top of) turns that hard cut into a
    // smooth blend instead.
    const makePlayerLayer = () => {
      const img = document.createElement("img");
      img.alt = "";
      Object.assign(img.style, {
        position: "absolute",
        // Fixed at the container's origin — every frame's actual on-screen
        // position is folded into `transform: translate(...)` below instead
        // of being written here. Moving via left/top forces a synchronous
        // layout reflow on this element every single game tick (~60fps);
        // fighting that against the GIF's own independent ~25fps decode/paint
        // cycle is what caused the visible "blink" while running/jumping.
        // transform-only updates are handled by compositing instead, so the
        // reflow (and the flicker it caused) goes away.
        left: "0",
        top: "0",
        width: `${overlayWidth}px`,
        height: `${overlayHeight}px`,
        opacity: "0",
        pointerEvents: "none",
        zIndex: "5",
        transformOrigin: "50% 100%",
        transition: "opacity 110ms linear",
      });
      containerRef.current.appendChild(img);
      return img;
    };
    const playerLayers = [makePlayerLayer(), makePlayerLayer()];

    // Victory used to get its own dedicated pair of elements — a hidden
    // <img> the browser decoded the gif into, mirrored onto a visible
    // <canvas> every frame via drawImage() on a rAF loop — specifically to
    // dodge a *stale* CORS concern (canvas.toDataURL() on a cross-origin
    // source). But drawImage() never actually needed that workaround here,
    // and browsers are free to pause/step down decoding on an <img> that's
    // never actually visible (opacity: 0 the whole time), which is exactly
    // what made the mirrored gif appear frozen on its first frame instead of
    // animating. Just showing this <img> directly — the same
    // opacity-crossfade pattern already proven out by the run/jump/shoot
    // layers above — sidesteps both problems: the browser only ever needs to
    // *display* it (never read its pixels back out, so CORS is irrelevant),
    // and it's genuinely on-screen the whole time it's meant to be playing.
    const victorySourceImg = document.createElement("img");
    victorySourceImg.alt = "";
    Object.assign(victorySourceImg.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${overlayWidth}px`,
      height: `${overlayHeight}px`,
      opacity: "0",
      pointerEvents: "none",
      zIndex: "5",
      transformOrigin: "50% 100%",
      transition: "opacity 110ms linear",
    });
    // A failed/broken gif src (bad URL, S3/network hiccup — most likely for
    // an org's own custom-uploaded victory gif, see effectivePlayerGifs
    // above) used to fail completely silently, with nothing in the console
    // to explain why the summit looked blank. This logs the failure and
    // retries once with the bundled default Victory.gif if a custom one was
    // what failed — deliberately NOT falling further back to a static player
    // image after that: the real Phaser sprite is already hidden
    // (setAlpha(0)) the whole time the victory overlay is active (see
    // setVisualState), so a static-image fallback here just replaces "gif
    // isn't playing" with "a static image is shown instead of the gif",
    // which reads just as broken. Better to leave the summit blank (and log
    // it) than paper over a real asset problem with a frozen image.
    let victoryTriedDefaultFallback = false;
    victorySourceImg.onerror = () => {
      console.error("[maingame] Victory.gif failed to load:", victorySourceImg.src);
      if (!victoryTriedDefaultFallback && effectivePlayerGifs.victory !== PLAYER_GIFS.victory) {
        victoryTriedDefaultFallback = true;
        console.warn("[maingame] retrying the victory overlay with the bundled default Victory.gif");
        applyVictorySrc(PLAYER_GIFS.victory);
      }
    };
    containerRef.current.appendChild(victorySourceImg);
    // The requested "play once, don't loop" behavior for Victory.gif — see
    // loadPlayOnceGifObjectUrl/stripGifLoopExtension above. Falls back to
    // just assigning the raw (looping) URL directly if the fetch/strip ever
    // fails, so a network hiccup degrades to "loops" rather than "blank".
    let victoryObjectUrl = null;
    const applyVictorySrc = (rawUrl) => {
      loadPlayOnceGifObjectUrl(rawUrl)
        .then((blobUrl) => {
          if (victoryObjectUrl) URL.revokeObjectURL(victoryObjectUrl);
          victoryObjectUrl = blobUrl;
          victorySourceImg.src = blobUrl;
        })
        .catch((err) => {
          console.error("[maingame] Couldn't prepare a single-play Victory.gif, falling back to the raw (looping) source:", err);
          victorySourceImg.src = rawUrl;
        });
    };

    let activeLayer = 0;
    let currentVisualState = null;
    const onPlayerVisual = ({ x, y, flipX, state }) => {
      if (!state) {
        playerLayers.forEach((img) => {
          img.style.opacity = "0";
        });
        victorySourceImg.style.opacity = "0";
        currentVisualState = null;
        return;
      }
      const gifScale = PLAYER_GIF_SCALE[state] || 1;
      // translate() is listed first so it's applied last (after the scale,
      // per how CSS composes a transform list) — the character scales around
      // its own feet (transformOrigin above) and the already-scaled box is
      // then moved into place, all in one compositor-only operation.
      const transform = `translate(${x - overlayWidth / 2}px, ${y - overlayHeight / 2}px) scaleX(${
        flipX ? -gifScale : gifScale
      }) scaleY(${gifScale})`;

      if (state === "victory") {
        if (currentVisualState !== "victory") {
          currentVisualState = "victory";
          console.log("[maingame] entering victory state, gif src:", effectivePlayerGifs.victory);
          playerLayers.forEach((img) => {
            img.style.opacity = "0";
          });
          applyVictorySrc(effectivePlayerGifs.victory);
          victorySourceImg.style.transform = transform;
          requestAnimationFrame(() => {
            victorySourceImg.style.opacity = "1";
          });
        } else {
          victorySourceImg.style.transform = transform;
        }
        return;
      }

      if (state !== currentVisualState) {
        currentVisualState = state;
        victorySourceImg.style.opacity = "0";
        const nextLayer = 1 - activeLayer;
        const incoming = playerLayers[nextLayer];
        const outgoing = playerLayers[activeLayer];
        incoming.src = effectivePlayerGifs[state];
        incoming.style.transform = transform;
        // Flip opacity on the next frame — setting it in the same tick as a
        // fresh src assignment can get coalesced by the browser and skip the
        // transition entirely, popping straight to visible instead of fading.
        requestAnimationFrame(() => {
          incoming.style.opacity = "1";
          outgoing.style.opacity = "0";
        });
        activeLayer = nextLayer;
      } else {
        playerLayers[activeLayer].style.transform = transform;
      }
    };
    emitter.on("player:visual", onPlayerVisual);

    // Guard "death" overlay — plays EnemyDie.gif once at the guard's screen
    // position on a correct answer (see ClimbScene.setEnemyVisual). Sized to
    // whatever width/height the emitted event carries (the guard's own
    // static EnemyShoot.gif display size) so Die and Shoot always render at
    // the same size instead of the die gif being independently sized.
    // Centered on (x, y) via translate(-50%, -50%) — flipX (which side the
    // player was on when the shot was fired/landed) is folded into the same
    // transform as a scaleX, applied after the centering translate so it
    // mirrors around the element's own center rather than shifting it.
    const enemyVisual = document.createElement("img");
    enemyVisual.alt = "";
    Object.assign(enemyVisual.style, {
      position: "absolute",
      objectFit: "contain",
      display: "none",
      pointerEvents: "none",
      zIndex: "4",
    });
    containerRef.current.appendChild(enemyVisual);
    const onEnemyVisual = ({ x, y, width, height, flipX, state }) => {
      if (!state) {
        enemyVisual.style.display = "none";
        return;
      }
      enemyVisual.src = effectiveEnemyGifs[state];
      enemyVisual.style.left = `${x}px`;
      enemyVisual.style.top = `${y}px`;
      const gifScale = ENEMY_GIF_SCALE[state] || 1;
      if (width) enemyVisual.style.width = `${width * gifScale}px`;
      if (height) enemyVisual.style.height = `${height * gifScale}px`;
      enemyVisual.style.transform = `translate(-50%, -50%) scaleX(${flipX ? -1 : 1})`;
      enemyVisual.style.display = "block";
    };
    emitter.on("enemy:visual", onEnemyVisual);

    const onSummit = () => {
      const counts = countsRef.current;
      const total = counts.correct + counts.wrong;
      // Victory sound already played when the Victory.gif sequence started
      // (see "sfx:victory" above) — not re-fired here.
      // Mark the stages row completed so a refresh/relogin can't replay —
      // fire-and-forget, the redirect below doesn't need to wait on it.
      pushExternalReport(pointsRef.current, elapsedRef.current, true);
      // All questions are done once the summit is reached — send the player
      // straight to the thank-you page with their final score/time (same
      // destination the health-depleted case in continueAfterFeedback below
      // redirects to).
      navigate("/thankyou", {
        state: {
          points: pointsRef.current,
          time: elapsedRef.current,
          correctCount: counts.correct,
          wrongCount: counts.wrong,
          accuracy: total > 0 ? Math.round((counts.correct / total) * 100) : 0,
        },
      });
    };

    emitter.on("ENEMY_TRIGGER", onEnemyTrigger);
    emitter.on("PROGRESS", onProgress);
    emitter.on("sfx:jump", onJumpSfx);
    emitter.on("sfx:victory", onVictorySfx);
    emitter.on("SUMMIT_REACHED", onSummit);

    // Fill the actual device viewport (full screen height) instead of a fixed
    // 480x720 box letterboxed by Phaser.Scale.FIT.
    const viewWidth = containerRef.current.clientWidth || window.innerWidth;
    const viewHeight = containerRef.current.clientHeight || window.innerHeight;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: viewWidth,
      height: viewHeight,
      backgroundColor: SKY_FALLBACK_COLOR,
      physics: { default: "arcade", arcade: { gravity: { y: GRAVITY_Y }, debug: false } },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      // Phaser 3.60+/4.x defaults image loading to XHR+blob (for progress
      // events), which requires CORS response headers on the source — our
      // admin-uploaded player_img/enemy_stand/enemy_shoot textures live on
      // an S3 bucket that doesn't send Access-Control-Allow-Origin, so that
      // path fails outright (see the FILE_LOAD_ERROR handler in
      // ClimbScene#preload, which was silently swapping in the bundled
      // default whenever this happened). Falling back to the older plain
      // <img>-tag loader sidesteps that XHR/blob fetch entirely — same
      // reasoning as the DOM gif overlays below (see victorySourceImg's
      // comment).
      //
      // That alone isn't enough for the WebGL renderer, though: uploading
      // any cross-origin <img> as a texture (texImage2D) throws a
      // SecurityError unless the image was actually fetched in CORS mode
      // (crossOrigin set) *and* the server responded with
      // Access-Control-Allow-Origin. toGameTextureUrl() routes the three
      // WebGL-bound textures through our own backend's /proxyImage, which
      // adds that header; crossOrigin: "anonymous" here is what makes the
      // browser request (and check) it. Same-origin bundled defaults are
      // unaffected — crossOrigin is a no-op for same-origin loads.
      loader: { imageLoadType: "HTMLImageElement", crossOrigin: "anonymous" },
      scene: [ClimbScene],
    });
    gameRef.current = game;
    game.scene.start("ClimbScene", {
      emitter,
      questions: shuffledQuestions,
      viewWidth,
      visualScale,
      playerImgUrl: effectivePlayerImage,
      enemyStandUrl: effectiveEnemyStandImage,
      // Loaded as a static Phaser texture (first-frame-only, see
      // ENEMY_SHOOT_IMAGE's comment up top) — same resolved source as the
      // animated DOM "shoot" overlay above, routed through the CORS proxy
      // (see toGameTextureUrl) since this one goes into a WebGL texture.
      enemyShootUrl: toGameTextureUrl(effectiveEnemyGifs.shoot),
    });

    const onWindowResize = () => {
      game.scale.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onWindowResize);
      emitter.off("ENEMY_TRIGGER", onEnemyTrigger);
      emitter.off("PROGRESS", onProgress);
      emitter.off("sfx:jump", onJumpSfx);
      emitter.off("sfx:victory", onVictorySfx);
      emitter.off("SUMMIT_REACHED", onSummit);
      emitter.off("scene:ready", onSceneReady);
      emitter.off("player:visual", onPlayerVisual);
      emitter.off("enemy:visual", onEnemyVisual);
      playerLayers.forEach((img) => img.remove());
      victorySourceImg.remove();
      if (victoryObjectUrl) URL.revokeObjectURL(victoryObjectUrl);
      enemyVisual.remove();
      preloadedGifs.forEach((img) => {
        img.src = "";
      });
      game.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shuffledQuestions]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    const scene = game.scene.getScene("ClimbScene");
    if (!scene) return;
    if (paused || showInfo) scene.physics.pause();
    else if (!activeQuestion) scene.physics.resume();
  }, [paused, activeQuestion, showInfo]);

  /** Push score + current question + elapsed time to the external reports
   * server (add on the first call, then update the same report on every call
   * after). Fires after every answered question, right or wrong, so the
   * report tracks along with the run instead of only landing once at the
   * end. Pass `completed: true` once, when the summit is reached, to mark
   * the stages row `status = 'completed'` so a refresh/relogin can't be used
   * to replay. `questionMeta` (optional `{ questionId, qIndex }`) identifies
   * the question that was just answered, when this call is for an answer
   * rather than a progress/completion tick. */
  const pushExternalReport = async (currentScore, currentTime, completed = false, questionMeta = null) => {
    const role = storedUserData?.role || storedUserData?.source;
    if (role === "demobypass" || role === "DEMO") {
      console.debug("[pushExternalReport] skipped: demo role", role);
      return;
    }
    const userId = storedUserData?.userId || storedUserData?.userid || storedUserData?.id || "";
    if (!userId) {
      console.warn("[pushExternalReport] skipped: no userId in session userData — report API was not called");
      return;
    }

    try {
      const payload = {
        sessionId,
        organizationId,
        userId,
        role,
        token: storedUserData?.token,
        gameId: storedUserData?.gameId,
        name: storedUserData?.name || "",
        points: currentScore,
        time: formatTime(currentTime),
        reportId: reportIdRef.current || undefined,
        questionId: questionMeta?.questionId,
        questionIndex: questionMeta?.qIndex,
      };
      const response = await sendReport(payload);
      const newReportId = extractReportIdFromResponse(response);
      const effectiveReportId = newReportId || reportIdRef.current;

      if (newReportId && newReportId !== reportIdRef.current) {
        // Updated synchronously (not just via setReportId, which only lands
        // on the next render) so a concurrent pushExternalReport call already
        // in flight — or one that fires before this render commits — reads
        // the real id here instead of racing on the stale closure value.
        reportIdRef.current = newReportId;
        setReportId(newReportId);
        try {
          const merged = { ...storedUserData, reportId: newReportId };
          sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(merged));
        } catch (_) {
          /* ignore */
        }
      }

      // Mirror the reportId + score/time onto our own `stages` row too —
      // upserts (update if a row already exists for this user/session/org,
      // insert otherwise), so it stays in sync even for games that never
      // called welcomeStageStart to create the row first.
      if (effectiveReportId && adminToken) {
        try {
          await fetch(`${process.env.REACT_APP_BACKEND_URL}/addReport`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({
              organizationId,
              sessionId,
              userId,
              // Prefer the real email; storedUserData.employeeId is the
              // fallback identifier for accounts that only have one.
              email: storedUserData?.email || storedUserData?.employeeId || "",
              reportId: effectiveReportId,
              name: storedUserData?.name || "",
              themeName: currentTheme,
              current: answeredIdsRef.current,
              answers: answerLogRef.current,
              questionId: questionMeta?.questionId,
              questionIndex: questionMeta?.qIndex,
              points: currentScore,
              total_score: currentScore,
              time: formatTime(currentTime),
              status: completed ? "completed" : undefined,
            }),
          });
        } catch (addReportErr) {
          console.error("Failed to store report:", addReportErr);
        }
      } else {
        console.warn(
          "[pushExternalReport] addReport (current-question/time API) skipped:",
          !effectiveReportId ? "no reportId yet (sendReport didn't return one)" : "no adminToken"
        );
      }
    } catch (error) {
      console.error("Failed to send external report:", error);
    }
  };

  // Shared by both answer paths (MCQ/True-False option tap and Text Input
  // submit) — everything past "was it correct" (points/health, feedback
  // popup, answered-id bookkeeping, report push) is identical either way.
  const resolveAnswer = (correct, correctAnswerText) => {
    if (!activeQuestion) return;
    // Captured before setActiveQuestion(null) below clears it — identifies
    // which question this answer/report call is for.
    const questionMeta = { questionId: activeQuestion.id, qIndex: activeQuestion.qIndex };
    let newPoints = pointsRef.current;
    if (correct) {
      newPoints = pointsRef.current + pointsPerCorrect;
      setPoints(newPoints);
      setCorrectCount((c) => c + 1);
      if (!muted) soundRef.current.correct();
    } else {
      setHealth((h) => Math.max(0, h - 1));
      setWrongCount((w) => w + 1);
      if (!muted) soundRef.current.wrong();
    }
    setFeedback({
      correct,
      correctAnswerText,
      didYouKnow: activeQuestion.didYouKnow,
    });
    setActiveQuestion(null);

    // Record this question as done — used to filter it out of the pool if
    // the page gets refreshed mid-run, so it never shows up twice.
    const newAnsweredIds = [...answeredIdsRef.current, activeQuestion.id];
    const newAnswerLog = [...answerLogRef.current, { id: activeQuestion.id, correct }];
    setAnsweredIds(newAnsweredIds);
    setAnswerLog(newAnswerLog);
    answeredIdsRef.current = newAnsweredIds;
    answerLogRef.current = newAnswerLog;

    pushExternalReport(newPoints, elapsedRef.current, false, questionMeta);
  };

  const handleAnswer = (optionIndex) => {
    if (!activeQuestion) return;
    resolveAnswer(optionIndex === activeQuestion.answerIndex, activeQuestion.options[activeQuestion.answerIndex]);
  };

  // Text Input questions: correct/incorrect is a trimmed, case-insensitive
  // match against correct_answer — matching how the admin form treats
  // True/False answers (also compared uppercased) rather than requiring an
  // exact-character match a player has little chance of typing.
  const handleTextAnswer = (typedValue) => {
    if (!activeQuestion) return;
    const correct = typedValue.trim().toLowerCase() === activeQuestion.correctAnswerText.trim().toLowerCase();
    resolveAnswer(correct, activeQuestion.correctAnswerText);
  };

  const continueAfterFeedback = () => {
    // Resolve the encounter (bullet + Shoot.gif on a correct answer) only once
    // the feedback popup is dismissed — it was firing underneath the popup
    // before, invisible until the popup closed.
    if (feedback) emitterRef.current.emit("quiz:resolve", feedback.correct);
    setFeedback(null);

    const counts = countsRef.current;
    const totalAnswered = counts.correct + counts.wrong;

    // Answering every configured question no longer ends the run on the
    // spot — the player keeps climbing (no more guards left to encounter)
    // until they either physically reach the summit (ClimbScene's
    // topPlatformTile landing -> victory() -> the "SUMMIT_REACHED" handler,
    // which does the completed report push + thank-you redirect) or run out
    // of health, handled just below.

    if (healthRef.current <= 0) {
      // Running out of health ends the run same as reaching the summit or
      // quitting does now — straight to the thank-you page with the final
      // score/time, instead of the in-game "Climb Over" results popup.
      pushExternalReport(pointsRef.current, elapsedRef.current, true);
      navigate("/thankyou", {
        state: {
          points: pointsRef.current,
          time: elapsedRef.current,
          correctCount: counts.correct,
          wrongCount: counts.wrong,
          accuracy: totalAnswered > 0 ? Math.round((counts.correct / totalAnswered) * 100) : 0,
        },
      });
    }
  };

  const startGame = () => {
    // A resumed session already has its points/elapsed/correct-wrong counts
    // restored from fetchReport (see resumedCorrectRef/resumedWrongRef above)
    // — only reset them for a genuinely fresh start. Resuming mid-run also
    // means health has already taken the hit for whatever was answered wrong
    // before the refresh, so it's seeded from maxHealth minus that, not full.
    if (resumedProgress) {
      setCorrectCount(resumedCorrectRef.current);
      setWrongCount(resumedWrongRef.current);
      setHealth(Math.max(0, maxHealth - resumedWrongRef.current));
    } else {
      setCorrectCount(0);
      setWrongCount(0);
      setHealth(maxHealth);
      setPoints(0);
      setElapsed(0);
    }
    setProgressPct(0);
    setResumedProgress(false);
    setPhase("playing");
  };

  // Quitting mid-run (from the Pause popup) ends the run early, same as
  // reaching the summit or running out of questions does — mark the stages
  // row completed (so a refresh/relogin can't resume/replay it) and send
  // the player straight to the thank-you page with the score/time they quit at.
  const quitGame = () => {
    const counts = countsRef.current;
    const totalAnswered = counts.correct + counts.wrong;
    pushExternalReport(pointsRef.current, elapsedRef.current, true);
    navigate("/thankyou", {
      state: {
        points: pointsRef.current,
        time: elapsedRef.current,
        correctCount: counts.correct,
        wrongCount: counts.wrong,
        accuracy: totalAnswered > 0 ? Math.round((counts.correct / totalAnswered) * 100) : 0,
      },
    });
  };

  // Muting mid-run (tapping 🔊 while a beep or the multi-note victory
  // fanfare is still sounding) should cut it off right away, not just block
  // future sfx calls — see PFSound.stopAll().
  const toggleMute = () =>
    setMuted((m) => {
      const next = !m;
      if (next) soundRef.current.stopAll();
      return next;
    });
  const togglePause = () => setPaused((p) => !p);
  const touchPress = (dir, val) => emitterRef.current.emit("touch", dir, val);
  // setPointerCapture on press pins every later event for this touch (up,
  // cancel, or the finger sliding off the element) to the same target — without
  // it, a finger that drags off a button before lifting never fires that
  // button's onPointerUp/onPointerLeave, so its direction/jump reads as stuck
  // "held down" until another touch happens to release it. That's what made
  // double jump (which needs a fresh press, not a still-held one) intermittently
  // fail to register on mobile.
  const touchHandlers = (dir) => ({
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      activeTouchPointersRef.current[e.pointerId] = dir;
      touchPress(dir, true);
    },
    onPointerUp: (e) => {
      delete activeTouchPointersRef.current[e.pointerId];
      touchPress(dir, false);
    },
    onPointerLeave: (e) => {
      delete activeTouchPointersRef.current[e.pointerId];
      touchPress(dir, false);
    },
    onPointerCancel: (e) => {
      delete activeTouchPointersRef.current[e.pointerId];
      touchPress(dir, false);
    },
  });

  if (loadingQuestions) {
    return (
      <div className="pf-climb-root" style={themeTextStyle}>
        <div className="pf-gate">
          <p style={themeTextStyle}>Loading questions...</p>
        </div>
      </div>
    );
  }

  if (loadError || !hasAnyQuestions) {
    return (
      <div className="pf-climb-root" style={themeTextStyle}>
        <div className="pf-gate">
          <h1 style={themeTextStyle}>Peak Force</h1>
          <p style={themeTextStyle}>{loadError || "No questions are available for this theme yet."}</p>
          <button className="pf-btn pf-btn-secondary" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-climb-root" style={themeTextStyle}>
      {phase === "howto" && (
        <div className="pf-gate pf-gate--dim">
          <div className="pf-controls-card" onClick={(e) => e.stopPropagation()}>
            <h1 className="pf-controls-title">Controls</h1>
            <ul className="pf-howto-list">
              <li>
                <span className="pf-howto-keys">
                  <kbd>◀</kbd>
                  <kbd>▶</kbd>
                </span>
                <span className="pf-howto-text">Move left / right — or press <strong>A</strong> / <strong>D</strong></span>
              </li>
              <li>
                <span className="pf-howto-keys">
                  <kbd>⤒</kbd>
                </span>
                <span className="pf-howto-text">Jump — <strong>Up</strong>, <strong>W</strong> or <strong>Space</strong>. Press again mid-air to double jump</span>
              </li>
              <li>
                <span className="pf-howto-keys">
                  <kbd>!</kbd>
                </span>
                <span className="pf-howto-text">Walk into a guard to answer a question</span>
              </li>
              <li>
                <span className="pf-howto-keys">
                  <kbd>★</kbd>
                </span>
                <span className="pf-howto-text">Reach the summit to win the climb</span>
              </li>
            </ul>
            <div className="pf-btn-row" style={{ marginTop: 18 }}>
              <button className="pf-btn" style={themeButtonStyle} onClick={startGame}>
                Begin Climb
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "playing" && (
        <div className="pf-stage">
          {!assetsReady && (
            <div className="pf-loader">
              <div className="pf-loader-spinner" />
              <p>Loading climb...</p>
            </div>
          )}
          <div className="pf-climb-canvas-wrap" ref={containerRef} />
          <div className="pf-hud">
            <div className="pf-hud-topbar">
              <div className="pf-hud-row pf-hud-row--top">
                <div className="pf-health">
                  {Array.from({ length: maxHealth }).map((_, i) => (
                    <div key={i} className={`pf-heart${i < health ? "" : " is-empty"}`} />
                  ))}
                </div>
                <div className="pf-hud-icons">
                  <button className="pf-icon-btn" onClick={toggleMute}>
                    {muted ? "🔇" : "🔊"}
                  </button>
                  <button className="pf-icon-btn" onClick={togglePause}>
                    {paused ? "▶" : "⏸"}
                  </button>
                  <button className="pf-icon-btn" onClick={() => setShowInfo(true)} aria-label="Controls">
                    ℹ
                  </button>
                </div>
              </div>
              <div className="pf-hud-row">
                <div className="pf-hud-stat">⏱ {formatTime(elapsed)}</div>
                <div className="pf-hud-stat">⭐ {points}</div>
              </div>
            </div>
            <div className="pf-progress-vert" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={answeredQuestions}>
              <div className="pf-progress-vert-track">
                <div className="pf-progress-vert-fill" style={{ height: `${questionProgressPct}%` }} />
              </div>
              <span className="pf-progress-vert-label">
                {answeredQuestions}/{maxHealth}
              </span>
            </div>
            <div className={`pf-touch-controls${activeQuestion || feedback || paused || showInfo ? " is-hidden" : ""}`}>
              <div className="pf-touch-side">
                <button className="pf-touch-btn" {...touchHandlers("left")}>
                  ◀
                </button>
                <button className="pf-touch-btn" {...touchHandlers("right")}>
                  ▶
                </button>
              </div>
              <div className="pf-touch-side">
                <button className="pf-touch-btn pf-touch-btn--jump" {...touchHandlers("jump")}>
                  ⤒
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "playing" && (
        <>
          {activeQuestion && (
            <div className="pf-quiz-overlay">
              <div className="pf-quiz-card">
                {/* <div className="pf-quiz-category">{activeQuestion.category}</div> */}
                <p className="pf-quiz-question">{activeQuestion.question}</p>
                {activeQuestion.image && <img className="pf-quiz-image" src={activeQuestion.image} alt="" />}
                {activeQuestion.isTextInput ? (
                  <form
                    className="pf-quiz-text-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!textAnswer.trim()) return;
                      handleTextAnswer(textAnswer);
                    }}
                  >
                    <input
                      type="text"
                      className="pf-quiz-text-input"
                      placeholder="Type your answer"
                      autoFocus
                      autoComplete="off"
                      maxLength={50}
                      value={textAnswer}
                      onChange={(e) => setTextAnswer(e.target.value)}
                    />
                    <button type="submit" className="pf-quiz-option pf-quiz-text-submit" style={themeButtonStyle} disabled={!textAnswer.trim()}>
                      Submit
                    </button>
                  </form>
                ) : (
                  <div className="pf-quiz-options">
                    {activeQuestion.options.map((opt, idx) => (
                      <button key={idx} className="pf-quiz-option" onClick={() => handleAnswer(idx)}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {feedback && (
            <div className="pf-feedback-overlay">
              <div className={`pf-feedback-card ${feedback.correct ? "is-correct" : "is-wrong"}`}>
                <p className="pf-feedback-title">{feedback.correct ? "Correct!" : "Not quite"}</p>
                {!feedback.correct && (
                  <p>
                    Correct answer: <strong>{feedback.correctAnswerText}</strong>
                  </p>
                )}
                {feedback.didYouKnow && <div className="pf-feedback-intel">💡 {feedback.didYouKnow}</div>}
                <button className="pf-btn pf-feedback-continue" style={themeButtonStyle} onClick={continueAfterFeedback}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {paused && !activeQuestion && !feedback && (
            <div className="pf-gate pf-gate--dim" onClick={togglePause}>
              <div className="pf-controls-card" onClick={(e) => e.stopPropagation()}>
                <h1 className="pf-controls-title" style={themeTextStyle}>Paused</h1>
                <div className="pf-btn-row" style={{ marginTop: 18 }}>
                  <button className="pf-btn" style={themeButtonStyle} onClick={togglePause}>
                    Resume
                  </button>
                  <button className="pf-btn pf-btn-secondary" onClick={quitGame}>
                    Quit
                  </button>
                </div>
              </div>
            </div>
          )}

          {showInfo && (
            <div className="pf-gate pf-gate--dim" onClick={() => setShowInfo(false)}>
              <div className="pf-controls-card" onClick={(e) => e.stopPropagation()}>
                <h1 className="pf-controls-title">How To Play</h1>
                <ul className="pf-howto-list">
                  <li>
                    <span className="pf-howto-keys">
                      <kbd>◀</kbd>
                      <kbd>▶</kbd>
                    </span>
                    <span className="pf-howto-text">Move with arrows or <strong>A</strong> / <strong>D</strong></span>
                  </li>
                  <li>
                    <span className="pf-howto-keys">
                      <kbd>⤒</kbd>
                    </span>
                    <span className="pf-howto-text">Jump with <strong>Space</strong> — tap again mid-air to double jump</span>
                  </li>
                  <li>
                    <span className="pf-howto-keys">
                      <kbd>!</kbd>
                    </span>
                    <span className="pf-howto-text">Walk into guards to answer questions</span>
                  </li>
                  <li>
                    <span className="pf-howto-keys">
                      <kbd>★</kbd>
                    </span>
                    <span className="pf-howto-text">Reach the summit with health left to win</span>
                  </li>
                </ul>
                <div className="pf-btn-row" style={{ marginTop: 18 }}>
                  <button className="pf-btn" style={themeButtonStyle} onClick={() => setShowInfo(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
