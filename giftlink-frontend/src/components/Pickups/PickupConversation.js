import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useAppContext } from '../../context/AuthContext';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import { closedStates, mergeMessages, mergeRanges, openStates, roles, validMessage, validPage } from './conversationHistory';
import { Feedback } from '../../design-system/primitives';
import './PickupConversation.css';

const suggestedWait = failure => {
  const seconds = failure.retryAfterSeconds; if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) return '';
  const unit = seconds === 3600 ? 'hour' : seconds >= 60 ? 'minute' : 'second';
  const amount = Math.ceil(seconds / (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1));
  return ` Suggested wait: ${amount} ${unit}${amount === 1 ? '' : 's'}.`;
};
const messageTime = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric',
  ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const fullMessageTime = value => new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'long' }).format(new Date(value));
const failureText = (failure, sending) => {
  if (failure.status === 401) return 'Your session ended. Sign in again to read this conversation.';
  if (failure.status === 403) return 'Access could not be verified. Refresh the conversation; if this continues, sign in again.';
  if (failure.status === 404) return 'This conversation is unavailable. Refresh to check whether the request or your access changed.';
  if (failure.status === 409) return 'The conversation changed. Refresh before sending again.';
  if (failure.status === 429) return failure.code === 'MESSAGE_QUOTA_EXCEEDED' ?
    'Message limit reached. Your text is kept. Try again later.' + suggestedWait(failure) : 'Too many requests. Wait a minute, then try again.';
  return sending ? 'Sending could not be confirmed. Your text is kept. Refresh and check recent messages before sending it again.' :
    'Could not load messages. Your loaded history and unsent text are kept. Please retry.';
};

export default function PickupConversation(props) {
  const { user } = useAppContext();
  return <Conversation key={`${user.id}:${props.requestId}`} {...props} />;
}

