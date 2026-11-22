// A small modal form: fields, validation shown under the field, Enter submits, Escape cancels, focus kept inside and
// given back to where it was. Made from the inventory's dialog component.
import { h, iconSvg } from './dom';

export interface DialogField {
  key: string;
  label: string;
  kind?: 'text' | 'select';
  value?: string;
  placeholder?: string;
  options?: [string, string][];
  hint?: string;
  mono?: boolean;
  /** returns an error message, or '' when valid */
  check?(v: string): string;
}

export function openDialog(opt: { title: string; icon?: string; text?: string; fields: DialogField[]; ok: string; grid?: boolean }): Promise<Record<string, string> | null> {
  return new Promise((done) => {
    const back = document.activeElement as HTMLElement | null;
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const errs = new Map<string, HTMLElement>();
    const fields = opt.fields.map((f) => {
      const id = `dlg-${f.key}`;
      let el: HTMLInputElement | HTMLSelectElement;
      if (f.kind === 'select') { el = h('select', { class: 'select', id }); for (const [v, l] of f.options ?? []) el.append(h('option', { value: v }, l)); el.value = f.value ?? f.options?.[0]?.[0] ?? ''; }
      else el = h('input', { class: 'input' + (f.mono ? ' mono' : ''), id, value: f.value ?? '', placeholder: f.placeholder ?? '', spellcheck: 'false', autocomplete: 'off' });
      inputs.set(f.key, el);
      const err = h('div', { class: 'err', role: 'alert' }); err.hidden = true; errs.set(f.key, err);
      const wrap = f.kind === 'select' ? h('span', { class: 'select-wrap', html: iconSvg('chevron-down') }) : null;
      if (wrap) wrap.prepend(el);
      return h('div', { class: 'field' }, h('label', { for: id }, f.label), wrap ?? el, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err);
    });
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    const ok = h('button', { class: 'btn btn-primary' }, opt.ok);
    const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { class: 'dialog-head', id: 'dlg-title', html: opt.icon ? iconSvg(opt.icon) : '' }, opt.title),
      h('div', { class: 'dialog-body' }, opt.text ? h('div', null, opt.text) : null, opt.grid ? h('div', { class: 'dialog-grid' }, fields) : fields),
      h('div', { class: 'dialog-foot' }, cancel, ok));
    const overlay = h('div', { class: 'overlay' }, dlg);
    const close = (v: Record<string, string> | null) => { overlay.remove(); back?.focus(); done(v); };
    const submit = () => {
      let bad = false; const out: Record<string, string> = {};
      for (const f of opt.fields) {
        const v = inputs.get(f.key)!.value.trim(); out[f.key] = v;
        const e = f.check?.(v) ?? ''; const el = errs.get(f.key)!;
        el.hidden = !e; el.innerHTML = e ? `${iconSvg('circle-alert')}${e}` : '';
        inputs.get(f.key)!.classList.toggle('is-error', !!e); if (e && !bad) { bad = true; inputs.get(f.key)!.focus(); }
      }
      if (!bad) close(out);
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    dlg.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); submit(); }
      else if (e.key === 'Tab') { // keep focus inside
        const f = [...dlg.querySelectorAll<HTMLElement>('input, select, button')]; const i = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });
    document.body.append(overlay);
    (inputs.values().next().value as HTMLElement | undefined)?.focus();
  });
}
