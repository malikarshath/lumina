# web/ : LUMINA UI

Next.js app, Tailwind CSS, deployed on Vercel. Talks **only** to the gateway (`NEXT_PUBLIC_API_URL`).
No provider key ever lives here. Types come from `packages/contract/`.

**Status: scaffold only.** Initialize with `npx create-next-app@latest . --typescript --tailwind --app`
when the build reaches step 5 of `../README.md`.

## Planned layout

```
web/
  src/app/
    page.tsx                  home: query box, thread list
    threads/[id]/page.tsx     the answer view: stream, citation chips, sources rail, deck/image actions
    memory/page.tsx           memory panel: list + delete
    spaces/page.tsx           Spaces: create, upload, document status list (pending -> indexed)
    evals/page.tsx            renders GET /evals/report.json: rubric, SLA numbers, gates, video, design section, two trajectories
  src/components/
    QueryBox, AnswerStream, CitationChip, SourcesRail, TracePanel,
    MemoryPanel, SpaceUploader, DocumentStatus, ArtifactButton (202 + poll)
  src/lib/
    api.ts                    typed fetch helpers, sends X-User-Id
    sse.ts                    EventSource / fetch-stream client for trace -> sources -> token -> done
    contract.ts               re-exports from packages/contract
```

## Must exercise every route

Because this UI replaces the staff-provided one, it is our acceptance test. It must hit every route
in `docs/API.md` so the rubric's "UI lights up & contract" check passes: threads, ask (with `mode`
and `spaceId`), memory list/delete, spaces create/upload/list, artifacts create/poll/download,
health, stats, evals.

## Behaviour to copy from the Alex reference app

The trace panel is the teaching surface. Show every `trace` event as it arrives, before the answer
streams. Render `[n]` chips that scroll to the matching source. Distinguish `kind: "web"` from
`kind: "doc"` sources visually, and render doc citations as `filename, p. N`.
