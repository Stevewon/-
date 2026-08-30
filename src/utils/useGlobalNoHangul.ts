import { useEffect } from 'react';
import { hasHangul, stripHangul } from './noHangul';

// ---------------------------------------------------------------------------
// useGlobalNoHangul — a single app-wide guard that stops Korean (Hangul) from
// being keyed into ANY <input> or <textarea>, everywhere in the app (signup,
// KYC, exchange, admin — all of it), without having to touch each field.
//
// It listens at the document level (capture phase) for `input`, `paste`,
// `compositionupdate` and `compositionend`. When Hangul is detected it strips
// it and writes the cleaned value back through React's native value setter so
// controlled components (useState) also see the cleaned value and re-render.
//
// Fields can opt OUT with `data-allow-hangul` (none needed today, but leaves a
// safety valve). Password fields are left alone (they may legitimately contain
// any character and are never Korean names/emails anyway) — but since the boss
// wants Korean blocked EVERYWHERE, we block them too by default. If that ever
// causes trouble, add data-allow-hangul to that specific field.
// ---------------------------------------------------------------------------

function isTextEntry(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const node = el as HTMLElement;
  const tag = node.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (node as HTMLInputElement).type;
    // Skip non-text input types where Hangul can't be typed anyway.
    if (['checkbox', 'radio', 'range', 'color', 'file', 'date', 'time',
         'datetime-local', 'month', 'week', 'button', 'submit', 'reset'].includes(type)) {
      return false;
    }
    return true;
  }
  return false;
}

// Get the correct native value setter so React's onChange fires on write-back.
function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
  // Notify React (and any other listeners) that the value changed.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useGlobalNoHangul(): void {
  useEffect(() => {
    const cleanEl = (el: HTMLInputElement | HTMLTextAreaElement) => {
      if (el.hasAttribute('data-allow-hangul')) return;
      const raw = el.value;
      if (!hasHangul(raw)) return;
      const cleaned = stripHangul(raw);
      const caret = Math.min(el.selectionStart ?? cleaned.length, cleaned.length);
      nativeSetValue(el, cleaned);
      try { el.setSelectionRange(caret, caret); } catch { /* number inputs throw */ }
    };

    const onInput = (e: Event) => {
      if (!isTextEntry(e.target)) return;
      cleanEl(e.target as HTMLInputElement | HTMLTextAreaElement);
    };

    const onCompositionUpdate = (e: Event) => {
      if (!isTextEntry(e.target)) return;
      // During Korean IME composition, strip on the fly.
      cleanEl(e.target as HTMLInputElement | HTMLTextAreaElement);
    };

    const onCompositionEnd = (e: Event) => {
      if (!isTextEntry(e.target)) return;
      cleanEl(e.target as HTMLInputElement | HTMLTextAreaElement);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!isTextEntry(e.target)) return;
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (el.hasAttribute('data-allow-hangul')) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (!hasHangul(text)) return;
      e.preventDefault();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const insert = stripHangul(text);
      const next = el.value.slice(0, start) + insert + el.value.slice(end);
      nativeSetValue(el, next);
      const pos = start + insert.length;
      try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    };

    // Capture phase so we run before component handlers.
    document.addEventListener('input', onInput, true);
    document.addEventListener('compositionupdate', onCompositionUpdate, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('paste', onPaste, true);

    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('compositionupdate', onCompositionUpdate, true);
      document.removeEventListener('compositionend', onCompositionEnd, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, []);
}
