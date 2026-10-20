export * from './types.js';
export { BrowserAgentError } from './contracts.js';
export { createBrowserAddon, browserAgentManifest } from './lifecycle.js';
// Browser teach (2026-10-21): the demonstration recorder and the teach session travel with the core bundle.
export { DEMONSTRATION_SCRIPT, INTERACTIVE_SELECTOR, createDemonstration, demonstrationCard, demonstrationValues } from './demonstration.js';
export { draftPlan, questionsFor, applyAnswers, annotationBoard } from './teach.js';
