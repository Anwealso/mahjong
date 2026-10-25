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
| Gong (celebration) | A CC0 Chinese/opera gong from [Freesound](https://freesound.org), chosen when building it; synthesised as a fallback | CC0 |
| Fanfare, draw-hand thud, cheer | CC0 clips (Kenney or Freesound), or synthesised | CC0 / our own |
| Lobby music | Not chosen yet, see [Lobby music](#lobby-music) | |

- Files live in `packages/client/public/sounds/` as small `.ogg`/`.mp3` files, about 10 files and under
  100 KB in total (music not included).
- Every third-party file is listed in `packages/client/public/sounds/CREDITS.md` with its source URL and
  licence, even CC0 ones.
- No audio library: plain Web Audio (`AudioContext`, decoded buffers, one gain node for volume).

## When sounds play

| Event | Sound | Who hears it |
|---|---|---|
| Deal (`dealt`) | shuffle / wall-building rattle | everyone at the table |
| Discard (`discarded`) | tile clack, a bit quieter for other players' discards | everyone |
| Your draw (`drew` for your seat) | soft tile slide | you only |
| Your turn starts | gentle chime | you only |
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

- A speaker button in the top corner mutes and unmutes; next to it is a volume slider.
- `M` toggles mute (ignored while typing in a text field).
- Sound is **on by default at about 60%**. The setting is saved in `localStorage`, so each person sets it
  once per browser.
- Browsers block audio until the page has had a click. Joining or creating a room is a click, so the
  `AudioContext` is unlocked then and nobody notices.
- Music has its own volume and mute, separate from sound effects (see below).

## Implementation

- `packages/client/src/sound/cues.ts`: a **pure function**
  `soundsFor(events, mySeat, legalActions, prev) → SoundId[]` that decides what to play for one `state`
  message. Unit tested (e.g. other players' draws are silent, the claim ping only plays when you have a
  claim, a kong plays the kong clack and not the pung one).
- `packages/client/src/sound/player.ts`: loads and decodes the files once, plays a `SoundId` with a
  per-sound volume, and holds the master gain and mute. Checked by hand, not unit tested.
- The store calls `soundsFor` when a `state` message arrives, next to the existing handling of
  `discarded` / `dealt` / `handOver`. Screens with their own moments (celebration, host prompts) play
  their sound when they appear.
- Watchers (not seated) don't receive `state` messages, so they hear nothing during a hand.

## Lobby music

**Status: under discussion.** The aim is a loop for the lobby that is fun in the way Kahoot's lobby music
is, but with a Chinese traditional flavour, like the backing of Fei Yu-ching's *Yi Jian Mei* (一剪梅).

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
