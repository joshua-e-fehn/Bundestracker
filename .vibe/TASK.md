# Task — feature-search

Wave 9 Agent J: Keyword search + topic explorer for Bundestracker. Do NOT ask questions.

Read /opt/data/workspace/Bundestrack-Plan-V2.md (Wave 9 section).

Your tasks:
1. Implement a keyword search over parliamentary data:
   - Search motion titles, speech topics, question subjects, committee names
   - Support fuzzy matching (e.g. 'Klima' matches 'Klimaschutz', 'climate' matches 'Klima')
   - Cross-language: searching 'lawyer' in EN should match 'Rechtsanwalt' in DE
2. Results show MPs (not documents) — the MP is the primary result
3. Each MP result card shows WHY they matched (which motion/speech/question contained the keyword)
4. Show party breakdown of results (e.g. '3 CDU, 2 SPD, 1 Grüne')
5. Add a prominent search bar in the navbar (accessible from every page)
6. Create a dedicated /search page with filters (party, committee, period)
7. Use Convex search indexes or client-side search — NO external search service, NO LLM
8. Bilingual (DE/EN)

Commit and push. Do NOT wait for input.
