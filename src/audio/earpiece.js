// Earpiece voice-line system: pairs each handler line with an audio clip
// and the caption text, so dropping in real voice recordings later is
// just adding files to public/assets/audio/earpiece/ with matching names.
// If a clip is missing or fails to load, the line still plays as a caption
// only, it never blocks the game.

const LINES = {
  levelStart: {
    text: '"You\u2019re in. Stay low, stay quiet \u2014 WASD to move, mouse to look around. Don\u2019t run unless I tell you to."',
    file: 'level-start.mp3',
  },
  lingeringNearGuardA: {
    text: '"That one\u2019s alone for now. His partner won\u2019t be far, though \u2014 watch for him."',
    file: 'lingering-guard-a.mp3',
  },
  takedown: {
    text: '"Good. Take his uniform, it\u2019ll buy you some room if you\u2019re not careless."',
    file: 'takedown.mp3',
  },
  enterOffices: {
    text: '"Keycard should be in here somewhere. Check the desks."',
    file: 'enter-offices.mp3',
  },
  keycardPickup: {
    text: '"That\u2019s it \u2014 now get out before that guard finishes his loop."',
    file: 'keycard-pickup.mp3',
  },
  alarmPartnerFound: {
    text: '"His partner found the body \u2014 they know you\u2019re in the building. Elevator, now!"',
    file: 'alarm-partner-found.mp3',
  },
  alarmSpotted: {
    text: '"You\u2019ve been spotted \u2014 they know you\u2019re in the building. Elevator, now!"',
    file: 'alarm-spotted.mp3',
  },
  elevatorNoCard: {
    text: '"No card, no ride. Find it, fast!"',
    file: 'elevator-no-card.mp3',
  },
  elevatorWin: {
    text: '"Doors are open \u2014 go, go!"',
    file: 'elevator-win.mp3',
  },
  caught: {
    text: '"You\u2019ve been caught \u2014 resetting the mission."',
    file: 'caught.mp3',
  },
  timeout: {
    text: '"Too slow \u2014 they\u2019ve got you. Resetting the mission."',
    file: 'timeout.mp3',
  },
};

// Relative path, no leading "/", matching the same reasoning as the model
// paths in guards.js and player.js (LAMP subdirectory hosting).
const AUDIO_BASE = './assets/audio/earpiece/';
const clips = {}; // key -> HTMLAudioElement
let currentClip = null;

// Preload every clip. Missing files just fail silently per-clip (caught
// individually), so one missing recording doesn't break the rest.
export function loadEarpieceAudio() {
  Object.entries(LINES).forEach(([key, line]) => {
    const audio = new Audio(AUDIO_BASE + line.file);
    audio.preload = 'auto';
    audio.addEventListener('error', () => {
      console.warn(`[earpiece] missing or unplayable clip for "${key}": ${line.file}`);
    });
    clips[key] = audio;
  });
}

// Returns the caption text for a line, useful anywhere you want the text
// without also playing audio.
export function getLineText(key) {
  return LINES[key]?.text ?? '';
}

// Plays the clip for `key` (cutting off whatever's currently playing, same
// as a real earpiece talking over itself) and returns its caption text so
// the caller can show it alongside. Safe to call even if audio isn't
// loaded or available yet, since a missing clip just leaves the caption
// as the only feedback.
export function playLine(key) {
  const line = LINES[key];
  if (!line) return '';

  if (currentClip) {
    currentClip.pause();
    currentClip.currentTime = 0;
  }

  const clip = clips[key];
  if (clip) {
    clip.currentTime = 0;
    clip.play().catch(() => {
      // Autoplay/permission errors, or the file genuinely doesn't exist yet.
      // The caption still gets shown by the caller either way.
    });
    currentClip = clip;
  }

  return line.text;
}