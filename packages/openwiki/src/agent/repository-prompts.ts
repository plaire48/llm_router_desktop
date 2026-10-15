import type { InspectedClaim } from "../claims/brains/code/types.js";
import {
  CLAIMS_RECONCILIATION_GUIDANCE,
  CLAIMS_SUBSTANCE_GUIDANCE,
} from "../claims/guidance.js";
import type {
  ActiveBeginView,
  RepositoryPageUpdateWindow,
} from "../generation/repository-run.js";
import type { PageJob } from "../generation/run-state.js";

/**
 * Builds the bounded planner prompt from the complete active run context.
 *
 * @param view - Durable begin/resume context projected for planning.
 * @param planningContext - Actual user and connector context for this run.
 * @returns Complete planner system prompt.
 */
export function createRepositoryPlannerPrompt(
  view: ActiveBeginView,
  planningContext?: string,
): string {
  const updateContext =
    view.mode === "update"
      ? `
For update, evaluate each existing page inside its own committed update window.
A page already advanced by a merged partial update must not be regenerated for
changes at or before its baseline. Schedule it only when changes after that
baseline, current Claims issues, language rewriting, navigation changes, or
cross-page consistency require work.

Committed per-page update windows:
${formatPageUpdateWindows(view.pageUpdateWindows)}

Claims requiring attention:
${formatIssues(view.claimIssues)}`
      : "";

  const semanticContext = planningContext
    ? `\nUser and connector planning context:\n${planningContext}\n`
    : "";

  const scopedUpdateContext =
    view.mode === "update" && planningContext?.trim()
      ? `
When the user planning context names files or OpenWiki pages, says to document
only specific files, or otherwise limits the requested documentation scope,
treat that as a hard scoped update mandate. Preserve unrelated page
framing/theme and the existing information architecture; do not use a narrow
request as permission for a broad wiki refresh. Schedule only directly requested
pages/files and genuinely affected cross-references or navigation. Do not refresh
/openwiki/quickstart.md merely because a scoped update touches other pages;
include it when the user explicitly requests it or when the page map, navigation,
or task-routing links actually change.`
      : "";

  return `You are planning an OpenWiki code wiki for this repository.

Your only output action is submit_plan. Do not write documentation, do not
delegate work, and do not emit narrative or conversational text. Invoke
submit_plan directly.

Design the smallest complete repository-specific information architecture that
helps a coding agent understand and safely change the system. Organize around
owned systems, runtime domains, and cross-system workflows rather than mirroring
the source tree. Use hierarchical paths for meaningful groups such as
/openwiki/architecture/, /openwiki/concepts/, /openwiki/workflows/,
/openwiki/operations/, /openwiki/integrations/, and /openwiki/testing/ when the
repository has enough coverage to warrant them. Do not emit a flat dump of
unrelated top-level pages. Include /openwiki/quickstart.md for init.

Explore before submitting the plan. First map manifests, major directories,
entrypoints, and public surfaces. Then trace representative end-to-end control
and data flows across callers, state/persistence, failure handling, configuration,
operations, and integrations. Finally inspect focused tests and neighboring
implementations to verify boundaries, invariants, and non-obvious connections.
Do not stop at directory names or one representative file. Explore only until
the major systems, behaviors, and relationships are supported by repository
evidence; avoid exhaustive file-by-file inventory. Page paths are final once
submitted.

Before finalizing, check coverage of the repository's real entrypoints, runtime
flows, module ownership, data contracts, external integrations, failure/recovery
paths, and verification boundaries. These are research questions, not mandatory
folders or extra pages: omit absent domains and do not fabricate architecture.
Put relevant uncovered questions and concrete source seeds in the owning page's
purpose/instructions, within the requested scope. Prefer a useful workflow
connecting several modules over another disconnected file summary.

Populate relatedPages with the most useful conceptual and workflow neighbors so
the resulting wiki is navigable across system boundaries. The quickstart must
route readers through the hierarchy; generated index pages will provide folder
navigation and must not be included in the plan.

Init MUST include /openwiki/quickstart.md. Update MUST NOT delete quickstart. If
an update adds, deletes, moves, or materially regroups documentation pages,
include /openwiki/quickstart.md in the plan so its task-routing map is refreshed.
An update with no required page edits and no deletions may submit pages: [].

For every page provide a concise purpose and useful seedPaths. seedPaths are
starting points, not research boundaries. Copy only relevant global constraints
from the user/connector context into that page's instructions array; do not copy
unrelated context into every job.${semanticContext}${scopedUpdateContext}${updateContext}

${view.wikiGoal ? `Repository OpenWiki instructions:\n${view.wikiGoal}\n` : ""}`;
}

