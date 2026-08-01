// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * The section container of the redesign, and the reason sections are
 * recognizable at a glance.
 *
 * A card is a white 16px-radius panel on the tinted page, carrying both
 * a soft two-layer shadow and a hairline border. The border is not
 * redundant: the app is used on phones outdoors, where a shadow alone
 * can disappear in daylight on a low-contrast screen.
 *
 * `CardHeader` optionally renders a hued icon badge. The accent is the
 * page's fastest identity signal — a user should know which section
 * they are looking at before reading the title — so accents follow the
 * semantic rule in `lib/statusStyles`: brand=customer/info,
 * scheduled=installation and appointments, success/warning=payment by
 * state, neutral=structural content such as line items.
 *
 * Composition is deliberate rather than prop-driven: header, body and
 * footer are separate exports so a page can omit the header, or put a
 * table flush against the card edge by passing `flush` to the body.
 */

import type { ReactNode } from 'react';

/** Semantic accent for a card's icon badge. Mirrors `PillTone`. */
export type CardAccent =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'scheduled'
  | 'neutral';

/** Icon-badge tint + ink per accent. */
const ACCENTS: Record<CardAccent, string> = {
  brand: 'bg-info-tint text-info',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  scheduled: 'bg-scheduled-tint text-scheduled',
  neutral: 'bg-surface-sunken text-text-secondary',
};

/**
 * White panel on the tinted page. `className` is appended, not merged —
 * pass layout utilities (grid span, margin) only; do not override the
 * surface, radius or shadow, which are the card's identity.
 */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border-light bg-surface shadow-md ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * Card title row: optional hued icon badge, title, optional subtitle
 * beneath, and an optional right slot for a status chip or action. The
 * right slot never shrinks; the title truncates instead, so a long
 * customer name cannot push a status pill off-screen on a phone.
 *
 * `icon` receives an SVG sized 18×18 with `stroke="currentColor"` — the
 * badge supplies the colour.
 */
export function CardHeader({
  title,
  subtitle,
  icon,
  accent = 'neutral',
  right,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  accent?: CardAccent;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border-light px-4 py-3.5">
      {icon && (
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${ACCENTS[accent]}`}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[17px] font-bold leading-6 text-text-primary">
          {title}
        </h2>
        {subtitle && (
          <p className="truncate text-[13px] leading-[18px] text-text-muted">{subtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

/**
 * Padded content region. Pass `flush` for content that should meet the
 * card edge — tables, full-bleed row lists — which then supply their
 * own row padding.
 */
export function CardBody({
  children,
  flush = false,
  className = '',
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return <div className={`${flush ? '' : 'px-4 py-4'} ${className}`}>{children}</div>;
}

/**
 * Action row pinned to the bottom of a card, separated by a hairline
 * and sitting on the sunken surface so it reads as chrome rather than
 * content.
 */
export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex items-center justify-end gap-2 rounded-b-xl border-t border-border-light bg-surface-sunken px-4 py-3">
      {children}
    </footer>
  );
}
