export interface RuleConfig {
  /** Allow Thirteen Orphans (十三么) as a winning hand. */
  thirteenOrphans: boolean;
  /** Allow Seven Pairs (七對) as a winning hand. */
  sevenPairs: boolean;
  /** Allow winning on the tile another player uses to promote a pung to a kong. */
  robbingKong: boolean;
}

/** Casual Hong Kong Chicken Hand, as specified in docs/rules.md. */
export const DEFAULT_RULES: RuleConfig = {
  thirteenOrphans: false,
  sevenPairs: false,
  robbingKong: false,
};
