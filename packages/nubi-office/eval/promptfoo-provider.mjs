import {evaluate} from './run.mjs';

// Promptfoo custom API provider. Explicit Office credentials only; no SDK auth fallback.
export default class NubiOfficeProvider {
  constructor(options = {}) {this.config = options.config || {};}
  id() {return `nubi-office:${this.config.provider || 'unconfigured'}:${this.config.model || 'unconfigured'}`;}
  async callApi(_prompt, context) {
    const report = await evaluate({caseIds: [context.vars.caseId], env: {...process.env, NUBI_EVAL_PROVIDER: this.config.provider, NUBI_EVAL_MODEL: this.config.model}});
    if (report.status !== 'measured') return {error: `Evaluation blocked: ${(report.blockers || []).join(', ')}`};
    return {output: JSON.stringify(report.cases[0]), metadata: {sourceHash: report.sourceHash, host: report.host, artifacts: report.artifacts}};
  }
}
