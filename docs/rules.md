# Rules: Hong Kong Chicken Hand (雞糊)

The rules this game implements. This is the spec the engine (`packages/engine`) is written and tested against.
Settings marked **configurable** live in `RuleConfig` (`packages/engine/src/rules.ts`). The defaults below are
what our group plays.

## Tiles

136 tiles, 4 copies of each of 34 kinds. **No flowers or seasons.**

| Group | Kinds | Code in notation |
|---|---|---|
| Characters (萬) | 1–9 | `1c` … `9c` |
| Dots (筒) | 1–9 | `1d` … `9d` |
| Bamboo (索) | 1–9 | `1b` … `9b` |
| Winds | East, South, West, North (東南西北) | `E` `S` `W` `N` |
| Dragons | Red, Green, White (中發白) | `R` `G` `Wh` |

Compact notation (used in tests and debug output) writes suited runs as digits plus a suit letter, and
honors as repeated codes: `123c 456d 789b EEE RR`.

## Seating and the deal

- Four players. Turn order goes counter-clockwise: East → South → West → North. The player "on your left"
  is the one who plays just before you.
- The dealer (East) starts with 14 tiles, everyone else 13. The dealer plays first by discarding.
- Normal draws come from the front of the wall. Kong replacement draws come from the back.
- **Play continues to the very last tile.** No tiles are held back. If a draw is needed and the wall is
  empty, the hand is a draw. A kong can't be declared once the wall is empty, because there's no
  replacement tile.

## Turn sequence