function Conversation({ requestId, requestStatus, refreshToken }) {
  const root = `/api/pickup-requests/${encodeURIComponent(requestId)}/conversation`;
  const [view, setView] = useState({ context: null, ranges: [] });
  const current = useRef(view);
  const update = useCallback(change => { current.current = change(current.current); setView(current.current); }, []);
  const [busy, setBusy] = useState('initial'); const inFlight = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [draft, setDraft] = useState(''); const guard = useUnsavedForm({ text: draft }, { text: '' });
  const validation = useFormErrors(busy === 'send');
  const generation = useRef(0); const alive = useRef(false);
  const history = useRef(); const composer = useRef(); const position = useRef();
  const capture = useCallback(bottom => {
    const box = history.current; if (!box) return;
    const top = box.getBoundingClientRect().top;
    const anchor = [...box.querySelectorAll('.chat-message')].find(element => element.getBoundingClientRect().bottom > top);
    position.current = { bottom: bottom && box.scrollHeight - box.scrollTop - box.clientHeight < 24,
      anchor, offset: anchor?.getBoundingClientRect().top - top, scrollTop: box.scrollTop };
  }, []);
  useLayoutEffect(() => {
    const box = history.current, saved = position.current; position.current = null;
    if (!box || !saved) return;
    if (saved.bottom) box.scrollTop = box.scrollHeight;
    else if (saved.anchor?.isConnected) box.scrollTop += saved.anchor.getBoundingClientRect().top - box.getBoundingClientRect().top - saved.offset;
    else box.scrollTop = saved.scrollTop;
  }, [view.ranges]);

  const load = useCallback(async (kind = 'refresh') => {
    if (inFlight.current) return;
    const index = current.current.ranges.findIndex(range => range.nextCursor);
    if (kind === 'earlier' && index < 0) return;
    inFlight.current = true; const ticket = ++generation.current;
    setBusy(kind); setError(''); setNotice('');
    try {
      const path = root + '/messages' + (kind === 'earlier' ? '?before=' + encodeURIComponent(current.current.ranges[index].nextCursor) : '');
      const context = kind === 'earlier' ? null : await apiRequest(root, { notifyUnauthorized: false, validate: data => data?.conversation?.id === requestId &&
        data.conversation.requestId === requestId && roles.includes(data.conversation.role) &&
        [...openStates, ...closedStates].includes(data.conversation.status) && typeof data.conversation.counterpart?.firstName === 'string' });
      if (!alive.current || ticket !== generation.current) return;
      const page = await apiRequest(path, { notifyUnauthorized: false, validate: validPage });
      if (!alive.current || ticket !== generation.current) return;
      capture(kind !== 'earlier');
      if (kind === 'initial') position.current = { bottom: true };
      update(previous => {
        const ranges = kind === 'earlier' ? previous.ranges.map((range, i) => i === index ?
          { messages: mergeMessages(range.messages, page.messages), nextCursor: page.nextCursor } : range) : [page, ...previous.ranges];
        return { context: context?.conversation || previous.context, ranges: mergeRanges(ranges) };
      });
      if (kind !== 'earlier') setBlocked(false);
      setNotice(kind === 'earlier' ? 'Earlier messages loaded.' : kind === 'initial' ? 'Conversation loaded.' : 'Conversation refreshed.');
    } catch (failure) {
      if (!alive.current || ticket !== generation.current) return;
      if ([401, 403, 404].includes(failure.status)) { update(() => ({ context: null, ranges: [] })); setBlocked(true); }
      if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
      setError(failureText(failure, false));
    } finally {
      if (alive.current && ticket === generation.current) { inFlight.current = false; setBusy(''); }
    }
  }, [root, requestId, capture, update]);
  useEffect(() => {
    alive.current = true; load('initial');
    return () => { alive.current = false; inFlight.current = false; };
  }, [load]);

  const previousRefresh = useRef(refreshToken);
  useEffect(() => {
    if (previousRefresh.current === refreshToken) return;
    previousRefresh.current = refreshToken;
    load();
  }, [refreshToken, load]);

  const context = view.context;
  const closed = closedStates.includes(requestStatus) || closedStates.includes(context?.status);
  const canSend = context && openStates.includes(context.status) && openStates.includes(requestStatus) && !closed && !blocked;
  const send = async event => {
    event.preventDefault(); if (inFlight.current || !canSend) return;
    validation.reset(); const text = draft.trim(); const size = Array.from(text).length;
    if (!size || size > 2000) { validation.show({ text: 'Enter a message of 1 to 2,000 characters.' }); return; }
    if (Array.from(text).some(character => {
      const code = character.charCodeAt(0);
      return character === '<' || character === '>' || (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })) {
      validation.show({ text: 'Remove <, > and unsupported control characters.' }); return;
    }
    inFlight.current = true; const ticket = ++generation.current;
    setBusy('send'); setError(''); setNotice('');
    try {
      const result = await apiRequest(root + '/messages', { method: 'POST', body: { text }, notifyUnauthorized: false,
        validate: data => validMessage(data?.message) && data.message.sender === context.role });
      if (!alive.current || ticket !== generation.current) return;
      capture(true);
      update(previous => ({ ...previous, ranges: [{ ...previous.ranges[0], messages: mergeMessages(previous.ranges[0].messages, [result.message]) }, ...previous.ranges.slice(1)] }));
      setDraft(''); guard.markSaved(); setUncertain(false); setNotice('Message sent.');
      if (validation.formRef.current?.contains(document.activeElement)) composer.current?.focus({ preventScroll: true });
    } catch (failure) {
      if (!alive.current || ticket !== generation.current) return;
      if ([401, 403, 404].includes(failure.status)) update(() => ({ context: null, ranges: [] }));
      if ([401, 403, 404, 409].includes(failure.status) || !failure.status || failure.status >= 500) setBlocked(true);
      if (!failure.status || failure.status >= 500) setUncertain(true);
      if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
      if (failure.status === 400) validation.failure(failure, ['text']);
      else validation.show({}, failureText(failure, true));
    } finally {
      if (alive.current && ticket === generation.current) { inFlight.current = false; setBusy(''); }
    }
  };
  const messages = view.ranges.flatMap(range => range.messages);
  return <section id="conversation" className="pickup-conversation" aria-labelledby="conversation-heading">
    <h2 id="conversation-heading" className="visually-hidden" tabIndex={-1}>Pickup conversation</h2>
    {(error || blocked || uncertain) && <button type="button" className="ui-button ui-button--secondary" disabled={Boolean(busy)} onClick={() => { validation.reset(); load(); }}>{context ? 'Refresh conversation' : 'Retry conversation'}</button>}
    {error && <Feedback error>{error}</Feedback>}
    <p role="status" className="visually-hidden">{busy === 'send' ? 'Sending message…' : busy ? (busy === 'earlier' ? 'Loading earlier messages…' : 'Loading conversation…') : notice}</p>
    {(context || draft.length > 0) && <div className="chat-box">{context && <>
      {closed && <p className="visually-hidden">This request is closed. You can read its messages, but cannot send new ones.</p>}
      <button type="button" className="ui-button ui-button--secondary" disabled={Boolean(busy)} hidden={!view.ranges.some(range => range.nextCursor)} onClick={() => load('earlier')}>Load earlier messages</button>
      <div ref={history} className="chat-history" role="region" aria-label="Message history" tabIndex={0}>
        {!messages.length ? <p>No messages yet.</p> : <ol>{view.ranges.slice().reverse().flatMap((range, index) => [
          ...range.messages.map(message => <li key={message.id} className={`chat-message${message.sender === context.role ? ' chat-mine' : ''}`}>
            <div className="chat-message-heading"><strong>{message.sender === context.role ? 'You' : context.counterpart.firstName}</strong>
              <time dateTime={message.createdAt} title={fullMessageTime(message.createdAt)} aria-label={fullMessageTime(message.createdAt)}>{messageTime(message.createdAt)}</time></div>
            <p className="chat-text">{message.text}</p></li>),
          ...(index < view.ranges.length - 1 ? [<li key={`gap-${index}`} className="chat-gap">Some messages between these pages are not loaded yet. Use Load earlier messages to fill the gap.</li>] : [])
        ])}</ol>}
      </div></>}
    {((!closed && context) || draft.length > 0) && <form ref={validation.formRef} className="chat-composer" noValidate onSubmit={send} aria-busy={busy === 'send'}>
      <div className="ui-field chat-input"><label htmlFor="chat-text" className="visually-hidden">{canSend ? 'Message' : 'Unsent message'}</label>
        <div className="chat-compose-control"><textarea ref={composer} id="chat-text" name="text" rows={3} value={draft} readOnly={!canSend || busy === 'send'}
          {...validation.fieldProps('text')} aria-describedby={[validation.fieldProps('text')['aria-describedby'], 'chat-privacy'].filter(Boolean).join(' ')} onChange={event => { setDraft(event.target.value); validation.clear('text'); }} />
        <button type="submit" className="chat-send" aria-label="Send message" title="Send message" disabled={!canSend || Boolean(busy)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
        </button></div>
        <span id="chat-privacy" className="visually-hidden">Up to 2,000 characters. Plain text. Keep residential addresses and sensitive account details out of messages.</span>
        {validation.errors.text && <p id="text-error" className="ui-field-error">{validation.errors.text}</p>}</div>
      {uncertain && !closed && <p>Check recent messages after refreshing before deciding whether to send this draft again.</p>}
      {!canSend && draft && <p>Your unsent text is kept here. Refresh to check access, or discard the draft.</p>}
      <div className="chat-actions">
        {!canSend && draft && <button type="button" className="ui-button ui-button--secondary" disabled={Boolean(busy)} onClick={() => {
          if (guard.confirmDiscard()) { setDraft(''); setUncertain(false); validation.reset(); }
        }}>Discard draft</button>}</div>
    </form>}
    </div>}
    {validation.error && <Feedback error ref={validation.summaryRef} tabIndex={-1}>{validation.error}</Feedback>}
  </section>;
}
