// Coach member profile (coach and briefing spec §4.4 and §5.1). The field names, enums and ranges follow the
// `coach_profiles` table of 0017_coach_briefing.sql, whose CHECK constraints win over the spec text if they differ.
import { z } from "zod";

export const COACH_LEVELS = ["beginner", "intermediate", "pro"] as const;
export const COACH_CAPITAL_BANDS = ["free", "gas_only", "up_to_100", "up_to_1000", "over_1000"] as const;
export const COACH_GOALS = ["quick", "long_term", "learn"] as const;
export const COACH_MINUTES = [15, 30, 60, 120] as const;

/**
 * What a member tells the Coach. No email, user id, wallet address or balance: the table has none and the schema
 * strips unknown keys. `wallet_count` is set exactly when `has_wallet` is true (the table's
 * `check (has_wallet = (wallet_count is not null))`); an absent count of a member with no wallet becomes null.
 */
export const coachProfileSchema = z
  .object({
    level: z.enum(COACH_LEVELS),
    capital_band: z.enum(COACH_CAPITAL_BANDS),
    has_wallet: z.boolean(),
    wallet_count: z.number().int().min(1).max(10).nullable().default(null),
    minutes_per_day: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
    goal: z.enum(COACH_GOALS),
    chains: z.array(z.string().min(1).max(40)).max(10).default([]),
  })
  .superRefine((profile, ctx) => {
    if (profile.has_wallet && profile.wallet_count === null) {
      ctx.addIssue({ code: "custom", path: ["wallet_count"], message: "wallet_count is required when has_wallet" });
    }
    if (!profile.has_wallet && profile.wallet_count !== null) {
      ctx.addIssue({ code: "custom", path: ["wallet_count"], message: "wallet_count must be null when there is no wallet" });
    }
  });

export type CoachProfile = z.infer<typeof coachProfileSchema>;