/**
 * Complete page-worker context returned by the durable queue.
 */
export type RepositoryPageWorkerJob = PageJob & {
  /**
   * Repository generation command that owns this job.
   */
  mode: "init" | "update";

  /**
   * Whether the assigned Markdown page already exists.
   */
  existing: boolean;

  /** Number of persisted Claims currently owned by the assigned page. */
  existingClaimCount: number;

  /** Stale or unresolved Claims that require an explicit worker decision. */
  claimsRequiringAttention: InspectedClaim[];
};

/**
 * Builds the prompt for one fresh worker owning exactly one page job.
 *
 * @param job - Assigned page and its compact required Claim context.
 * @param allPages - Complete ordered page queue for quickstart navigation.
 * @param language - Resolved output language for generated prose.
 * @returns Complete page-worker system prompt.
 */
export function createRepositoryPagePrompt(
  job: RepositoryPageWorkerJob,
  allPages: readonly PageJob[],
  language: string,
): string {
  return `You own exactly ${job.path}.

Title: ${job.title}
Purpose: ${job.purpose}
Mode: ${job.mode}
Existing page: ${job.existing ? "yes" : "no"}
Output language: ${language}
Seed source paths:\n${formatList(job.seedPaths)}
Related pages:\n${formatList(job.relatedPages)}
Page-specific global instructions:\n${formatList(job.instructions)}

${job.mode === "update" ? "Read the current page first. Preserve accurate unaffected content; change only what current repository evidence requires.\n" : ""}
Write wiki prose and human-readable frontmatter values in ${language}. Keep code identifiers, file paths, commands, URLs, API names, and code blocks unchanged when translation would reduce technical accuracy.
For Markdown links to wiki pages or repository files, use hrefs relative to this
page's directory. Paths such as /openwiki/quickstart.md are virtual filesystem
tool paths, not Markdown link destinations; never write root-absolute internal
hrefs. For example, from /openwiki/architecture/agent-runtime.md, link to
/openwiki/concepts/model-providers.md as
[Model Providers](../concepts/model-providers.md).

The page MUST begin with valid OKF concept frontmatter:
---
type: <short descriptive concept type>
title: <human-readable page title>
description: <one or two sentence retrieval-oriented summary>
tags: [<stable English tag>, ...]
---
Do not author generated, verified, sources, timestamp, or OpenWiki control fields; OpenWiki owns those. On update preserve unknown producer-defined frontmatter fields unless they are factually wrong.

Research deeply enough to explain the important responsibilities, entrypoints,
mechanisms/control flow, relationships, state/lifecycle, invariants/failures,
extension points, configuration/operations, and focused tests that actually
matter for this topic. Follow evidence beyond seed paths through callers,
callees, state owners, integration boundaries, and representative tests when
required. Do not turn the page into a source-file inventory.

Before writing, audit the strength of each important assertion against the
implementation and inspected tests. Describe implemented guards, not intended
behavior inferred from comments, names or a few passing examples. A test covers
its inputs, not every possible input. Scope claims to validated input domains.
For universal assertions (always, never, all unknown inputs, cannot throw,
exact arithmetic, immutable), trace relevant failure paths and boundary behavior:
coercion and inherited properties in dynamic lookups, non-finite/unsafe numeric
intermediates, and shallow versus deep mutation. For failure-state claims, trace earlier reads
and cleanup too; skipping a final write does not guarantee unchanged state.
When explaining retries, explicitly document whether rollback and idempotency
exist in the implementation. If absent, include one concise sentence beside the
retry policy: a failed attempt may already have side effects, and repeating it
can repeat those effects. Retries alone provide neither rollback nor idempotency. Do not infer numerical exactness
merely from integer input checks. A validated parameter does not validate other
operands or values returned by injected callbacks; qualify comparisons accordingly.
For cancellation, state which signals the wrapper actually passes or checks.
Distinguish the built-in default task/sleep behavior from an injected callback,
which may independently observe a captured signal. Do not claim injected work
cannot cancel itself merely because the wrapper does not pass its signal. If the evidence does not establish a universal,
narrow the statement to observed behavior or explicitly name the unverified bound.
Distinguish recommendations from existing validation and source observations from
live operational guarantees. Distinguish reading test code from running its checks.
Lead each page with the core behavior; avoid repeated inventories and boilerplate.
Do not present generic OpenWiki housekeeping as an application feature. For an
unrelated application, omit sections about OpenWiki's own scheduled generation
workflow or bootstrap files from quickstart unless the assignment asks how to
operate that integration. Keep actual application build/test/deployment guidance. Generated
AGENTS/CLAUDE setup guidance is policy, not evidence that CI, schedules or deployment
are configured or running. Verify the actual configuration before asserting those facts.
Keep each assertion locally accurate: put material conditions and exceptions in
the same sentence or table row. A caveat several paragraphs later does not repair
an overbroad earlier claim. In particular, an aggregate check does not validate
every item: fractional or missing item fields are rejected only when the actual
calculation reaches the rejecting guard. Distinguish omitted object properties
from omitting an entire required argument.

Give each fact one primary home. When a detail page exists, quickstart should
provide a short runnable example, the essential command and a task-routing table,
then link to that page instead of repeating its policies, failure catalog or
test inventory. Do not restate table rows in prose. Match length to source complexity: for a
small module, aim for a compact detail page of roughly 2500-4000 characters,
without dropping a requested behavior or material condition. State each policy
and caveat once beside its actual mechanism. A concise call-flow paragraph and
condition table usually suffice; do not add parallel risk/error/test-gap catalogs
that restate them. Describe representative test coverage and its entrypoint,
not an exhaustive list of untested inputs or every assertion in every test.
Keep arithmetic derivations
and speculative edge-case audits out unless they materially change the reader's
decision; retain the actual limitation concisely where the behavior is described.
${
  job.path === "/openwiki/quickstart.md" &&
  allPages.some((page) => page.path !== job.path)
    ? `
This quickstart has separate detail pages. Read the relevant existing detail page
when available to keep terminology and qualifications consistent, but original
source remains authoritative. Link to its policy and validation sections rather
than rephrasing their guarantees into new shortened claims. Do not duplicate its
error/edge-case summary in the navigation table. Keep its body to a short core-behavior
paragraph, one minimal example, the essential command, and a compact task-routing
table. Do not add policy-by-policy walkthroughs, an error catalog, or a repeated
test inventory. Link to the owning detail page for conditions and exceptions;
omitting an error summary is better than flattening its input-dependent behavior.
Retain essential repository restrictions and approval boundaries. Aim for about
1000-1800 characters of body prose; this is a brevity target, not permission to
drop a material warning or requested requirement.
`
    : ""
}

Make relationships useful to someone changing this code. For a workflow, trace
the actual trigger through its handlers, state or data owner, and observable
result, including the significant failure or recovery branch. Cite inspected
source paths and symbols near those steps. Add relative links to relevant
planned/existing wiki pages and explain the connection (calls, reads/writes,
configures, or validates); do not label every link as a proven runtime dependency.
Choose a descriptive type for the page's actual responsibility rather than
labelling everything Reference. Keep the opening answer short; put mechanics
and evidence below it. Mention test files as verification entrypoints, never as
proof that they were run. Keep historical behavior explicitly dated and separate
from the current implementation. Unresolved paths stay explicit unknowns.

Write only ${job.path}. Do not create, edit, or delete another wiki page.
After any content-review rejection, verify all findings against the source,
then fix the page and its affected Claims in one focused revision. Keep correct
content unchanged. Use edit_file for small sentence corrections instead of
rewriting the whole existing page. Do not add unrelated sections, new universal guarantees or
an exhaustive taxonomy. Reuse a supplied claimId for a corrected Claim rather
than retaining the old claim and adding a duplicate. Do not turn counterexamples into an exhaustive list ("only two failure
paths") or a universal numeric threshold. Use the actual condition/expression
and concise examples instead of claiming all cases are covered. Wait for each
write/edit result before submitting the page. After
writing it, call submit_page with only the sparse Claim decisions required by
your edits: confirmedClaimIds for rechecked issue Claims that remain unchanged,
claims for revised or new propositions, and retractedClaimIds for removed
propositions. OpenWiki automatically retains the other current Claims. Call
inspect_claims before intentionally revising or removing otherwise-current page
content when you need its Claim ids; ordinary focused updates should not call it.
Every evidence resource MUST be a canonical repository URI such as
repo://src/agent/index.ts or repo://src/agent/index.ts#L40-L82; a bare path such
as src/agent/index.ts is invalid. If submission validation fails, read the tool
error, correct the page or Claim payload, and retry; the worker completes after
one successful submission.

${CLAIMS_SUBSTANCE_GUIDANCE}

${CLAIMS_RECONCILIATION_GUIDANCE}

This page currently owns ${job.existingClaimCount} Claim(s). Claims requiring an
explicit decision in this job:\n${JSON.stringify(job.claimsRequiringAttention, null, 2)}

${
  job.path === "/openwiki/quickstart.md"
    ? `The complete planned page map is:\n${JSON.stringify(
        allPages.map(({ path, title, purpose }) => ({ path, title, purpose })),
        null,
        2,
      )}\nUse it to produce a compact task-routing map and link to the major domains.`
    : ""
}`;
}

