'use client';

/**
 * Presentational building blocks for the fleet views.
 *
 * These are deliberately dumb: they take a bot plus callbacks and render, so the
 * roster row and the grid card can never drift out of sync with each other.
 * Interactive elements are always siblings (never nested buttons), which keeps
 * the rows keyboard- and screen-reader-friendly.
 */

import { Gem, Play, RotateCcw, Send, Square } from 'lucide-react';
import { Button, Checkbox } from '@/components/ui';
import { cn } from '@/lib/api';
import { catOf, egressLabel, formatShards, nameOf, statusOf } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/* small presentational pieces                                         */
/* ------------------------------------------------------------------ */

export function Metric({ value, label, icon: Icon, live }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="tnum text-[19px] font-semibold leading-none tracking-[-0.03em] text-white">{value}</span>
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.11em] text-white/35">
        {live ? <span className="h-1.5 w-1.5 rounded-full bg-white anim-pulse" /> : null}
        {Icon ? <Icon className="h-3 w-3 text-white/30" /> : null}
        {label}
      </span>
    </div>
  );
}

export function StatusDot({ status, className }) {
  const state = String(status || 'stopped').toLowerCase();
  return (
    <span
      title={state}
      aria-hidden="true"
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        state === 'running'
          ? 'bg-white anim-pulse shadow-[0_0_8px_rgba(255,255,255,.8)]'
          : state === 'stopped' || state === 'offline'
            ? 'bg-white/20'
            : 'bg-white/60 anim-ring',
        className
      )}
    />
  );
}

export function ShardChip({ value, running }) {
  if (value === null || value === undefined) {
    if (!running) return null;
    return (
      <span
        title="Waiting for a shards update"
        className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/30"
      >
        <Gem className="h-2.5 w-2.5 opacity-40" />--
      </span>
    );
  }
  return (
    <span
      title={`${Number(value).toLocaleString()} shards`}
      className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-white/20 bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-white"
    >
      <Gem className="h-2.5 w-2.5 text-white/70" />
      {formatShards(value)}
    </span>
  );
}

export function RowAction({ label, onClick, busy, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/45 transition-all duration-200 hover:border-white/25 hover:bg-white/[0.10] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
    >
      {busy ? <span className="anim-spin h-3 w-3 rounded-full border border-white/25 border-t-white" /> : children}
    </button>
  );
}

