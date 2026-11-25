import { useEffect, useRef, type ReactNode } from 'react';

interface Action {
  label: string;
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
}

interface Props {
  label: string;
  icon?: ReactNode;
  /** アイコンの横に出す短い表示ラベル（スマホでも読めるよう、アイコンだけの表示にしない）。 */
  shortLabel?: string;
  active?: boolean;
  actions: readonly Action[];
}

export function EditorActions({ label, icon, shortLabel, active, actions }: Props) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    function closeOnOutsidePress(event: PointerEvent) {
      const details = disclosure.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    }
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, []);

  function closeAndFocusTrigger() {
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus();
  }

  return (
    <details
      ref={disclosure}
      className="editor-actions"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusTrigger();
      }}
    >
      <summary
        ref={trigger}
        className={
          icon
            ? `icon-btn${shortLabel ? ' has-label' : ''}`
            : `btn btn-small editor-actions-text${active ? ' is-active' : ''}`
        }
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
      >
        {icon ?? label}
        {icon && shortLabel && <span className="editor-actions-short-label">{shortLabel}</span>}
      </summary>
      <div className="editor-actions-panel" role="group" aria-label={label}>
        {actions.map(({ label: actionLabel, run, disabled, pressed, danger }) => (
          <button
            key={actionLabel}
            type="button"
            className={`btn btn-small${danger ? ' btn-danger' : ''}`}
            disabled={disabled}
            aria-pressed={pressed}
            onClick={() => {
              closeAndFocusTrigger();
              run();
            }}
          >
            {actionLabel}
          </button>
        ))}
      </div>
    </details>
  );
}
