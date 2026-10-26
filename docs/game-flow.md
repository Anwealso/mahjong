# Game flow: rooms, hosts, hands, winds, and dropouts

How a game runs around the hands themselves: who controls the room, how hands and prevailing winds follow
each other, how scores are kept, and what happens when people leave, drop out, or join part-way. The rules
of a single hand are in [rules.md](rules.md). Decisions: [D22](decisions.md#d22-open-ended-games-wind-breaks-and-unanimous-continue-votes),
[D23](decisions.md#d23-host-seat-owned-scores-and-handling-dropouts).

## Timings

| What | How long |
|---|---|
| Claim window | at most 5 s ([D10](decisions.md#d10-claim-window-at-most-5-seconds-closes-early)) |
| Ready countdown between hands | 10 s (paused while a seat is empty or its player is offline) |
| Idle player (no move when it's their decision) | 60 s, then the host may replace them |
| Wind-break vote | no time limit; after 30 s the host may remove someone who hasn't voted |
| Bot thinking time (every level) | 0.8–2 s to claim or pass, 1–2.5 s on its own turn |
| Room with nobody connected | deleted after 30 min |
| Disconnected watcher (not seated) | dropped from the room after 10 min |

## The host

- The member who **creates the room** is the host (shown with a crown).
- If the host disconnects or leaves the room, the connected human who has been in the room longest becomes
  host. Hosting doesn't pass back when they return.
- Bots are never host.

## Seats and scores

- **Scores belong to seats, not people.** Each seat starts the game at 0. Whoever sits in a seat (a person
  or a bot) plays for that seat's score, and someone who takes over a seat inherits its score.
- Whoever creates the room starts in the East seat (seat 1); they can move or leave it like anyone else.
- Before a game starts, anyone may take an empty seat or leave theirs. The host can **remove** a player
  (they become a watcher) and **fill empty seats with bots**.
- Once a game has started, seats change only in the ways described below.

## Starting a game

- The host clicks **Start game** once all four seats are filled.
- The **first dealer is chosen at random**, once per game. After that the deal rotates (see below).

## Game settings

Set by the host in the lobby **before the game starts**; everyone else sees them read-only. They're fixed
for the whole game (also while paused) and carry over to the next game.

| Setting | Default | Effect |
|---|---|---|
| Dealer keeps the deal | **Off** | Off: the deal passes on after every hand, so a wind is exactly 4 hands. On: the dealer keeps the deal after a dealer win or a draw |
| Bot level | **Medium** | Easy, Medium or Hard ([bots.md](bots.md)). Used for new bots and for bots that take over from people. The host can change it **before a game or while paused**, and it changes every bot; the host can also set one bot's level on its seat card |

## Dealer, winds, and rounds

- By default the deal passes to the next seat in turn order after every hand. With **Dealer keeps the
  deal** on, the dealer keeps it after a dealer win or a draw.
- A **wind** (prevailing-wind round) lasts until the deal has passed all the way round the table and back to
  the seat that dealt first in the game: exactly 4 hands by default, more when dealers keep the deal. Then the
  prevailing wind advances East → South → West → North, and after North it wraps back to East. The table
  shows "Round N · 東" etc.
- **Games are open-ended.** They don't stop after four winds; they end only when the players stop at a wind
  break (below).
- Seat winds follow the dealer: the dealer is East, the next seat South, and so on.

## Between hands

When a hand ends, everyone sees the result: who won and how, the hand's payments, and the running totals.
All hands are revealed, and the winner's hand is formed up into its sets and pair (with the winning tile
highlighted), both at their seat and in the result panel.

- Each seated person clicks **Ready**. The next hand is dealt as soon as every seated person is ready, or
  automatically after a **10 s countdown**.
- The countdown **stops while any seat is empty or its player is offline**, and starts again from 10 s
  once the host fills the seat (or the player comes back).
- **Anyone** can click **Return to lobby** instead. The game is then **paused** in the lobby (for a drink,
  a break, a seat change). Scores, dealer, and wind are kept. In the paused lobby:
  - the scoreboard is shown;
  - the host can remove players and fill empty seats with bots;
  - newcomers (and anyone else) can take over a bot's seat by picking it, inheriting its score;
  - the **host** clicks **Resume** to deal the next hand, once all four seats are filled.
- After the last hand of a wind, the **wind break** happens instead of the ready countdown.

## Wind break

At the end of each wind everyone goes back to the lobby, which shows a special end-of-wind view:

- a big background logo of the wind that just finished (東, 南, 西 or 北);
- a **podium** for that wind: the top three seats by points won during it;
- the overall **leaderboard** (running totals);
- each seated person's vote, and two buttons: **Continue to next wind** and **Leave**.

Rules:

- There's no countdown. Continuing needs a **unanimous** vote of the seated people (bots don't vote).
- Choosing **Leave** gives up your seat: a bot takes it over immediately (keeping the seat's score), and
  you see the final celebration screen as a watcher.
- If someone hasn't voted after **30 s**, the host can **remove** them; a bot takes their seat.
- When every remaining seated person has voted to continue, the next wind's first hand is dealt.
- If nobody is left in a seat (everyone left or was removed), the **game is over** for everyone.

## End of the game: the celebration screen

Shown when the game is over, and to anyone who leaves at a wind break:

- confetti for **1st and 2nd place** (tied seats share a place);
- the full scoreboard underneath.

The host clicks **New game** to return to the lobby with all scores reset (seats stay as they are).

## Bots

Bots play at the room's **bot level** (Easy, Medium or Hard; see [bots.md](bots.md)) with the same
human-like timing at every level. **Dealer keeps the deal** is off by default partly because the
original random bots never won, so the dealer never moved; the smarter bots finish almost every hand.

## Dropouts during a hand

There's no automatic play for a missing person ([D23](decisions.md#d23-host-seat-owned-scores-and-handling-dropouts)).
Instead the **host is prompted** when a seated person:

- clicks **Leave** at the table (their seat becomes empty and they become a watcher),
- **disconnects**, or
- makes **no move for 60 s** when it's their decision (their turn, or using a tile they claimed).

The prompt offers:

- **Replace with a bot:** a bot takes the seat at once and plays the rest of the hand and the game.
- **Wait:** close the prompt and wait for them.
- **Return to lobby & cancel the hand:** the hand is thrown away (no payments, it doesn't count) and the
  game is paused in the lobby. When the host resumes, the **same dealer deals again**.

While a disconnected person's decision is pending, the game simply waits. In claim windows they pass
automatically when the 5 s run out, as anyone does.

**Coming back:**

- A person who **disconnected** gets their seat back automatically when they reconnect, even mid-hand and
  even if a bot took over.
- A person replaced for being **idle** can click **Take my seat back** at any time.
- A person who chose to **leave** has given up the seat; they can ask to play like a newcomer.

## Server restarts and limits

- A deploy or restart of the server ends every game in progress (rooms live in memory). Players see "The
  server is restarting", and when they reconnect they're told the room is gone and go back to the join
  screen.
- Limits: at most 100 rooms on the server, 12 people per room (players and watchers; bots don't count), and
  5 new rooms per minute from one browser connection.

## Joining part-way through a game

- **During a hand or between hands:** a watcher clicks **Request to play**. The host sees an approve /
  decline prompt. When approved, the newcomer fills an **empty seat** if there is one, otherwise replaces
  **a random bot** straight away (mid-hand included), taking over its tiles and the seat's score. Bots
  keeping a seat for someone who was replaced are only used if there's no other bot. Requests are only
  possible while at least one seat is empty or played by a bot.
- **While paused in the lobby (or at a wind break):** a watcher picks which bot to take over from. No
  approval is needed.
