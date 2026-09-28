export function mockAiPro(_url, options) {
  const body = JSON.parse(options.body), rounds = body.messages.filter(message => message.role === 'assistant' && message.tool_calls?.length).length;
  const call = (name, args) => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: `call-${rounds}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  if (!rounds) return call('read_selection', {});
  if (rounds === 1 && body.tools.some(tool => tool.function.name === 'apply_changes')) return call('apply_changes', { plan: JSON.stringify({ answer: '머리글 서식 정리', operations: [{ type: 'format_range', address: 'A1:B1', bold: true, fillColor: '#E8F1FE' }] }) });
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '첫 행의 서식을 정리하고 적용 결과를 확인했습니다.' } }] });
}
