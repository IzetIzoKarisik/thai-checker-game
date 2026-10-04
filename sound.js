/* ==========================================================================
   Mak-hos (หมากฮอส) — sound effects.

   Picking a piece up: a light wooden knock.   Moving it: a soft slide on the wood.
   Putting it down: a heavier wooden knock (both knocks are recordings in sounds/).
   A capture: two clacks.   A man becoming a king: a little chime.   Game over: low clacks.
   ========================================================================== */

let audio;               // the browser's audio engine, created on the first sound
let noise;               // a second of noise, for the slide
let masterGain;          // the volume of everything made with the audio engine
let soundOn = true;      // the "Move sounds" switch in Settings
let soundVolume = 0.8;   // 0–1, the "Move sounds" slider in Settings (0.8 sounds like the original)

function setSoundOn(on) {
  soundOn = on;
}

function setSoundVolume(volume) {
  soundVolume = volume;
  if (masterGain) masterGain.gain.value = soundGain();
}

// 1 at the default slider position, a little more at the top, less at the bottom.
function soundGain() {
  return soundVolume / 0.8;
}

function setUpSound(context) {
  audio = context;
  masterGain = audio.createGain();
  masterGain.gain.value = soundGain();
  masterGain.connect(audio.destination);

  noise = audio.createBuffer(1, Math.round(audio.sampleRate * 0.5), audio.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
}

// A pure tone that starts loud and dies away.
function ping(frequency, volume, length, when) {
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(volume, when);
  envelope.gain.exponentialRampToValueAtTime(0.001, when + length);
  oscillator.connect(envelope);
  envelope.connect(masterGain);
  oscillator.start(when);
  oscillator.stop(when + length + 0.02);
}

// Noise through a filter whose pitch glides from one value to another.
// A very short one is a "click", a longer one is a slide.
function noiseBurst(filterType, from, to, volume, length, attack, when) {
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();
  source.buffer = noise;
  filter.type = filterType;
  filter.frequency.setValueAtTime(from, when);
  filter.frequency.exponentialRampToValueAtTime(to, when + length);
  envelope.gain.setValueAtTime(0.001, when);
  envelope.gain.exponentialRampToValueAtTime(volume, when + attack);
  envelope.gain.exponentialRampToValueAtTime(0.001, when + length);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(masterGain);
  source.start(when);
  source.stop(when + length + 0.02);
}

// A wooden knock: three short tones plus a click. `pitch` makes it higher or lower.
function clack(when, volume, pitch = 1) {
  const wobble = 0.96 + Math.random() * 0.08;        // never exactly the same twice
  ping(820 * pitch * wobble, volume * 0.5, 0.09, when);
  ping(1650 * pitch * wobble, volume * 0.3, 0.06, when);
  ping(2500 * pitch * wobble, volume * 0.15, 0.04, when);
  noiseBurst("highpass", 1500, 1500, volume * 0.35, 0.03, 0.001, when);
}

// Recorded wood knocks (Kenney "Impact Sounds", CC0). Five takes of each,
// one picked at random so it never sounds exactly the same twice.
const takes = (name) => [0, 1, 2, 3, 4].map((i) => `sounds/impactWood_${name}_00${i}.ogg`);
const RECORDINGS = { pick: takes("light"), move: takes("medium") };

function playRecording(kind, volume) {
  const files = RECORDINGS[kind];
  const sound = new Audio(files[Math.floor(Math.random() * files.length)]);
  sound.volume = Math.min(1, volume * soundGain());
  sound.play().catch(() => { /* the browser may block sound before the first click */ });
}

function playSound(kind) {
  if (!soundOn || soundVolume === 0) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;   // browsers allow sound only after the first click or key press
  if (!audio) setUpSound(new AudioContext());
  if (audio.state === "suspended") audio.resume();

  const now = audio.currentTime;
  if (kind === "pick") playRecording("pick", 0.5);
  if (kind === "slide") noiseBurst("bandpass", 600, 1100, 0.35, 0.22, 0.06, now);
  if (kind === "move") playRecording("move", 0.9);
  if (kind === "capture") { clack(now, 0.75); clack(now + 0.11, 0.55, 0.8); }
  if (kind === "crown") { ping(880, 0.25, 0.7, now); ping(1320, 0.2, 0.8, now + 0.08); ping(1760, 0.16, 1.0, now + 0.16); }
  if (kind === "end") { clack(now, 0.7, 0.7); clack(now + 0.18, 0.7, 0.6); clack(now + 0.36, 0.75, 0.5); }
}