export function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex shrink-0 gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-0.5">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.title || option.label}
            className={cn(
              'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-[11px] font-medium transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
              active ? 'bg-white text-black' : 'text-white/45 hover:bg-white/[0.06] hover:text-white'
            )}
          >
            {option.icon ? <option.icon className="h-3.5 w-3.5" /> : null}
            {option.label ? <span>{option.label}</span> : null}
            {option.count !== undefined ? (
              <span className={cn('tnum text-[10px]', active ? 'text-black/55' : 'text-white/30')}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SkeletonRoster({ rows = 6 }) {
  return (
    <div className="space-y-1.5 p-2.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-xl border border-white/[0.05] px-2.5 py-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-white/10" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-2.5 rounded-full bg-white/[0.07]" style={{ width: `${68 - index * 6}%` }} />
            <span className="block h-2 rounded-full bg-white/[0.04]" style={{ width: `${42 - index * 4}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function FormSection({ title, hint, children }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-4">
      <div className="mb-3.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/55">{title}</h3>
        {hint ? <p className="mt-1 text-[11px] leading-relaxed text-white/30">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* roster row + fleet card                                             */
/* ------------------------------------------------------------------ */

export function RosterRow({ bot, active, checked, selectMode, compact, showOwner, busy, onOpen, onCheck, onLifecycle }) {
  const running = statusOf(bot) === 'running';
  const config = bot.config || {};
  return (
    <div
      data-bot-row={bot.id}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border px-2 transition-all duration-200',
        compact ? 'py-1' : 'py-1.5',
        active
          ? 'border-white/[0.16] bg-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,.10)]'
          : checked
            ? 'border-white/[0.12] bg-white/[0.05]'
            : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
      )}
    >
      {selectMode ? (
        <Checkbox checked={checked} onChange={(next) => onCheck(bot.id, next)} />
      ) : (
        <StatusDot status={bot.status} />
      )}

      <button
        type="button"
        onClick={() => (selectMode ? onCheck(bot.id, !checked) : onOpen(bot.id))}
        aria-current={active ? 'true' : undefined}
        className="min-w-0 flex-1 py-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px] font-medium leading-tight', active ? 'text-white' : 'text-white/85')}>
            {nameOf(bot)}
          </span>
          <ShardChip value={bot.shards} running={running} />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] text-white/35">
          {selectMode ? <StatusDot status={bot.status} className="h-1.5 w-1.5" /> : null}
          <span className="truncate">{egressLabel(bot)}</span>
          {config.host ? <span className="truncate text-white/25">· {config.host}</span> : null}
          {showOwner && bot.ownerLabel ? <span className="truncate text-white/25">· {bot.ownerLabel}</span> : null}
        </span>
      </button>

      <span className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        {running ? (
          <RowAction label={`Stop ${nameOf(bot)}`} busy={busy === 'stop'} onClick={() => onLifecycle(bot, 'stop')}>
            <Square className="h-3 w-3" />
          </RowAction>
        ) : (
          <RowAction label={`Start ${nameOf(bot)}`} busy={busy === 'start'} onClick={() => onLifecycle(bot, 'start')}>
            <Play className="h-3 w-3" />
          </RowAction>
        )}
        <RowAction
          label={`Restart ${nameOf(bot)}`}
          busy={busy === 'restart'}
          disabled={!running}
          onClick={() => onLifecycle(bot, 'restart')}
        >
          <RotateCcw className="h-3 w-3" />
        </RowAction>
      </span>
    </div>
  );
}

export function FleetCard({ bot, active, checked, selectMode, busy, onOpen, onCheck, onLifecycle, onBroadcast }) {
  const running = statusOf(bot) === 'running';
  const config = bot.config || {};
  return (
    <article
      data-bot-row={bot.id}
      className={cn(
        'panel-surface group flex flex-col !rounded-2xl p-4 transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
        active ? 'border-white/25 bg-white/[0.06]' : checked ? 'border-white/[0.14] bg-white/[0.04]' : ''
      )}
    >
      <div className="flex items-start gap-2.5">
        {selectMode ? <Checkbox checked={checked} onChange={(next) => onCheck(bot.id, next)} /> : <StatusDot status={bot.status} className="mt-1.5" />}
        <button type="button" onClick={() => onOpen(bot.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px] font-medium tracking-[-0.01em] text-white">{nameOf(bot)}</span>
          <span className="mt-1 block truncate font-mono text-[10px] text-white/35">{bot.id}</span>
        </button>
        <ShardChip value={bot.shards} running={running} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="min-w-0">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-white/30">Category</dt>
          <dd className="mt-1 truncate text-[12px] text-white/70">{catOf(bot)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-white/30">Status</dt>
          <dd className="mt-1 truncate text-[12px] text-white/70">{statusOf(bot)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-white/30">Server</dt>
          <dd className="mt-1 truncate font-mono text-[11px] text-white/60">{config.host || '--'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[9px] uppercase tracking-[0.14em] text-white/30">Egress</dt>
          <dd className="mt-1 truncate font-mono text-[11px] text-white/60">{egressLabel(bot)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-1.5 border-t border-white/[0.06] pt-3.5">
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => onOpen(bot.id)}>
          Open
        </Button>
        {running ? (
          <RowAction label="Stop bot" busy={busy === 'stop'} onClick={() => onLifecycle(bot, 'stop')}>
            <Square className="h-3 w-3" />
          </RowAction>
        ) : (
          <RowAction label="Start bot" busy={busy === 'start'} onClick={() => onLifecycle(bot, 'start')}>
            <Play className="h-3 w-3" />
          </RowAction>
        )}
        <RowAction label="Restart bot" busy={busy === 'restart'} disabled={!running} onClick={() => onLifecycle(bot, 'restart')}>
          <RotateCcw className="h-3 w-3" />
        </RowAction>
        <RowAction label="Broadcast to this bot" disabled={!running} onClick={() => onBroadcast(bot)}>
          <Send className="h-3 w-3" />
        </RowAction>
      </div>
    </article>
  );
}
