import { useEffect, useRef } from 'react';

// Shared click-outside-to-close: one hook for every dropdown, menu and
// popover in the app, so none is missed and none stays open when the
// person taps anywhere else.
//
// Wrap the toggle button AND the menu in the same element and attach
// the returned ref to it: the toggle is then inside the boundary, so
// tapping it still opens and closes the menu normally, while a tap
// anywhere else closes it with no selection made. Listens to
// mousedown and touchstart (tap on a phone), plus Escape.
//
//   const menuRef = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
//   <div ref={menuRef}>
//     <button onClick={() => setOpen((v) => !v)}>Menu</button>
//     {open && <div className="menu">...</div>}
//   </div>
//
// When the toggle and the menu cannot share one wrapper (two toggles
// in different bars, a desktop copy and a mobile copy of the same
// menu), use useClickOutsideMany with one ref per boundary element
// instead: a tap counts as outside only when it is outside ALL of them.

type AnyRef = React.RefObject<HTMLElement | null>;

function useOutsideListener(
  contains: (target: Node) => boolean,
  onOutside: () => void,
  active: boolean,
): void {
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;
  const containsRef = useRef(contains);
  containsRef.current = contains;

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!containsRef.current(e.target as Node)) cbRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cbRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);
}

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const contains = (target: Node) => {
    const el = ref.current;
    return !!el && el.contains(target);
  };
  useOutsideListener(contains, onOutside, active);
  return ref;
}

export function useClickOutsideMany(
  refs: AnyRef[],
  onOutside: () => void,
  active = true,
): void {
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const contains = (target: Node) =>
    refsRef.current.some((r) => {
      const el = r.current;
      return !!el && el.contains(target);
    });
  useOutsideListener(contains, onOutside, active);
}