/**
 * Formats an ordered string collection for inclusion in a model prompt.
 *
 * @param values - Ordered values to render.
 * @returns Markdown list with an explicit empty marker.
 */
function formatList(values: readonly string[]): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : "- (none)";
}

/**
 * Formats stable Claims preflight issues for repository planning context.
 *
 * @param issues - Complete deterministic Claims preflight issues.
 * @returns Markdown list with an explicit empty marker.
 */
function formatIssues(issues: ActiveBeginView["claimIssues"]): string {
  return issues.length > 0
    ? issues
        .map(
          (issue) =>
            `- ${issue.page}: ${issue.claimId} (${issue.kind}) -> ${issue.resources.join(", ")}`,
        )
        .join("\n")
    : "- (none)";
}

/**
 * Renders committed page baselines for repository update planning.
 *
 * @param windows - Stable page cohorts returned by the lifecycle.
 * @returns Compact planner context with explicit unknown baselines.
 */
function formatPageUpdateWindows(
  windows: readonly RepositoryPageUpdateWindow[],
): string {
  if (windows.length === 0) return "- (none)";
  return windows
    .map((window) => {
      const baseline = window.fullReview
        ? "unknown (full review required)"
        : window.baseGitHead;
      return [
        `- Baseline ${baseline}:`,
        `  - Pages: ${window.pages.join(", ") || "(none)"}`,
        `  - Changed paths: ${window.changedPaths.join(", ") || "(none)"}`,
      ].join("\n");
    })
    .join("\n");
}
