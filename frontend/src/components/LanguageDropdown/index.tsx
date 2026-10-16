import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { usePreferences } from '../../contexts/PreferencesContext';

const options = [{ value: 'th', label: 'ไทย', description: 'Thai', code: 'TH' }, { value: 'en', label: 'English', description: 'อังกฤษ', code: 'EN' }] as const;

export function LanguageDropdown() {
  const { language, setLanguage, t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const valueId = useId();

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function show() {
    setActive(options.findIndex(option => option.value === language));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <div ref={root} className="language-dropdown" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" className="language-trigger" aria-label={t('ภาษา')} aria-describedby={valueId} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
        <Languages size={16} aria-hidden="true" /><span id={valueId}>{options.find(option => option.value === language)!.label}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && <div className="language-popover">
        <div id={menuId} className="language-menu" role="listbox" aria-label={t('ภาษา')} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
        else if (['e', 't', 'ไ'].includes(event.key.toLowerCase())) { event.preventDefault(); setActive(event.key.toLowerCase() === 'e' ? 1 : 0); }
      }}>
        {options.map((option, index) => <button key={option.value} type="button" ref={element => { optionRefs.current[index] = element; }} role="option" aria-label={option.label} aria-selected={language === option.value} tabIndex={-1} className="language-option" onFocus={() => setActive(index)} onClick={() => { setLanguage(option.value); close(); }}>
          <span className="language-code" aria-hidden="true">{option.code}</span><span className="language-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span><span className="language-check" aria-hidden="true">{language === option.value && <Check size={13} strokeWidth={2.5} />}</span>
        </button>)}
        </div>
      </div>}
    </div>
  );
}
