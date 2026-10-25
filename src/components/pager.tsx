"use client";

/**
 * The console's page stepper.
 *
 * One pager for every table in the operator console, so the control looks and
 * behaves the same wherever it appears. It owns no data: it reports the page
 * the operator asked for and lets the caller fetch it.
 *
 * It renders nothing when there is only one page — a control that can only go
 * nowhere is noise under a table that is already short.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

type PagerProps = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  /** Called with the requested page number. */
  onPage: (page: number) => void;
  /** True while the caller is fetching, so a double click cannot race. */
  busy?: boolean;
};

const formatCount = (n: number): string => n.toLocaleString("en-US");

export function Pager({ page, perPage, total, totalPages, onPage, busy = false }: PagerProps) {
  if (totalPages <= 1) return null;

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <div className="pagination">
      <span className="pagination-summary">
        {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </span>
      <div className="pagination-controls">
        <button
          className="icon-button"
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={busy || page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="page-number page-current">{page}</span>
        <button
          className="icon-button"
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={busy || page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
