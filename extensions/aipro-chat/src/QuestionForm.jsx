import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {CxButton, CxTextarea, CxField, CxNotice, Icon} from '@e2e/cx-design-system';
import {QUESTION_TEXT_LIMIT, questionDisplayOptions} from '../user-question.js';
import {ERROR_TEXT} from '../core.js';
import {InteractionSurface} from './InteractionSurface.jsx';

export function QuestionForm({showActionLabels = false, confirmChoices = false, selectionMode = 'multiple', hideHeading = false, compact = false, onDefer, selectionDraft = [], onSelectionDraft, question, disabled, onChoose, onDraft, children, headingAction, maxLength = QUESTION_TEXT_LIMIT, allowText = true, formatError = cause => ERROR_TEXT[cause?.message]}) {
  const [value, setValue] = useState(question.draft || '');
  const [selected, setSelected] = useState(selectionDraft);
  const deferred = confirmChoices && question.kind === 'choice';
  const [expanded, setExpanded] = useState(false), [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const input = useRef(null), pendingSelection = useRef(null), sending = useRef(false), revision = useRef(0), alive = useRef(true), id = useId();
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useLayoutEffect(() => {
    if (focusRequest) input.current?.focus();
    if (pendingSelection.current !== null && input.current) {
      input.current.setSelectionRange(pendingSelection.current, pendingSelection.current);
      pendingSelection.current = null;
    }
  }, [focusRequest, value]);
  function focusInput() {setFocusRequest(current => current + 1);}
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    function measure() {
      field.style.height = 'auto';
      const compactMax = Math.min(176, Math.max(110, window.innerHeight * .3));
      const fullMax = Math.max(compactMax, window.innerHeight * .65);
      const natural = field.scrollHeight;
      const more = natural > compactMax + 1;
      field.style.height = `${Math.min(natural, expanded ? fullMax : compactMax)}px`;
      field.style.overflowY = natural > (expanded ? fullMax : compactMax) + 1 ? 'auto' : 'hidden';
      setHasMore(current => current === more ? current : more);
      if (!more && expanded) setExpanded(false);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, expanded, question.inputMode]);
  const answered = !!question.answer, blocked = disabled || busy || answered;
  const multiline = question.inputMode === 'long_text' || /[\r\n]/.test(value);
  // Direct entry already follows the choices. Keep original option IDs when
  // hiding redundant entry buttons, including questions saved by older clients.
  const options = questionDisplayOptions(question, {allowText});
  const hasChoices = options.length > 0;
  const inputHint = typeof question.inputPlaceholder === 'string' ? question.inputPlaceholder.trim() : '';
  function change(next) {
    setValue(next); setError('');
    if (deferred && selectionMode === 'single') setSelected([]);
    const current = ++revision.current;
    // Save independently of the composer, including before a popup is closed.
    Promise.resolve().then(() => onDraft(next)).catch(cause => {
      if (alive.current && revision.current === current && !sending.current) setError(formatError(cause) || '저장하지 못했습니다. 답변을 다시 보내주세요.');
    });
  }
  async function choose(choice) {
    if (blocked || sending.current) return;
    if (choice.text?.length > maxLength) {setError(`답변은 ${maxLength.toLocaleString()}자까지 보낼 수 있습니다. 내용을 줄여주세요.`); return;}
    sending.current = true; setBusy(true); setError('');
    try {
      if (await onChoose({questionId: question.id, ...choice}) === false && alive.current) setError('답변을 보내지 못했습니다. 다시 시도해주세요.');
    } catch (cause) {if (alive.current) setError(formatError(cause) || '답변을 보내지 못했습니다. 다시 시도해주세요.');}
    finally {sending.current = false; if (alive.current) setBusy(false);}
  }
  function submit(event) {
    event?.preventDefault();
    if (deferred && selectionMode === 'single') {
      if (options.some(option=>option.id===selected[0])) void choose({optionId:selected[0]});
      else if (value.trim()) void choose({text:value});
    } else if (deferred) {
      const labels = options.filter(option => selected.includes(option.id)).map(option => option.label);
      const text = [...labels, ...(value.trim() ? [labels.length ? `기타: ${value.trim()}` : value.trim()] : [])].join('\n');
      if (text) void choose({text});
    } else if (value.trim()) void choose({text: value});
  }
  function keydown(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {if (event.key === 'Enter') event.preventDefault(); return;}
    // A model-selected short input must not submit an unfinished paragraph.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
  }
  return <InteractionSurface hideHeading={hideHeading} className={`question-card${compact?' question-card--compact':''}`} aria-label="질문" data-answered={answered} aria-busy={busy} title={question.text} titleId={`${id}-title`} data-confirm-choices={deferred} headingClassName="image-question" headingAction={headingAction}
    >
    {typeof children === 'function' ? children({onChoose: choose, disabled: blocked}) : children}
    {!answered && deferred && selectionMode !== 'single' && hasChoices && <span className="question-selection-hint">여러 개 선택 가능</span>}
    {!answered && question.kind === 'choice' && hasChoices && <div className="question-options" role={deferred && selectionMode === 'single' ? 'radiogroup' : 'group'} aria-label={hideHeading ? question.text : undefined} aria-labelledby={hideHeading ? undefined : `${id}-title`} aria-describedby={error ? `${id}-answer-error` : undefined}>
      {options.map((option, index) => <CxButton key={option.id} className="question-option" disabled={blocked} role={deferred ? (selectionMode === 'single' ? 'radio' : 'checkbox') : undefined} aria-checked={deferred ? selected.includes(option.id) : undefined} title={[option.label, option.description].filter(Boolean).join(' — ')} onClick={() => {
        if (!deferred) return choose({optionId: option.id});
        const next = selected.includes(option.id) ? selected.filter(id => id !== option.id) : selectionMode === 'single' ? [option.id] : [...selected, option.id];
        setSelected(next); onSelectionDraft?.(next);
      }}>
        {deferred&&!compact&&<span className="question-select-indicator" aria-hidden="true">{selected.includes(option.id)&&<Icon name="check" size={14}/>}</span>}
        <span className="question-option-index" aria-hidden="true">{compact&&selected.includes(option.id)?<Icon name="check" size={14}/>:index + 1}</span>
        <span className="question-option-copy"><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</span>
        {!deferred&&<Icon name="arrowRight" size={16}/>}
      </CxButton>)}
    </div>}
    {!answered && deferred && allowText && !compact && <span className="question-other-label" aria-hidden="true">기타</span>}
    {!answered && (allowText || deferred) && <form className="interaction-input" id={`${id}-form`} onSubmit={submit}>
      {allowText && <div className="interaction-entry"><span className="interaction-entry-icon" aria-hidden="true"><Icon name="pencil" size={18}/></span><CxField label={deferred ? '기타' : '직접 답변'} id={`${id}-answer`} error={error || undefined}>
      {React.createElement(CxTextarea, {ref: input, value, 'aria-describedby': hideHeading ? undefined : `${id}-title`,
        placeholder: inputHint || (compact ? '또는 직접 답변을 작성하세요' : deferred ? '직접 입력' : multiline ? '예: 포함할 내용과 원하는 분위기' : hasChoices ? '예: 다른 답변이나 추가 조건' : '예: 원하는 내용이나 조건'), maxLength, disabled: blocked,
        rows: multiline ? 3 : 1, onChange: event => change(event.target.value), onKeyDown: keydown,
        onPaste: event => {
          const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
          const field = event.currentTarget;
          const next = value.slice(0, field.selectionStart) + text + value.slice(field.selectionEnd);
          if (next.length > maxLength) {
            event.preventDefault();
            setError(`답변은 ${maxLength.toLocaleString()}자까지 입력할 수 있습니다. 붙여넣지 않았으며 기존 답변은 유지됩니다.`);
            return;
          }
          if (/[\r\n]/.test(text)) {
            event.preventDefault();
            pendingSelection.current = field.selectionStart + text.length;
            change(next);
            focusInput();
          }
        }})}
      </CxField></div>}
      <div className="interaction-input-actions">
        {hasMore && <CxButton type="button" className="question-more" title={expanded ? '답변 입력 줄이기' : '답변 입력 펼치기'} aria-expanded={expanded} aria-controls={`${id}-answer`} disabled={blocked} onClick={() => {setExpanded(current => !current); focusInput();}}><Icon name={expanded ? 'minimize' : 'maximize'} size={16}/>{expanded ? '접기' : '더 보기'}</CxButton>}
        {value.length > maxLength * .9 && <span className="interaction-count" role="status">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</span>}
        {onDefer&&<CxButton type="button" className="question-defer" disabled={blocked} onClick={onDefer}>나중에</CxButton>}
        <CxButton type="submit" variant="primary" className="question-send" aria-label="답변 보내기" title="답변 보내기 (Ctrl/⌘+Enter)" disabled={blocked || (!value.trim() && !(deferred && options.some(option => selected.includes(option.id))))} busy={busy}><Icon name="arrowUp" size={18}/>{(showActionLabels || deferred)&&<span>{compact?'보내기':'답변 보내기'}</span>}</CxButton>
      </div>
    </form>}
    {error && !answered && !allowText && <div id={`${id}-answer-error`}><CxNotice tone="danger">{error}</CxNotice></div>}
  </InteractionSurface>;
}
