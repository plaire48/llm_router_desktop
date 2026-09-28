import React from 'react';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import {INPUT_TEXT_LIMIT} from '../worker/input-contract.mjs';
import {errorText} from './errors.js';

export function OfficeQuestion({question, disabled, onChoose, onDraft}) {
  return <QuestionForm question={question} maxLength={question.inputLimit ?? INPUT_TEXT_LIMIT} disabled={disabled} onChoose={onChoose} onDraft={onDraft} formatError={cause=>errorText(cause?.message)}/>;
}
