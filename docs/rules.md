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

| Claim | Who may claim | Needs in hand | Result |
|---|---|---|---|
| **Win** (食糊) | Anyone | A hand that wins with this tile | Hand ends |
| **Pung** (碰) | Anyone | 2 of the same kind | Expose the pung, then discard (no draw) |
| **Exposed kong** (槓) | Anyone | 3 of the same kind | Expose the kong, take a replacement draw, then discard |
| **Chow** (上) | **Only the next player** (the discarder is on their left) | 2 tiles completing a run of 3 in one suit | Expose the chow, then discard (no draw) |

**Priority:** win > pung / kong > chow. If two players want the same discard for different claims, the
higher-priority claim wins. Play then continues from the claimer, so turns can be skipped.

**Multiple winners on one discard** (configurable, `multipleWinners`):
- `headBump` (default, 截糊): only the claimant closest in turn order after the discarder wins.
- `all`: every claimant wins and the discarder pays each of them.

**Claim timing:** after each discard the server opens a claim window of **at most 5 seconds**. Players
with no legal claim pass automatically. The window closes **as soon as every eligible player has
answered**, or when the 5 seconds run out; anyone who hasn't answered by then passes.

**Passing up a win is allowed.** A win is never automatic: a player who could win on a discard can pass,
and a player who self-draws a winning tile can just discard instead. There's no penalty for passing, and
later wins aren't restricted. (This also keeps everyone paying attention.)

## Declared sets are locked

Once a set is declared (a chow, pung, or kong claimed from a discard, or a concealed kong), it's placed in
front of the player and **locked**. Its tiles can never be discarded, rearranged, or used in another set.
Discards always come from the player's remaining hand tiles.

A **concealed kong is shown to the table** once declared, so everyone knows its kind.

Any tile still in your hand may be discarded, including straight after a claim. For example, after
claiming a `4` to chow `456` you may discard a `7` you were holding. (Some rule sets ban this; casual Hong
Kong play doesn't.)

The one exception is the **added kong**: a player may add the 4th matching tile to their own exposed pung,
turning it into a kong. The pung's tiles stay together; the set just grows.

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

- The dealer **keeps the deal** after a dealer win or a draw hand. Otherwise the deal passes to the next
  player in turn order.
- After the deal has gone all the way round, the prevailing wind advances: East → South → West → North.
  A full game is four prevailing-wind rounds. Players can end earlier by agreement.
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
| Head bump (截糊) | When two players can win on one discard, the one closer in turn order after the discarder wins |
| Waiting / ready | One tile away from a winning hand |
| Wall | The face-down stack of tiles left to draw |
| Prevailing wind | The wind of the current round |
