export function createToastStore() {
  let current = null, sequence = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => current,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    show: ({message, source, error = false, actions = [], diagnosticText}) => {
      const text = String(message || '').trim();
      if (!text || !error && /중[.…]+$/.test(text)) {
        if (current?.source === source) { current = null; emit(); }
        return;
      }
      current = {id: ++sequence, source, message: text, error, actions, diagnosticText,
        success: !error && /저장했습니다|저장 완료|복사했습니다|초기화했습니다|불러왔습니다|내보냈습니다|적용했습니다/.test(text)};
      emit();
    },
    dismiss: id => { if (current?.id === id) { current = null; emit(); } },
  };
}
