# Wiki map views and code documentation quality

## Problem and implementation

The mail browser replaced sections with year/month before building the map. Existing reply and topic-candidate edges were present, but the map used only month colors. The force layout compared every node pair and clamped coordinates to a rectangle, accumulating nodes along its edges.

- Keep **document view** and add an explicit **cluster view** through the existing Workspace catalog tabs. View switching reuses positions and remembers each view’s pan/zoom. Clicking a cluster opens its members in document view; it never edits pages or sends an AI request.
- Mail defaults to topic groups, with kind and date alternatives. Code exposes section, descriptive page type and connected groups. Producer `cluster_id`/`cluster`/`cluster_title`/`topic` fields are retained when present. Otherwise groups derive from existing relationship components, not date alone.
- Cluster links aggregate actual document links and counts. Candidate-only links stay dashed. Group membership is a navigation aid, not proof of causality or a new semantic claim. Connected components may span several subtopics; no embedding service or new LLM clustering is claimed.
- Use soft group centers without rectangular clipping. A spatial grid replaces global pairwise repulsion. A packaged dedicated worker performs relaxation; the main renderer receives positions and draws only nodes and intersecting edges near the viewport. Panning/resizing does not restart layout. Worker failure leaves an immediately usable static free-canvas layout.
- Keep shared CX tabs, palette, font and icon sizes. Labels retain reading size while zooming, use collision checks and a bounded label count, and disclose full names on hover/focus. Overview labels prioritize representative documents. Common modal geometry is unchanged; view switching needs no new modal.

## Code wiki generation

The existing repository planner/worker already explores source evidence and reconciles Claims. Its prompts now explicitly check entrypoints, runtime flows, state/data owners, integrations and recovery boundaries within the requested scope. Workers describe trigger-to-result paths with inspected source symbols and meaningful links, use descriptive types, lead with the core behavior, and distinguish historical behavior and inspected tests from current/run evidence.

This changes future initialization and update guidance. It does not silently rewrite existing documents or establish improved live-model accuracy. Existing scoped-update, per-page ownership, Claims reconciliation and durable resume contracts remain intact.

## Verification

- 26 focused Desktop tests passed: grouping, metadata, aggregate counts, evidence preservation, viewport crossing edges, unclipped positions, spatial neighbor bounds and existing mail/wiki behavior.
- 7 OpenWiki repository-prompt tests passed, including scope and evidence/flow guidance.
- Browser fixtures use real WikiMap/WikiBrowser components and a real layout worker at 1280px and 440px, plus reduced-motion mode. The 3,000-document fixture initially rendered 42 nodes, then 40 after a pan; one layout run was retained across pan/resize. No 50ms long task was observed in that synthetic run.
- Isolated macOS Electron confirmed the packaged worker loads through `app://bundle`, renders the map, switches code kinds and cluster view, and expands a group by keyboard. Design identity checks and Electron build passed.

Evidence: `verification/wiki-map-clusters-2026-10-15/`. Synthetic data, source tests and macOS Electron do not establish Windows performance, live mailbox clustering quality or real-model generation quality. No release was published.
