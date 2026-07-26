# Task — convex-schema

Design and implement the Convex schema for Bundestracker. Read docs/api-research.md first — it contains the complete API research with all entity shapes, ID spaces, and the critical join problem.

Your task: implement the full Convex schema in webapp/convex/schema.ts based on the research findings.

Key architectural findings from the research:
1. THREE incompatible MP ID spaces: DIP person ID (short numeric), Stammdaten ID (8-digit), and vote sheets (no ID at all — name matching required). Mint an INTERNAL Bundestrack MP id and store all external ids against it.
2. Vote data comes from XLSX sheets with one-hot encoding (ja/nein/Enthaltung/ungültig/nichtabgegeben). No MP ID column — names only.
3. Speech data comes from plenary protocol XML. One <rede> can contain multiple speakers (Zwischenfragen).
4. Seating data does NOT exist in machine-readable form — generate synthetically from Fraktion sizes.
5. Committee membership in Stammdaten is current-WP only.
6. aktivitaetsart is an open string, not an enum.
7. The DIP API has 16 endpoints (8 collections + 8 by-id): /vorgang, /vorgangsposition, /drucksache, /drucksache-text, /plenarprotokoll, /plenarprotokoll-text, /aktivitaet, /person.

Tables to implement in schema.ts:

1. mps — Master MP data. Fields: internalId (string, the Bundestrack ID), stammdatenId (string, 8-digit), dipPersonId (string, short numeric, nullable), name (string), vorname (string), nachname (string), ortsZusatz (string, nullable), praefix (string, nullable), party (string), fraktion (string), constituency (string, nullable), wahlperiode (number), bio (string, nullable), photoUrl (string, nullable), birthDate (string, nullable), education (string, nullable), profession (string, nullable), electionMethod (string, nullable), datesInOffice (object with start/end, nullable), createdAt (number), updatedAt (number). Index by stammdatenId, dipPersonId, fraktion, wahlperiode.

2. voteSheets — Named vote metadata. Fields: wahlperiode (number), sitzungnr (number), abstimmnr (number), title (string), date (string), result (string), yesCount (number), noCount (number), abstainCount (number), invalidCount (number), absentCount (number), totalEligible (number), sourceUrl (string, nullable), createdAt (number). Index by (wahlperiode, sitzungnr, abstimmnr), date.

3. voteRecords — Per-MP vote records. Fields: mpInternalId (string), voteSheetId (Id), vote (union: yes/no/abstain/invalid/absent), partyAtVote (string, nullable), remark (string, nullable), createdAt (number). Index by voteSheetId, mpInternalId.

4. motions — Motions and bills. Fields: dipVorgangId (string, nullable), dipDrucksacheId (string, nullable), drucksacheNr (string, nullable), title (string), type (string, nullable), date (string), wahlperiode (number), vorgangstyp (string, nullable), createdAt (number). Index by wahlperiode, date, dipVorgangId.

5. motionSponsors — MP-to-motion relationship. Fields: motionId (Id), mpInternalId (string), role (string, nullable), createdAt (number). Index by motionId, mpInternalId.

6. speeches — Plenary speeches. Fields: mpInternalId (string), protocolId (string, nullable), protocolDate (string), wahlperiode (number), sitzungnr (number), speechIndex (number, nullable), wordCount (number, nullable), topic (string, nullable), createdAt (number). Index by mpInternalId, protocolDate, wahlperiode.

7. questions — Written questions. Fields: mpInternalId (string), subject (string), date (string), wahlperiode (number), type (union: major/minor), createdAt (number). Index by mpInternalId, date, wahlperiode.

8. committeeMemberships — MP-committee mapping. Fields: mpInternalId (string), committeeName (string), role (string, nullable), wahlperiode (number), startDate (string, nullable), endDate (string, nullable), createdAt (number). Index by mpInternalId, committeeName, wahlperiode.

9. activities — Parliamentary activities from DIP /aktivitaet endpoint. Fields: dipAktivitaetId (string), mpInternalId (string), aktivitaetsart (string, open string NOT enum), vorgangId (string, nullable), date (string), wahlperiode (number), description (string, nullable), createdAt (number). Index by mpInternalId, date, wahlperiode, dipAktivitaetId.

10. activityEvents — Unified activity feed. Fields: mpInternalId (string), eventType (union: motion/speech/vote/question/bill/committee/activity), date (string), title (string), description (string, nullable), referenceId (string, nullable), referenceType (string, nullable), wahlperiode (number), createdAt (number). Index by mpInternalId, date, eventType, wahlperiode.

11. activityScores — Computed per-MP scores. Fields: mpInternalId (string), wahlperiode (number), month (string, format YYYY-MM), motionCount (number), speechCount (number), questionCount (number), reportCount (number), voteParticipationRate (number), committeeCount (number), billSponsorshipCount (number), totalScore (number), scoreBreakdown (object with per-component scores and weights), createdAt (number), updatedAt (number). Index by mpInternalId, wahlperiode, month.

12. seatingAssignments — Synthetic seat-to-MP mapping. Fields: mpInternalId (string), wahlperiode (number), seatLabel (string), faction (string), row (number, nullable), column (number, nullable), createdAt (number). Index by mpInternalId, wahlperiode, faction.

13. userPreferences — Saved user preferences (for logged-in users). Fields: userId (string, Better Auth user ID), customWeights (object, nullable), followedMpIds (array of strings), preferredLocale (string, nullable), createdAt (number), updatedAt (number). Index by userId.

Also implement the necessary Convex mutations in separate files:
- webapp/convex/mps.ts — upsertMP, upsertMPs (batch), getMP, getMPs (list with filters)
- webapp/convex/votes.ts — upsertVoteSheet, upsertVoteRecords (batch), getVoteSheet, getVoteSheets
- webapp/convex/motions.ts — upsertMotion, upsertMotionSponsors, getMotions, getMotionsByMP
- webapp/convex/speeches.ts — upsertSpeech, upsertSpeeches (batch), getSpeechesByMP
- webapp/convex/questions.ts — upsertQuestion, upsertQuestions, getQuestionsByMP
- webapp/convex/committees.ts — upsertCommitteeMembership, getCommitteesByMP
- webapp/convex/activities.ts — upsertActivity, upsertActivities, getActivitiesByMP
- webapp/convex/activityEvents.ts — addActivityEvent, getActivityFeed
- webapp/convex/activityScores.ts — computeScore, upsertScore, getScores, getRankings
- webapp/convex/seating.ts — upsertSeatingAssignment, getSeatingAssignments
- webapp/convex/userPreferences.ts — getPreferences, updatePreferences, followMP, unfollowMP

The HTTP endpoint in webapp/convex/http.ts should expose mutation endpoints that the Python pipeline can call via POST.

Also create webapp/convex/crons.ts with a daily cron that recomputes activity scores and rankings.

Commit and push when done.
