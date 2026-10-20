// The Office S1 form parts the Desktop reuses unchanged (document forms plan, 2026-10-21). This file is the entry of
// `scripts/build-office-forms.mjs`, which bundles them with their dependencies (typebox, numfmt) into
// `generated/office-forms.mjs`, the same way the browser agent core travels. Runtime code imports the bundle, never
// the Office package directly, so the Desktop package installs alone.
export {wordFormMap,mapSummary,mapStructureKey,mapForModel,registeredFormMap,compareRegistered,isHeading,isNote,wholeGuide,markOf,valueType} from '../../nubi-office/worker/word-form-map.mjs';
export {guideSpans,valueSpans,isGuideText,GUIDE_PATTERNS} from '../../nubi-office/worker/guide-text.mjs';
export {createFormFill} from '../../nubi-office/worker/form-fill.mjs';
export {formChecks} from '../../nubi-office/worker/form-checks.mjs';
export {nextOperation,applyFill,sectionBody} from '../../nubi-office/worker/form-apply.mjs';
export {createLedger,locate,region} from '../../nubi-office/worker/form-ledger.mjs';
export {renderValue,parseDate,parsePeriod,parseAmount,formatDate,formalAmount,documentText} from '../../nubi-office/worker/form-values.mjs';
export {CELL_SHEET,SECTION_SHEET,responseFormat,userSources,parseCellSheet,parseSectionSheet} from '../../nubi-office/worker/fill-sheet.mjs';
export {modelJson} from '../../nubi-office/worker/model-json.mjs';