1. **Draw** a tile (skipped for the dealer's first turn and right after claiming a chow or pung).
2. Optionally:
   - declare a **self-drawn win** (自摸), or
   - declare a **concealed kong** (4 of a kind in hand) or an **added kong** (4th tile onto your exposed
     pung). Either one takes a replacement draw, then you continue from step 2.
3. **Discard** one tile face up.
4. **Claim window:** the other players may claim that discard (see below). If nobody claims it, the next
   player in turn order draws.

## Claiming a discard

Claiming takes **two steps**:

1. **Claim the tile.** After a discard, anyone who could use it (see the table) may click it to take it.
   You don't say what it's for yet. **First come, first served:** the first claim gets the tile, whatever
   it's for. The server handles one message at a time, so there are never ties. Everyone else just sees
   that you claimed it.
2. **Use the tile.** You must now use it. Play doesn't continue until you do, and there's no backing out.
   Either declare a **win**, if the tile completes your hand, or **form a set**: choose which set (if
   the tile fits more than one) and pick the tiles from your hand. Only tiles that fit are offered.
   Then discard as usual. Play continues from you, so turns can be skipped.

| Use | Who may claim for it | Needs in hand | After forming |
|---|---|---|---|
| **Win** (食糊) | Anyone | A hand that wins with this tile | The hand ends |
| **Pung** (碰) | Anyone | 2 of the same kind | Discard (no draw) |
| **Exposed kong** (槓) | Anyone | 3 of the same kind | Replacement draw, then discard |
| **Chow** (上) | **Only the next player** (the discarder is on their left) | 2 tiles completing a run of 3 in one suit | Discard (no draw) |

For example, holding `34 67` of bamboo, a discarded `5` could become `345`, `456`, or `567`: you choose.
Holding `55 46`, it could be a pung or a chow.

**Claim timing:** after each discard the server opens a claim window of **at most 5 seconds**. Players who
couldn't use the tile pass automatically. The window closes as soon as **someone claims**, as soon as
**every eligible player has passed**, or when the 5 seconds run out (anyone who hasn't answered passes).

**Passing up a win is allowed.** A win is never automatic: a player who could win on a discard can pass,
or claim it and form a set instead, and a player who self-draws a winning tile can just discard. There's
no penalty for passing, and later wins aren't restricted. (This also keeps everyone paying attention.)

## Sets: locked, and personal groups

**Sets made from a claimed discard are locked.** Once formed, they're placed face-up in front of the
player. Their tiles can never be discarded, rearranged, or used in another set. (Otherwise you could claim
any tile you hold a pair of, "form" a pung, then break it up again: claiming would become a free way to
grab discards.) The one change allowed is the **added kong**: add the 4th matching tile from your hand to
your own exposed pung.

**Concealed kongs** are declared by selecting all four tiles. They're locked too, take a replacement
draw, and are shown to the table so everyone knows their kind.

**Personal groups are free.** Players may group their own concealed tiles into "soft" sets to keep track
of them. Only a **complete set** (a pung or chow of three loose tiles) can be grouped; groups sit to the
left of your loose tiles, and you can ungroup one at any time. Discarding or using a grouped tile simply
breaks that group up. These groups have no meaning in the rules, are never formed automatically, and are
**private**: they live only on the player's own screen (saved in the browser so they survive a refresh).
You never need them to win: the engine checks the whole hand when you declare a win.

Any concealed tile may be discarded, including straight after a claim. For example, after claiming a `4`
to chow `456` you may discard a `7` you were holding. (Some rule sets ban this; casual Hong Kong play
doesn't.)

## What other players see

For every player, everyone sees:

- their **locked sets**, face up, and their discards;
- how many tiles are in their hand;
- **how many complete sets their concealed tiles contain**, shown face down. The server always counts the
  best possible grouping, whether or not the player groups anything themselves, so personal groups give
  no advantage or disadvantage.

What's never shown: which tiles are in those concealed sets, whether they're pungs or chows, and any
pairs or partial runs (e.g. `4-5` or `4-6`). Those all count as loose tiles. So the table can see when
someone is **one set** from winning, but not when they're one tile away.

## Winning hands

A winning hand is 14 tiles (counting each kong as 3) made of:

- **4 sets + 1 pair.** A set is a pung (3 of a kind), a kong (4 of a kind), or a chow (a run of 3 in one
  suit; honors can't form chows, and runs don't wrap from 9 to 1).
- Any mix of exposed and concealed sets, any suits. **There's no minimum score** in Chicken Hand.

Special hands, all **off by default** (configurable):

| Setting | Hand | Notes |
|---|---|---|
| `thirteenOrphans` | Thirteen Orphans (十三么): one of each 1, 9, wind, and dragon, plus a pair of any of them | Fully concealed only |
| `sevenPairs` | Seven Pairs (七對): seven different pairs | Fully concealed only; 4 of a kind doesn't count as two pairs |
| `robbingKong` | Robbing the kong (搶槓): win on the tile another player adds to their pung to make a kong | — |

## Payment

There's no flowers and no faan counting; every win is worth the same.

| How the hand was won | Who pays |
|---|---|
| On a discard | **The discarder pays 1** to the winner |
| Self-drawn | **Each of the other three pays 1** to the winner |
| Wall runs out (draw hand) | Nobody |

The discarder never pays double. **Kongs pay nothing**: a kong is just a set.

## Dealer and rounds

- The first dealer of a game is chosen at random.
- The dealer **keeps the deal** after a dealer win or a draw hand (no limit on how many times in a row).
  Otherwise the deal passes to the next player in turn order.
- After the deal has gone all the way round, the prevailing wind advances: East → South → West → North,
  then back to East. **Games are open-ended:** at the end of each wind the players vote on whether to
  continue. Scores are running totals kept per seat. See [game-flow.md](game-flow.md) for wind breaks,
  readying up between hands, the host, and what happens when people leave or join.
- Seat and prevailing winds don't affect scoring under these rules; they're tracked for display and for
  possible faan scoring later.

## Not in v1

Flowers and seasons, faan scoring and score limits, discarder-pays-double, and penalties for false wins.
All of them would plug into the separate scoring module or `RuleConfig` without changes to the turn logic.

## Glossary

| Term | Meaning |
|---|---|
| Chow (上 / 吃) | A run of 3 consecutive tiles in one suit |
| Pung (碰) | 3 identical tiles |
| Kong (槓) | 4 identical tiles; takes a replacement draw |
| Exposed / concealed | Whether a set is shown on the table or hidden in hand |
| Self-draw (自摸) | Winning with a tile you drew yourself |
| Waiting / ready | One tile away from a winning hand |
| Wall | The face-down stack of tiles left to draw |
| Prevailing wind | The wind of the current round |
