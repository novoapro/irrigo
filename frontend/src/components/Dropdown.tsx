import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}

/**
 * Dropdown — an accessible custom "listbox" (a styled replacement for a
 * native <select>).
 *
 * Why not a real <select>? This component needs a menu that can escape its
 * scrolling container, so the menu is rendered through a React portal into
 * <body> and positioned with getBoundingClientRect(). A native <select> can't
 * be styled/positioned that freely, so we rebuild the interaction ourselves —
 * which means we're also responsible for the accessibility a <select> gives
 * you for free.
 *
 * ACCESSIBILITY MODEL (ARIA "combobox + listbox" pattern):
 *  - The trigger button is the combobox: role="combobox", aria-haspopup="listbox",
 *    aria-expanded reflects open/closed, and aria-controls points at the menu id.
 *  - The menu is role="listbox" with a stable id; each option is role="option"
 *    with aria-selected marking the current value.
 *  - Keyboard focus STAYS on the trigger the whole time. Instead of moving DOM
 *    focus between options, we track a "highlighted index" in state and expose it
 *    to screen readers via aria-activedescendant on the listbox (it names the id
 *    of the currently highlighted option). This is the standard "active
 *    descendant" technique and keeps focus management simple.
 *
 * KEYBOARD MODEL (handled on the trigger, since it keeps focus):
 *  - Arrow Down / Arrow Up : open the menu if closed; otherwise move the highlight.
 *  - Home / End            : jump the highlight to the first / last option.
 *  - Enter / Space         : if open, select the highlighted option; if closed, open.
 *  - Escape                : close the menu (focus is already on the trigger).
 *
 * Preserved from the original: click an option to select, click outside or
 * scroll to close, and the portal-based positioning.
 *
 * Intentionally skipped: typeahead (type a letter to jump to a matching
 * option). It's optional for this pattern and was left out to keep the code
 * approachable.
 */
const Dropdown = ({ value, options, onChange }: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // The option the highlight sits on while navigating with the keyboard.
  // -1 means "nothing highlighted" (e.g. the menu is closed).
  const [highlighted, setHighlighted] = useState(-1);

  // Stable, unique id prefix for this instance so we can build the menu id and
  // per-option ids that aria-controls / aria-activedescendant refer to.
  const baseId = useId();
  const menuId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  // Open the menu and seed the highlight on the current value (or the first
  // option). Kept in the open handlers — not an effect — so we never setState
  // synchronously inside an effect. (Highlight isn't shown while closed, so
  // there's no need to reset it on close; the next open re-seeds it.)
  const openMenu = () => {
    setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 200 && rect.top > spaceBelow;

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      zIndex: 10000,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => setOpen(false);
    const scrollParent = triggerRef.current?.closest("[class*='content']") ?? window;
    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollParent.removeEventListener("scroll", handleScroll);
  }, [open]);

  // Commit the option currently under the highlight.
  const selectHighlighted = () => {
    const opt = options[highlighted];
    if (opt) {
      onChange(opt.value);
      setOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openMenu();
        } else {
          setHighlighted((i) => Math.min(i + 1, options.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          openMenu();
        } else {
          setHighlighted((i) => Math.max(i - 1, 0));
        }
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setHighlighted(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setHighlighted(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        // Prevent the button's default Space/Enter "click" so we control the
        // behaviour ourselves (otherwise Space would just toggle the menu).
        e.preventDefault();
        if (open) {
          selectHighlighted();
        } else {
          openMenu();
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          // Focus is already on the trigger in this pattern, so nothing else
          // to restore.
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="dropdown" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown__trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span>{selected?.label ?? ""}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="dropdown__chevron">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <ul
          className="dropdown__menu dropdown__menu--portal"
          ref={menuRef}
          style={menuStyle}
          id={menuId}
          role="listbox"
          aria-activedescendant={highlighted >= 0 ? optionId(highlighted) : undefined}
        >
          {options.map((opt, index) => (
            <li key={opt.value}>
              <button
                type="button"
                id={optionId(index)}
                role="option"
                aria-selected={opt.value === value}
                className={`dropdown__item${opt.value === value ? " dropdown__item--active" : ""}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                // Keep the visual highlight in sync with the mouse so hover and
                // keyboard navigation agree on "which option is active".
                onMouseEnter={() => setHighlighted(index)}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
};

export default Dropdown;
