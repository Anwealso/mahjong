# Sound design

What the game sounds like, when each sound plays, and who hears it. Decision:
[D26](decisions.md#d26-sound-effects-recorded-cc0-clips-played-from-game-events-lobby-music-to-be-chosen).

## Principles

- **You're all on a voice call.** Sounds are short and quiet, and only mark things that matter. There is
  no music during a hand.
- **Sound adds to what's on screen, never replaces it.** Every sound has a visual cue too, so muting
  never hides information.
- **The client decides what to play.** Each `state` message already carries the `events` that just
  happened, filtered for that seat (see [architecture.md](architecture.md)). The client turns those
  events into sounds, so the server doesn't change.

## Sources and licences

| What | Source | Licence |
|---|---|---|
| Tile sounds (clacks, slides, shuffle) | [Kenney *Casino Audio*](https://kenney.nl/assets/casino-audio) (chip, card and dice foley), plus Kenney *Impact Sounds* if needed | CC0 |
| Alerts (your turn, claim ping, host prompt) | Synthesised in the browser with Web Audio (soft sine/triangle tones) | our own |
| Gong (celebration) | ["Gong.wav" by Yin_Yang_Jake007](https://freesound.org/s/406109/) on Freesound (tagged Chinese gong), trimmed to one hit | CC0 |
| Win fanfares, draw-hand thud | Synthesised (pentatonic arpeggios, a falling tone) | our own |
| Cheer (celebration) | ["Small Audience Cheer"](https://freesound.org/s/863035/) on Freesound | CC0 |
| Lobby music | Not chosen yet, see [Lobby music](#lobby-music) | |

- Files live in `packages/client/public/sounds/` as AAC `.m4a` (64 kbps; plays in every browser): 9 files,
  about 110 KB in total. They're small enough to commit directly; see [Where audio files live](#where-audio-files-live).
- Every third-party file is listed in `packages/client/public/sounds/CREDITS.md` with its source URL and
  licence, even CC0 ones.
- No audio library: plain Web Audio (`AudioContext`, decoded buffers, one gain node for volume).

## When sounds play

| Event | Sound | Who hears it |
|---|---|---|
| Deal (`dealt`) | shuffle / wall-building rattle | everyone at the table |
| Discard (`discarded`) | tile clack, a bit quieter for other players' discards | everyone |
| Your draw (`drew` for your seat) | soft tile slide | you only |
| Your turn starts (your normal draw, or the deal when you're dealer) | gentle chime | you only |
| A discard you can claim (`claimWindowOpened` and you have a legal claim) | short bright ping, alongside the glow | you only |
| Someone claims a pung or chow (`melded`) | firmer double clack | everyone |
| Kong (`melded` kong, `kongAdded`) | four-tile clack | everyone |
| Win (`handOver` with a winner) | short fanfare, bigger if you won | everyone |
| Draw hand (`handOver`, wall empty) | low thud / descending tone | everyone |
| Celebration screen | **gong** as the confetti bursts, then a cheer | everyone |
| Host prompt (a player dropped out, a join request) | soft notification | the host only |

**Left out on purpose:**
- Other players' draws: they happen constantly and would just be noise.
- Countdown ticks (claim window, ready-up): stressful, and noisy on a call.
- Lobby join/leave sounds.

**The claim ping and the call.** The ping plays only when *you* can claim, so through an open mic a
friend could hear that you had a claim. With headphones that doesn't happen. We accept this; the ping is
worth more than the small leak.

## Controls

- A **settings menu** behind a gear button in the top-left corner holds a **Sound** slider (with the
  percentage, or "Off" when muted; moving it unmutes). It closes on `Esc` or a click elsewhere; `Esc` there doesn't also pass on
  a claim. Future personal settings go in the same
  menu.
- `M` toggles mute (ignored while typing in a text field).
- Sound is **on by default at about 60%**. The setting is saved in `localStorage`, so each person sets it
  once per browser.
- Browsers block audio until the page has had a click. Joining or creating a room is a click, so the
  `AudioContext` is unlocked then and nobody notices.
- Music has its own volume and mute, separate from sound effects (see below).

## Implementation

- `packages/client/src/sound/cues.ts`: a **pure function**
  `soundsFor(events, mySeat, dealer, legalActions) → Cue[]` (a sound plus a small delay, so sounds in the
  same message don't pile up) that decides what to play for one `state`
  message. Unit tested (e.g. other players' draws are silent, the claim ping only plays when you have a
  claim, a kong plays the kong clack and not the pung one).
- `packages/client/src/sound/player.ts`: creates the `AudioContext` on the first click or key press,
  loads and decodes the files, plays a sound with a per-sound volume (discards get a little random pitch
  so they don't sound mechanical), synthesises the rest, and holds the saved volume/mute. The same sound
  scheduled twice within 50 ms plays once (React StrictMode runs effects twice in dev). Checked in a
  browser, not unit tested.
- `packages/client/src/SettingsMenu.tsx`: the gear button and menu (sound slider) and the `M` shortcut.
- The server sends `.m4a` as `audio/mp4`.
- The store calls `soundsFor` when a `state` message arrives, next to the existing handling of
  `discarded` / `dealt` / `handOver`. Screens with their own moments (celebration, host prompts) play
  their sound when they appear.
- Watchers (not seated) don't receive `state` messages, so they hear nothing during a hand.

## Where audio files live

- **Sound effects: committed in the repo** (`packages/client/public/sounds/`). About 110 KB, smaller than
  `package-lock.json`, and they rarely change. Vite copies them into the build, so the Docker image and Fly
  deploy need nothing extra.
- **Keep them small:** short clips, mono where possible, AAC at 64 kbps. Replace a clip rather than adding
  variants.
- **Music, if we add it, is the size problem** (a 1–2 minute loop is about 1–2 MB, and every new version
  stays in git history forever). Options when we get there:
  - generate it in code (no files at all);
  - **Git LFS**: keeps the repo small, but LFS storage and bandwidth on GitHub are limited and the deploy
    workflow would need `lfs: true` on checkout;
  - host it outside the repo (a GitHub Release asset or object storage) and download it at build time.

## Lobby music

**Status: parked (2026-10-25).** Not being built for now; the notes below are kept for later.

The aim is a loop for the lobby that is fun in the way Kahoot's lobby music is, but with a Chinese
traditional flavour, like the backing of Fei Yu-ching's *Yi Jian Mei* (一剪梅).

**Constraints:**
- We can't use *Yi Jian Mei* or Kahoot's music, or close soundalikes: both are copyrighted. We can aim
  for the *feel* (instruments, groove, scale) with an original melody, or arrange a public-domain folk
  tune such as *Mo Li Hua* (茉莉花, "Jasmine Flower").
- It plays in the lobby only, never during a hand, and fades out when a hand is dealt.

**Moods being explored:**
- **A. "Kahoot in Chinatown":** bouncy and a bit silly. Pentatonic plucked hook (guzheng/pipa), walking
  bass, woodblock, around 120 bpm.
- **B. Teahouse:** calm guzheng and dizi flute, unhurried.
- **C. 80s Mandopop backing:** the *Yi Jian Mei* feel. Lush strings, an erhu lead and a slow ballad
  groove, a little kitsch.
- **D. Lunar New Year:** gongs, drums and suona. Festive, but probably too loud for a lobby.

**Ways to get it:**
- **Existing CC0 tracks:** BiteMe Games' *Lotus Pond* ([itch.io](https://bitemegames.itch.io/chinese-game-music),
  guzheng/flute/drums, 60 s loop; fits B), or wipics' erhu *Menu Music* on OpenGameArt (inspired by Club
  Penguin's dojo; between A and B).
- **Generated in the browser** with Web Audio: plucked strings, woodblock and bass written in code. No
  files or licences, and easy to tweak together. It can also react to the lobby, for example adding a layer
  each time a seat fills. It sounds charming rather than realistic.
- **An arrangement of *Mo Li Hua*** in mood A or C: instantly reads as Chinese, with no copyright
  problem.
- **CC BY or paid royalty-free music** (Kevin MacLeod / incompetech, TunePocket, MelodyLoops): needs
  attribution or a fee.
- **AI music generators:** quick to try, but the licence depends on the plan, so not preferred.

Decisions still open: which mood, which way to get it, whether music also plays at wind breaks, and the
default music volume. They will be recorded here and in D26 once chosen.
