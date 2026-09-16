// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The order page's section menu, in its two breakpoint forms.
 *
 * - `OrderSectionRail` (xl+) is the left column of the three-column order
 *   layout: a sticky card with the order's document actions on top (Send,
 *   Download, Customer View), the section list in the middle, and the
 *   destructive/copy actions at the bottom (Duplicate, Delete) — the
 *   bottom placement keeps Delete as far from Send as the card allows. It
 *   collapses to an icon strip. The top and bottom actions are icons only
 *   in both forms (one row expanded, a column collapsed); every icon keeps
 *   `title` + `aria-label` so it stays identifiable and accessible.
 * - `OrderSectionTabs` (below xl) is the same section list as a dropdown
 *   under the page header. There is no
 *   room for a third column on a phone or tablet, so the document actions
 *   move to `OrderActionsMenu` in the header instead.
 *
 * Both are presentational. `OrderDetail` owns the selected section (it
 * lives in the URL, see `orderSections.ts`), every handler, and each
 * action's disabled state, so the two forms can never disagree about what
 * an action does.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PAGE_CONTAINER } from '../../components/PageHeader';
import {
  ORDER_SECTIONS,
  isSectionAvailable,
  type OrderSectionId,
} from './orderSections';

/**
 * One document-level action (Send, Download, Customer View, Duplicate,
 * Delete). Shared by the rail and the phone overflow menu.
 */
export interface OrderNavAction {
  key: string;
  icon: ReactNode;
  /** Menu label below xl; the rail's tooltip and accessible name (the rail shows icons only). */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Longer explanation for the tooltip, e.g. why the action is disabled. */
  title?: string;
  /**
   * `primary` is the one filled button (Send); `danger` is Delete's red
   * ink. Everything else is neutral, so the rail keeps a single coloured
   * call to action.
   */
  variant?: 'primary' | 'neutral' | 'danger';
}

/**
 * Small marker beside a section's label: a count, or a dot when `text` is
 * empty. `danger` is reserved for the open cancellation request (matching
 * that banner's red), `warning` for things awaiting action such as open
 * edit requests or a balance due.
 */
export interface OrderSectionBadge {
  text?: string;
  tone: 'danger' | 'warning' | 'neutral';
}

/** Props shared by both menu forms. */
interface SectionMenuProps {
  active: OrderSectionId;
  /** Saved-only sections render disabled until the order has an id. */
  isSaved: boolean;
  onSelect: (id: OrderSectionId) => void;
  badges: Partial<Record<OrderSectionId, OrderSectionBadge>>;
}

/** Stroke glyph at the menu's icon size; paths inherit the text colour. */
function Glyph({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** One icon per section, in the same line language as the rest of the page. */
const SECTION_ICONS: Record<OrderSectionId, ReactNode> = {
  details: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  items: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  payments: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  appointments: (
    <>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </>
  ),
  manufacturer: (
    <>
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M17 18h1M12 18h1M7 18h1" />
    </>
  ),
  logs: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l4 2" />
    </>
  ),
};

const BADGE_TONES: Record<OrderSectionBadge['tone'], string> = {
  danger: 'bg-danger text-white',
  warning: 'bg-warning-tint text-warning',
  neutral: 'bg-surface-sunken text-text-muted',
};

const DOT_TONES: Record<OrderSectionBadge['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-text-muted',
};

/** Badge beside a label: a pill with text, or a bare dot without. */
function Badge({ badge }: { badge: OrderSectionBadge }) {
  if (!badge.text) {
    return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONES[badge.tone]}`} />;
  }
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold ${BADGE_TONES[badge.tone]}`}>
      {badge.text}
    </span>
  );
}

/** Tooltip text for a section button, explaining a disabled one. */
function sectionTitle(label: string, available: boolean): string {
  return available ? label : `${label} — save the order first`;
}

/**
 * Button classes for an icon-only rail action. Expanded, the group is one
 * row and each button takes an equal share of it; collapsed, the group is
 * a column of 40px squares.
 */
function railActionClass(variant: OrderNavAction['variant'], collapsed: boolean): string {
  const shape = collapsed ? 'h-10 w-10' : 'h-10 min-w-0 flex-1';
  const tone =
    variant === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : variant === 'danger'
        ? 'text-danger hover:bg-danger-tint'
        : 'text-text-secondary hover:bg-surface-sunken';
  return `flex shrink-0 items-center justify-center rounded-md disabled:opacity-40 ${shape} ${tone}`;
}

/**
 * A group of rail actions (top or bottom), shown as icons only. The label
 * is still the tooltip (`title`, or the action's longer explanation) and
 * the accessible name, so nothing is lost for hover or screen readers.
 */
