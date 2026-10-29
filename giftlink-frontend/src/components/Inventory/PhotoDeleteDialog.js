import React, { useEffect, useRef } from 'react';

export default function PhotoDeleteDialog({ position, cover, onDecision }) {
  const dialog = useRef(), cancel = useRef();
  useEffect(() => {
    const previous = document.activeElement, node = dialog.current;
    if (node.showModal) node.showModal(); else node.setAttribute('open', '');
    cancel.current.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="ui-page item-photo-delete-dialog" aria-modal="true" aria-labelledby="delete-photo-title" aria-describedby="delete-photo-description"
    onCancel={event => { event.preventDefault(); onDecision(false); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onDecision(false); }
      if (event.key === 'Tab') {
        const buttons = [...dialog.current.querySelectorAll('button')], first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <h2 id="delete-photo-title">Delete photo {position + 1}?</h2>
    <p id="delete-photo-description">This removes the photo from this item.{cover && ' The next photo will become the cover.'}</p>
    <div className="item-photo-delete-actions">
      <button ref={cancel} type="button" className="ui-button ui-button--secondary" onClick={() => onDecision(false)}>Keep photo</button>
      <button type="button" className="ui-button" onClick={() => onDecision(true)}>Delete photo</button>
    </div>
  </dialog>;
}
