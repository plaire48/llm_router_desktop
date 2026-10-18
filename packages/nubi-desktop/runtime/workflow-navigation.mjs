// An explicit null terminates a path; an omitted successor follows array order.
export const nextWorkflowStep=(workflow,step)=>Object.hasOwn(step,'next')?step.next:workflow.steps[workflow.steps.findIndex(candidate=>candidate.id===step.id)+1]?.id??null;
export const branchWorkflowStep=(workflow,step,yes)=>yes?step.then:Object.hasOwn(step,'else')?step.else:nextWorkflowStep(workflow,step);
