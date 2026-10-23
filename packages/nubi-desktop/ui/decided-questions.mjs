// Answered questions whose question and answer are not both in the transcript ("확인한 요구사항"). A question that
// resolved without an answer (a silent command that produced output, finished or restarted) is not a decision.
export function detachedQuestions(task){
 const messages=task?.messages||[];
 return (task?.questionHistory||[]).filter(question=>typeof question.answer?.text==='string'&&(!messages.some(message=>message.role==='assistant'&&message.questionId===question.id)||!messages.some(message=>message.role==='user'&&message.content===question.answer.text)));
}
