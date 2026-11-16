# Rules Library

Offline-first PWA for looking up wargame special rules. Every game is data.

    npm install
    npm run dev            # local dev server
    npm test               # data model, import, search, rule card tests
    npm run build          # installable offline PWA → dist/
    npm run preview:single # one-file preview → dist-single/index.html

## Import format (rules-library/v1)
One file per source (book, PDF download, FAQ). See src/fixtures.ts (test data only) for a full example.

    { "format": "rules-library/v1",
      "system": { "name": "Horus Heresy" },
      "edition": { "name": "3.0" },
      "source": { "title": "Age of Darkness Rulebook", "kind": "rulebook", "isCore": true, "published": "2025-06-21" },
      "rules": [{ "name": "Rending (X)", "category": "Special Rule", "parameters": [{ "name": "X", "kind": "roll" }],
                  "phase": "Shooting / Assault", "summary": "...", "fullText": "...", "page": 300,
                  "aliases": [], "related": ["..."] }],
      "amendments": [{ "rule": "Rending", "type": "replace", "find": "...", "text": "...", "page": 2 }],
      "entities": [{ "name": "...", "type": "unit", "faction": "...", "unitType": "Infantry", "subTypes": ["Line"],
                     "role": "...", "stats": { "M": 7, "WS": 4, "Sv": "3+" }, "rules": ["Rending (4+)"],
                     "wargear": ["Bolter", "Frag Grenades"] }] }

Core rules: category "Core Rule" plus "section" (e.g. "Assault Phase") to read them in book order.
Unit types/sub-types: add them as rules (category "Unit Type") and units link to them by name.
Q&As covering several rules: amendments[].alsoRules = ["Deep Strike", "Charging"].

CSV: one rule per row (name,category,aliases,parameters,phase,summary,fullText,page,tags,related,faction,overrides),
lists separated by "|", optional first line `#source,title,kind,published,version,isCore,system,edition`.

## Supabase
supabase/migrations/0001_library.sql: private per-user tables with row-level security and a private page-images bucket.
Rules text is your own transcription of books you own: never make these tables public.