function RailActions({ actions, collapsed }: { actions: OrderNavAction[]; collapsed: boolean }) {
  if (actions.length === 0) return null;
  return (
    <div className={`flex gap-1 p-2 ${collapsed ? 'flex-col items-center' : 'flex-row'}`}>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          title={a.title ?? a.label}
          aria-label={a.label}
          className={railActionClass(a.variant, collapsed)}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

/** Props for the xl+ left rail. */
interface OrderSectionRailProps extends SectionMenuProps {
  /** Send / Download / Customer View, rendered above the sections. */
  topActions: OrderNavAction[];
  /** Duplicate / Delete, rendered below the sections. */
  bottomActions: OrderNavAction[];
  /**
   * Compact order identity (status, customer, date) shown at the top of
   * the expanded rail so the context survives switching sections. Hidden
   * when collapsed — there is no room, and the header still names the order.
   */
  summary: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Left column of the xl+ order layout. Sticks below the page header and
 * scrolls its section list internally, so the top and bottom action
 * groups stay visible on short screens.
 */
export function OrderSectionRail({
  active,
  isSaved,
  onSelect,
  badges,
  topActions,
  bottomActions,
  summary,
  collapsed,
  onToggleCollapsed,
}: OrderSectionRailProps) {
  return (
    <nav
      aria-label="Order sections"
      className="sticky top-[calc(var(--order-head-h,4rem)+1.5rem)] hidden max-h-[calc(100dvh-var(--order-head-h,4rem)-3rem)] flex-col overflow-hidden rounded-xl border border-border-light bg-surface shadow-md xl:flex"
    >
      <div className={`flex items-start gap-2 border-b border-border-light p-2 ${collapsed ? 'justify-center' : ''}`}>
        {!collapsed && <div className="min-w-0 flex-1 px-1.5 py-1">{summary}</div>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand section menu' : 'Collapse section menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-text-primary"
        >
          <Glyph size={16}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
            <path d={collapsed ? 'm14 9 3 3-3 3' : 'm16 15-3-3 3-3'} />
          </Glyph>
        </button>
      </div>

      <RailActions actions={topActions} collapsed={collapsed} />

      <ul className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-y border-border-light p-2 ${collapsed ? 'items-center' : ''}`}>
        {ORDER_SECTIONS.map((s) => {
          const available = isSectionAvailable(s.id, isSaved);
          const current = s.id === active;
          const badge = badges[s.id];
          return (
            <li key={s.id} className={collapsed ? '' : 'w-full'}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                disabled={!available}
                aria-current={current ? 'page' : undefined}
                aria-label={s.label}
                title={sectionTitle(s.label, available)}
                className={`relative flex items-center gap-2.5 rounded-md text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${collapsed ? 'h-10 w-10 justify-center' : 'h-10 w-full px-3'
                  } ${current
                    ? 'bg-brand-100 font-semibold text-brand-600'
                    : 'font-medium text-text-secondary hover:bg-surface-sunken'
                  }`}
              >
                <Glyph>{SECTION_ICONS[s.id]}</Glyph>
                {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{s.label}</span>}
                {badge && !collapsed && <Badge badge={badge} />}
                {badge && collapsed && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${DOT_TONES[badge.tone]}`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <RailActions actions={bottomActions} collapsed={collapsed} />
    </nav>
  );
}

/**
 * Below-xl section menu: a full-width dropdown under the page header. The
 * trigger names the open section (icon, label, badge) with a chevron; the
 * list shows every section with its badge, saved-only ones disabled until
 * the order is saved. A dropdown replaced the horizontally scrolling tab
 * strip because sections past the right edge were easy to miss on a phone.
 *
 * The trigger carries a dot when a section OTHER than the open one has a
 * badge, so a cancellation or balance due is still hinted at while the
 * list is closed. Closes on outside press, on Escape (returning focus to
 * the trigger), and after a pick.
 */
export function OrderSectionTabs({ active, isSaved, onSelect, badges }: SectionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = ORDER_SECTIONS.find((s) => s.id === active) ?? ORDER_SECTIONS[0];
  const currentBadge = badges[current.id];
  // Most urgent tone among the sections that are not open right now.
  const otherTones = ORDER_SECTIONS.filter((s) => s.id !== active)
    .map((s) => badges[s.id]?.tone)
    .filter((t): t is OrderSectionBadge['tone'] => Boolean(t));
  const hiddenTone = otherTones.includes('danger')
    ? 'danger'
    : otherTones.includes('warning')
      ? 'warning'
      : undefined;

  return (
    <nav aria-label="Order sections" className="border-b border-border-light bg-surface xl:hidden">
      <div className={`${PAGE_CONTAINER} py-1.5`}>
        <div ref={rootRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            className="flex h-10 w-full items-center gap-2.5 rounded-md border border-border-light bg-surface px-3 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            <span className="text-brand-600">
              <Glyph size={16}>{SECTION_ICONS[current.id]}</Glyph>
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
            {currentBadge && <Badge badge={currentBadge} />}
            {hiddenTone && (
              <span
                aria-label="Another section needs attention"
                className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONES[hiddenTone]}`}
              />
            )}
            <span className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
              <Glyph size={16}>
                <path d="m6 9 6 6 6-6" />
              </Glyph>
            </span>
          </button>
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Order sections"
              className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-light bg-surface py-1 shadow-lg"
            >
              {ORDER_SECTIONS.map((s) => {
                const available = isSectionAvailable(s.id, isSaved);
                const selected = s.id === active;
                const badge = badges[s.id];
                return (
                  <li key={s.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setOpen(false);
                        onSelect(s.id);
                      }}
                      disabled={!available}
                      title={sectionTitle(s.label, available)}
                      className={`flex h-11 w-full items-center gap-2.5 px-3 text-left text-[14px] disabled:opacity-40 ${selected
                        ? 'bg-brand-100 font-semibold text-brand-600'
                        : 'font-medium text-text-primary hover:bg-surface-sunken'
                        }`}
                    >
                      <Glyph size={16}>{SECTION_ICONS[s.id]}</Glyph>
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {badge && <Badge badge={badge} />}
                      {!available && <span className="text-[12px] font-normal text-text-muted">Save first</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}
