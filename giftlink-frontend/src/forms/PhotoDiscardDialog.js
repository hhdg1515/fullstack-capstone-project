import React, { useEffect, useRef } from 'react';
import './PhotoDiscardDialog.css';

export default function PhotoDiscardDialog({ alsoText, onDecision }) {
  const dialog = useRef(), stay = useRef();
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    if (element.showModal) element.showModal(); else element.setAttribute('open', '');
    stay.current.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="ui-page photo-discard-dialog" aria-modal="true" aria-labelledby="photo-discard-title" aria-describedby="photo-discard-description"
    onCancel={event => { event.preventDefault(); onDecision(false); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onDecision(false); }
      if (event.key === 'Tab') {
        const buttons = [...dialog.current.querySelectorAll('button')], first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <h2 id="photo-discard-title">Leave photos behind?</h2>
    <p id="photo-discard-description">Unsent photos will be lost. Uploads already accepted may still finish.{alsoText && ' Unsaved text changes will also be discarded.'}</p>
    <div className="photo-discard-actions">
      <button type="button" ref={stay} className="ui-button" onClick={() => onDecision(false)}>Stay and keep photos</button>
      <button type="button" className="ui-button ui-button--secondary" onClick={() => onDecision(true)}>Leave and discard photos</button>
    </div>
  </dialog>;
}
