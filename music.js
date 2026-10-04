/* ==========================================================================
   Mak-hos (หมากฮอส) — background music.

   Bach, Prelude No. 1 in C major (BWV 846), solo piano by Kimiko Ishizaka,
   from the "Open Well-Tempered Clavier". Public domain (CC0), from
   https://commons.wikimedia.org (see also welltemperedclavier.org)

   Browsers do not allow sound before the first click, so the music starts
   with the first click or key press on the page.
   ========================================================================== */

const MUSIC_FILE = "sounds/bach-prelude-c-major.ogg";

let musicVolume = 0.55;      // 0–1: the "Music" slider in Settings. The recording itself is soft; this is a bit quieter than before.

const music = new Audio(MUSIC_FILE);
music.loop = true;
music.volume = 0;

let musicFade = null;        // the volume slide that is running, if any
let musicOn = readMusicSetting();

/* ---------- Remembering the setting ---------- */

function readMusicSetting() {
  try { return localStorage.getItem("music") !== "off"; } catch { return true; }
}

function saveMusicSetting(on) {
  try { localStorage.setItem("music", on ? "on" : "off"); } catch { /* private mode: just don't remember */ }
}

/* ---------- Playing ---------- */

// Slides the volume to `target` in small steps (under a second), then calls `done`.
function fadeMusic(target, done = () => {}) {
  clearInterval(musicFade);
  musicFade = setInterval(() => {
    const gap = target - music.volume;
    if (Math.abs(gap) <= 0.02) {
      music.volume = target;
      clearInterval(musicFade);
      done();
    } else {
      music.volume += Math.sign(gap) * 0.02;
    }
  }, 40);
}

function startMusic() {
  music.play().catch(() => { /* blocked until the first click: tried again then */ });
  fadeMusic(musicVolume);
}

function setMusicVolume(volume) {
  musicVolume = volume;
  if (musicOn && !music.paused) fadeMusic(volume);
}

function stopMusic() {
  fadeMusic(0, () => music.pause());
}

/* ---------- Buttons ---------- */

function setMusic(on) {
  musicOn = on;
  saveMusicSetting(on);
  document.querySelector("#music-btn").setAttribute("aria-pressed", on);
  document.querySelector('[data-toggle="music"]').checked = on;
  if (on) startMusic(); else stopMusic();
}

document.querySelector("#music-btn").addEventListener("click", () => setMusic(!musicOn));
document.querySelector('[data-toggle="music"]').addEventListener("change", (event) => setMusic(event.target.checked));

// Show the saved setting, and start the music on the first click or key press.
document.querySelector("#music-btn").setAttribute("aria-pressed", musicOn);
document.querySelector('[data-toggle="music"]').checked = musicOn;
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => { if (musicOn) startMusic(); }, { once: true });
}

// Pause the music while the tab is hidden.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) music.pause();
  else if (musicOn && music.currentTime > 0) music.play().catch(() => {});
});
