/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as activityEvents from "../activityEvents.js";
import type * as activityScores from "../activityScores.js";
import type * as auth from "../auth.js";
import type * as committeeReferrals from "../committeeReferrals.js";
import type * as committees from "../committees.js";
import type * as crons from "../crons.js";
import type * as feed from "../feed.js";
import type * as http from "../http.js";
import type * as inquiry from "../inquiry.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_validators from "../lib/validators.js";
import type * as motions from "../motions.js";
import type * as mps from "../mps.js";
import type * as parties from "../parties.js";
import type * as purgeSeed from "../purgeSeed.js";
import type * as questions from "../questions.js";
import type * as rankings from "../rankings.js";
import type * as scoreSweep from "../scoreSweep.js";
import type * as search from "../search.js";
import type * as seating from "../seating.js";
import type * as seedDev from "../seedDev.js";
import type * as speeches from "../speeches.js";
import type * as stats from "../stats.js";
import type * as userPreferences from "../userPreferences.js";
import type * as voteExplanations from "../voteExplanations.js";
import type * as votes from "../votes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  activityEvents: typeof activityEvents;
  activityScores: typeof activityScores;
  auth: typeof auth;
  committeeReferrals: typeof committeeReferrals;
  committees: typeof committees;
  crons: typeof crons;
  feed: typeof feed;
  http: typeof http;
  inquiry: typeof inquiry;
  "lib/auth": typeof lib_auth;
  "lib/ingest": typeof lib_ingest;
  "lib/validators": typeof lib_validators;
  motions: typeof motions;
  mps: typeof mps;
  parties: typeof parties;
  purgeSeed: typeof purgeSeed;
  questions: typeof questions;
  rankings: typeof rankings;
  scoreSweep: typeof scoreSweep;
  search: typeof search;
  seating: typeof seating;
  seedDev: typeof seedDev;
  speeches: typeof speeches;
  stats: typeof stats;
  userPreferences: typeof userPreferences;
  voteExplanations: typeof voteExplanations;
  votes: typeof votes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
