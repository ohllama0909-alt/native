'use client';

/**
 * Bots - fleet command deck.
 *
 * A compact command bar on top, then a dense roster rail beside the full
 * workspace for the selected bot. The same roster flips into a bento grid when
 * you want to eyeball the whole fleet, and the page is keyboard drivable:
 *
 *   /      focus search            j / k    move through the roster
 *   enter  open the workspace      x        check the focused bot
 *   s      start or stop it        n        new bot
 *   g      grid or split view      v        selection mode
 *   esc    leave selection mode / clear the search
 *
 * The workspace itself lives in components/bot-workspace.jsx so this page and
 * the /bots/[id] deep link render exactly the same thing, and broadcasts are
 * composed in the BroadcastModal (cmd/ctrl+K) which keeps its own draft state.
 *
 * Every request shape below matches the control service exactly:
 *   POST   /bots                     create one bot
 *   POST   /bots/batch               create up to 10 with shared defaults
 *   POST   /bots/lifecycle           start/stop/restart any id list
 *   PATCH  /bots                     bulk re-categorise
 *   DELETE /bots                     bulk delete
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Bot,
  CheckSquare,
  ChevronDown,
  FolderInput,
  Gem,
  Layers,
  LayoutGrid,
  List,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Server,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Button, Checkbox, EmptyState, Modal } from '@/components/ui';
import { ConfirmModal, ErrorNote, Field, Input } from '@/components/dash-ui';
import { BotWorkspace } from '@/components/bot-workspace';
import { BroadcastModal } from '@/components/broadcast-modal';
import { CreateBotsDialog } from '@/components/bot-create-dialog';
import {
  FleetCard,
  Metric,
  RosterRow,
  RowAction,
  SegmentedControl,
  SkeletonRoster,
} from '@/components/fleet-ui';
import { useFleet, useResource } from '@/lib/hooks';
import { api, cn } from '@/lib/api';
import { withLiveProxyUsage } from '@/lib/format';
import {
  FREE_BOT_QUOTA,
  PREFS_KEY,
  SHORTCUTS,
  SORTS,
  STATUS_FILTERS,
  UNCATEGORIZED,
  catOf,
  comparatorFor,
  formatShards,
  nameOf,
  readJSON,
  sortCategories,
  statusOf,
  writeJSON,
} from '@/lib/fleet';

export default function BotsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fleet = useFleet();
  const proxies = useResource('/proxies', (result) => result.proxies || []);
  const isAdmin = user.role === 'admin';
  const owners = useResource(isAdmin ? '/users' : null, (result) => result.users || []);
  const atBotLimit = !isAdmin && fleet.bots.length >= FREE_BOT_QUOTA;

  const searchRef = useRef(null);

  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pane, setPane] = useState('roster');

  // Persisted view preferences.
  const [view, setView] = useState('split');
  const [sort, setSort] = useState('name');
  const [grouped, setGrouped] = useState(true);
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [rowBusy, setRowBusy] = useState('');
  const [bulkBusy, setBulkBusy] = useState('');
  const [groupBusy, setGroupBusy] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveValue, setMoveValue] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveIds, setMoveIds] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);

  // Fired into the BroadcastModal: { key, botIds?, includeCategories?, useSelected? }
  const [castPreset, setCastPreset] = useState({ key: 0 });
  const firePreset = (patch = {}) => setCastPreset({ key: Date.now(), ...patch });

  // Read prefs once on mount so the server render stays deterministic.
  useEffect(() => {
    const prefs = readJSON(PREFS_KEY, null);
    if (!prefs) return;
    if (prefs.view === 'grid' || prefs.view === 'split') setView(prefs.view);
    if (SORTS.some((option) => option.value === prefs.sort)) setSort(prefs.sort);
    if (typeof prefs.grouped === 'boolean') setGrouped(prefs.grouped);
    if (typeof prefs.compact === 'boolean') setCompact(prefs.compact);
    if (Array.isArray(prefs.collapsed)) setCollapsed(new Set(prefs.collapsed));
  }, []);

  useEffect(() => {
    writeJSON(PREFS_KEY, { view, sort, grouped, compact, collapsed: [...collapsed] });
  }, [view, sort, grouped, compact, collapsed]);

  const checkedIds = useMemo(() => [...checked], [checked]);
  const runningTotal = fleet.bots.filter((bot) => statusOf(bot) === 'running').length;
  const totalShards = fleet.bots.reduce((sum, bot) => sum + (Number(bot.shards) || 0), 0);

  /** Every category in the fleet, for the rail and the suggestions list. */
  const allCategories = useMemo(() => {
    const buckets = new Map();
    for (const bot of fleet.bots) {
      const name = catOf(bot);
      if (!buckets.has(name)) buckets.set(name, { name, total: 0, running: 0 });
      const row = buckets.get(name);
      row.total += 1;
      if (statusOf(bot) === 'running') row.running += 1;
    }
    return [...buckets.values()].sort(sortCategories);
  }, [fleet.bots]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const compare = comparatorFor(sort);
    return fleet.bots
      .filter((bot) => {
        const config = bot.config || {};
        const running = statusOf(bot) === 'running';
        if (statusFilter === 'running' && !running) return false;
        if (statusFilter === 'stopped' && running) return false;
        if (categoryFilter !== 'all' && catOf(bot) !== categoryFilter) return false;
        if (!term) return true;
        return [bot.id, config.username, config.category, config.host, bot.ownerLabel]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term));
      })
      .sort(compare);
  }, [fleet.bots, search, statusFilter, categoryFilter, sort]);

  /** Roster sections: category buckets when grouping is on, one flat list otherwise. */
  const sections = useMemo(() => {
    if (!grouped) {
      return [{ name: '', bots: visible, running: visible.filter((bot) => statusOf(bot) === 'running').length }];
    }
    const buckets = new Map();
    for (const bot of visible) {
      const name = catOf(bot);
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(bot);
    }
    return [...buckets.entries()]
      .map(([name, bots]) => ({ name, bots, running: bots.filter((bot) => statusOf(bot) === 'running').length }))
      .sort(sortCategories);
  }, [visible, grouped]);

  /** Display order of anything reachable right now - powers J/K navigation. */
  const orderedIds = useMemo(
    () => sections.flatMap((section) => (section.name && collapsed.has(section.name) ? [] : section.bots.map((bot) => bot.id))),
    [sections, collapsed]
  );

  // Keep a valid selection: adopt the first visible bot, and move on if the
  // selected one is filtered away or removed by a stream event.
  useEffect(() => {
    if (!visible.length) {
      if (selected) setSelected('');
      return;
    }
    if (!visible.some((bot) => bot.id === selected)) setSelected(visible[0].id);
  }, [visible, selected]);

  const openBot = (id) => {
    setSelected(id);
    setPane('workspace');
    if (view === 'grid') setView('split');
  };

  const toggleCheck = (id, force) =>
    setChecked((current) => {
      const next = new Set(current);
      const shouldCheck = typeof force === 'boolean' ? force : !next.has(id);
      if (shouldCheck) next.add(id);
      else next.delete(id);
      return next;
    });

  const setManyChecked = (bots, force) =>
    setChecked((current) => {
      const next = new Set(current);
      const allChecked = bots.length > 0 && bots.every((bot) => current.has(bot.id));
      const shouldCheck = typeof force === 'boolean' ? force : !allChecked;
      bots.forEach((bot) => (shouldCheck ? next.add(bot.id) : next.delete(bot.id)));
      return next;
    });

  const toggleGroup = (name) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setChecked(new Set());
  };

  /* ---------- lifecycle ---------- */

  const pastTense = (action) => (action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarting');

  const report = (action, result, scope) => {
    const ok = result.okCount ?? 0;
    const skipped = result.skippedCount ?? 0;
    const failed = result.failedCount ?? 0;
    const where = scope ? ` in ${scope}` : '';
    if (failed) toast(`${ok} ${pastTense(action)}${where} · ${failed} failed`, 'warning');
    else if (!ok && skipped) toast(`Nothing to ${action}${where} - already ${action === 'stop' ? 'stopped' : 'running'}`, 'info');
    else toast(`${ok} ${pastTense(action)}${where}`, 'success');
  };

  /** One request drives every lifecycle path: a row, a category, or a selection. */
  const runLifecycle = async (ids, action, { scope = '', setBusy, busyKey } = {}) => {
    if (!ids.length) return;
    setBusy?.(busyKey);
    try {
      const result = await api('/bots/lifecycle', { method: 'POST', body: JSON.stringify({ ids, action }) });
      report(action, result, scope);
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusy?.('');
    }
  };

  const rowLifecycle = (bot, action) =>
    runLifecycle([bot.id], action, { scope: nameOf(bot), setBusy: setRowBusy, busyKey: `${bot.id}:${action}` });

  const groupLifecycle = (section, action) =>
    runLifecycle(
      section.bots.map((bot) => bot.id),
      action,
      { scope: section.name || 'the roster', setBusy: setGroupBusy, busyKey: `${section.name}:${action}` }
    );

  const bulkLifecycle = (action) => runLifecycle(checkedIds, action, { setBusy: setBulkBusy, busyKey: action });

  const bulkDelete = async () => {
    if (!checkedIds.length) return;
    setDeleting(true);
    try {
      const result = await api('/bots', { method: 'DELETE', body: JSON.stringify({ ids: checkedIds }) });
      const count = result.removed ?? checkedIds.length;
      toast(`Deleted ${count} bot${count === 1 ? '' : 's'}`, 'success');
      if (checkedIds.includes(selected)) setSelected('');
      setDeleteOpen(false);
      exitSelectMode();
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const openMove = (ids = null, initial = '') => {
    setMoveIds(ids);
    setMoveValue(initial);
    setMoveOpen(true);
  };

  const moveCategory = async () => {
    const ids = moveIds || checkedIds;
    if (!ids.length) return;
    setMoveBusy(true);
    try {
      const result = await api('/bots', {
        method: 'PATCH',
        body: JSON.stringify({ ids, category: moveValue.trim() || UNCATEGORIZED }),
      });
      toast(`${result.updated} bot${result.updated === 1 ? '' : 's'} moved to \u201c${result.category}\u201d`, 'success');
      setMoveOpen(false);
      setMoveIds(null);
      setMoveValue('');
      setChecked(new Set());
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setMoveBusy(false);
    }
  };

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        if (selectMode) exitSelectMode();
        else if (search) setSearch('');
        return;
      }
      if (key === 'n' && !atBotLimit) {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }
      if (key === 'g') {
        event.preventDefault();
        setView((current) => (current === 'grid' ? 'split' : 'grid'));
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        setSelectMode((current) => {
          if (current) setChecked(new Set());
          return !current;
        });
        return;
      }
      if (!orderedIds.length) return;

      if (key === 'j' || event.key === 'ArrowDown' || key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = key === 'j' || event.key === 'ArrowDown' ? 1 : -1;
        const at = orderedIds.indexOf(selected);
        const next = orderedIds[(Math.max(0, at) + step + orderedIds.length) % orderedIds.length];
        setSelected(next);
        document.querySelector(`[data-bot-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (key === 'x' && selected) {
        event.preventDefault();
        setSelectMode(true);
        toggleCheck(selected);
        return;
      }
      if (key === 's' && selected) {
        event.preventDefault();
        const bot = fleet.bots.find((entry) => entry.id === selected);
        if (bot) rowLifecycle(bot, statusOf(bot) === 'running' ? 'stop' : 'start');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds, selected, selectMode, search, atBotLimit, fleet.bots]);

  /* ---------- derived for the create dialog ---------- */

  const proxyOptions = useMemo(
    () => withLiveProxyUsage(proxies.data || [], fleet.bots, !fleet.loading),
    [proxies.data, fleet.bots, fleet.loading]
  );

  const poolSummary = useMemo(() => {
    const rows = proxyOptions || [];
    return { total: rows.length, free: rows.reduce((sum, proxy) => sum + (Number(proxy.freeSlots) || 0), 0) };
  }, [proxyOptions]);

  const moveCount = (moveIds || checkedIds).length;
  const allVisibleChecked = visible.length > 0 && visible.every((bot) => checked.has(bot.id));
  const selectedBot = fleet.bots.find((bot) => bot.id === selected);

  /* ---------- roster ---------- */

  const rosterBody = (
    <>
      {fleet.loading && !fleet.bots.length ? <SkeletonRoster /> : null}

      {!fleet.loading && !visible.length ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[13px] text-white/45">{fleet.bots.length ? 'No bots match these filters.' : 'No bots yet.'}</p>
          {fleet.bots.length ? (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setCategoryFilter('all');
              }}
              className="mt-3 text-[12px] text-white/40 underline transition hover:text-white"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {sections.map((section) => {
        const isCollapsed = !!section.name && collapsed.has(section.name);
        const groupChecked = section.bots.length > 0 && section.bots.every((bot) => checked.has(bot.id));
        return (
          <section key={section.name || 'all'} className="mb-1">
            {section.name ? (
              <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition hover:bg-white/[0.025]">
                {selectMode ? (
                  <span className="mr-1 shrink-0">
                    <Checkbox checked={groupChecked} onChange={(next) => setManyChecked(section.bots, next)} />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleGroup(section.name)}
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                >
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 text-white/30 transition-transform duration-300', isCollapsed && '-rotate-90')}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                    {section.name}
                  </span>
                  <span className="tnum shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/40">
                    {section.running}/{section.bots.length}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <RowAction
                    label={`Broadcast to ${section.name}`}
                    disabled={!section.running}
                    onClick={() => firePreset({ includeCategories: [section.name] })}
                  >
                    <Send className="h-3 w-3" />
                  </RowAction>
                  <RowAction label={`Move everything in ${section.name}`} onClick={() => openMove(section.bots.map((bot) => bot.id))}>
                    <FolderInput className="h-3 w-3" />
                  </RowAction>
                  <RowAction
                    label={`Start all in ${section.name}`}
                    busy={groupBusy === `${section.name}:start`}
                    onClick={() => groupLifecycle(section, 'start')}
                  >
                    <Play className="h-3 w-3" />
                  </RowAction>
                  <RowAction
                    label={`Stop all in ${section.name}`}
                    busy={groupBusy === `${section.name}:stop`}
                    onClick={() => groupLifecycle(section, 'stop')}
                  >
                    <Square className="h-3 w-3" />
                  </RowAction>
                </span>
              </div>
            ) : null}

            {isCollapsed ? null : (
              <ul className="space-y-0.5">
                {section.bots.map((bot) => (
                  <li key={bot.id}>
                    <RosterRow
                      bot={bot}
                      active={bot.id === selected}
                      checked={checked.has(bot.id)}
                      selectMode={selectMode}
                      compact={compact}
                      showOwner={isAdmin}
                      busy={rowBusy.startsWith(`${bot.id}:`) ? rowBusy.split(':')[1] : ''}
                      onOpen={openBot}
                      onCheck={toggleCheck}
                      onLifecycle={rowLifecycle}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );

  return (
    <div className="space-y-4">
      {/* ---------- command bar ---------- */}
      <header className="anim-rise panel-surface relative overflow-hidden !rounded-[22px]">
        <span className="spotlight pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-6">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', fleet.live ? 'bg-white anim-pulse' : 'bg-white/25')} />
              Fleet command · {fleet.live ? 'streaming' : 'stream offline'}
            </p>
            <h1 className="display mt-2.5 text-[27px] text-white sm:text-[32px]">Bots</h1>
            <dl className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3">
              <Metric value={`${fleet.bots.length}${isAdmin ? '' : `/${FREE_BOT_QUOTA}`}`} label="registered" />
              <Metric value={runningTotal} label="live" live={runningTotal > 0} />
              <Metric value={fleet.bots.length - runningTotal} label="offline" />
              <Metric value={allCategories.length} label="categories" icon={Layers} />
              {totalShards > 0 ? <Metric value={formatShards(totalShards)} label="shards" icon={Gem} /> : null}
            </dl>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button variant="secondary" onClick={() => firePreset({})} disabled={!runningTotal} title="Open the broadcast composer">
              <Send className="h-3.5 w-3.5" />
              Broadcast
              {fleet.activeJob && fleet.activeJob.status === 'running' && fleet.activeJob.total ? (
                <span className="tnum text-[11px] text-white/55">
                  {fleet.activeJob.done || 0}/{fleet.activeJob.total}
                </span>
              ) : (
                <kbd className="kbd hidden sm:inline-block">{'\u2318K'}</kbd>
              )}
            </Button>
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              disabled={atBotLimit}
              title={atBotLimit ? `Account limit reached: maximum ${FREE_BOT_QUOTA} bots` : 'Create a new bot'}
            >
              <Plus className="h-3.5 w-3.5" />
              New bot{isAdmin ? '' : ` (${fleet.bots.length}/${FREE_BOT_QUOTA})`}
            </Button>
          </div>
        </div>
      </header>

      {fleet.error ? <ErrorNote>{fleet.error}</ErrorNote> : null}

      {/* ---------- category rail ---------- */}
      {allCategories.length > 1 ? (
        <div className="anim-rise no-scrollbar flex gap-2 overflow-x-auto pb-1" style={{ animationDelay: '60ms' }}>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            aria-pressed={categoryFilter === 'all'}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-xs font-medium transition-all duration-200',
              categoryFilter === 'all'
                ? 'border-white bg-white text-black'
                : 'border-white/[0.09] bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
            )}
          >
            All
            <span
              className={cn(
                'tnum rounded-full px-1.5 py-0.5 text-[10px]',
                categoryFilter === 'all' ? 'bg-black/10 text-black/70' : 'bg-white/[0.06] text-white/45'
              )}
            >
              {fleet.bots.length}
            </span>
          </button>
          {allCategories.map((cat) => {
            const active = categoryFilter === cat.name;
            return (
              <div
                key={cat.name}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-2xl border transition-all duration-200',
                  active
                    ? 'border-white bg-white text-black'
                    : 'border-white/[0.09] bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white'
                )}
              >
                <button
                  type="button"
                  onClick={() => setCategoryFilter(active ? 'all' : cat.name)}
                  aria-pressed={active}
                  title={active ? 'Show every category' : `Filter to ${cat.name}`}
                  className="flex min-h-9 min-w-0 items-center gap-2 pl-3.5 pr-1 text-xs font-medium"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      cat.running ? (active ? 'bg-black anim-pulse' : 'bg-white anim-pulse') : active ? 'bg-black/30' : 'bg-white/20'
                    )}
                  />
                  <span className="max-w-[150px] truncate">{cat.name}</span>
                  <span
                    className={cn('tnum rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-black/10 text-black/70' : 'bg-white/[0.06] text-white/45')}
                  >
                    {cat.running}/{cat.total}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => firePreset({ includeCategories: [cat.name] })}
                  disabled={!cat.running}
                  title={`Broadcast to ${cat.name}`}
                  aria-label={`Broadcast to ${cat.name}`}
                  className={cn(
                    'mr-1 rounded-xl p-2 transition disabled:opacity-25',
                    active ? 'text-black/50 hover:bg-black/10 hover:text-black' : 'text-white/30 hover:bg-white/[0.08] hover:text-white'
                  )}
                >
                  <Send className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ---------- toolbar ---------- */}
      <div className="panel-surface anim-rise flex flex-wrap items-center gap-2 !rounded-2xl p-2" style={{ animationDelay: '90ms' }}>
        <div className="group relative flex h-9 min-w-[12rem] flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-white/35 transition-colors group-focus-within:text-white/75" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setSearch('');
                event.currentTarget.blur();
              }
            }}
            placeholder="Search bots, categories, hosts..."
            aria-label="Search the fleet"
            className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] pl-9 pr-16 text-[13px] text-white placeholder:text-white/30 transition-all duration-200 hover:border-white/15 focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-white/[0.06]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 rounded-md p-1 text-white/40 transition hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="kbd pointer-events-none absolute right-2.5 hidden sm:block">/</kbd>
          )}
        </div>

        <SegmentedControl
          ariaLabel="Filter by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTERS.map((option) => ({
            ...option,
            count:
              option.value === 'all' ? fleet.bots.length : option.value === 'running' ? runningTotal : fleet.bots.length - runningTotal,
          }))}
        />

        <label className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] pl-2.5 pr-1 text-[11px] text-white/45">
          <ArrowUpDown className="h-3.5 w-3.5 text-white/35" />
          <span className="sr-only">Sort roster</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-8 cursor-pointer appearance-none rounded-lg bg-transparent pr-1 text-[11px] font-medium text-white/75 focus:outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value} className="bg-[#0d0d0d] text-white">
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <SegmentedControl
          ariaLabel="Roster layout"
          value={view}
          onChange={setView}
          options={[
            { value: 'split', icon: List, title: 'Split view - roster and workspace' },
            { value: 'grid', icon: LayoutGrid, title: 'Grid view - the whole fleet' },
          ]}
        />

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setGrouped((current) => !current)}
            aria-pressed={grouped}
            title={grouped ? 'Stop grouping by category' : 'Group by category'}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium transition',
              grouped
                ? 'border-white/25 bg-white/[0.10] text-white'
                : 'border-white/[0.08] bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white'
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Grouped</span>
          </button>
          <button
            type="button"
            onClick={() => setCompact((current) => !current)}
            aria-pressed={compact}
            title={compact ? 'Comfortable rows' : 'Compact rows'}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium transition',
              compact
                ? 'border-white/25 bg-white/[0.10] text-white'
                : 'border-white/[0.08] bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white'
            )}
          >
            <Server className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Dense</span>
          </button>
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            title={selectMode ? 'Exit selection mode' : 'Select multiple bots'}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium transition',
              selectMode
                ? 'border-white bg-white text-black'
                : 'border-white/[0.08] bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white'
            )}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {selectMode ? 'Done' : 'Select'}
          </button>
        </div>
      </div>

      {/* ---------- bulk action bar ---------- */}
      {selectMode ? (
        <div className="anim-rise glass-hi flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
          <span className="mr-1 flex items-center gap-2 text-[12px] font-medium text-white">
            <span className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">
              {checked.size}
            </span>
            selected
          </span>
          <button
            type="button"
            onClick={() => setManyChecked(visible, !allVisibleChecked)}
            disabled={!visible.length}
            className="rounded-lg px-2 py-1 text-[11px] text-white/50 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-30"
          >
            {allVisibleChecked ? 'Deselect' : 'Select'} all visible ({visible.length})
          </button>
          {checked.size ? (
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="rounded-lg px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/[0.07] hover:text-white"
            >
              Clear
            </button>
          ) : null}

          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" loading={bulkBusy === 'start'} disabled={!checked.size} onClick={() => bulkLifecycle('start')}>
              <Play className="h-3 w-3" />
              Start
            </Button>
            <Button size="sm" variant="secondary" loading={bulkBusy === 'stop'} disabled={!checked.size} onClick={() => bulkLifecycle('stop')}>
              <Square className="h-3 w-3" />
              Stop
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={bulkBusy === 'restart'}
              disabled={!checked.size}
              onClick={() => bulkLifecycle('restart')}
            >
              <RotateCcw className="h-3 w-3" />
              Restart
            </Button>
            <Button size="sm" variant="secondary" disabled={!checked.size} onClick={() => openMove()}>
              <FolderInput className="h-3 w-3" />
              Category
            </Button>
            <Button size="sm" variant="secondary" disabled={!checked.size} onClick={() => firePreset({ useSelected: true })}>
              <Send className="h-3 w-3" />
              Cast
            </Button>
            <Button size="sm" variant="danger" disabled={!checked.size} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </span>
        </div>
      ) : null}

      {/* ---------- grid view ---------- */}
      {view === 'grid' ? (
        <div className="space-y-4">
          {fleet.loading && !fleet.bots.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="panel-surface !rounded-2xl p-4" aria-hidden="true">
                  <div className="h-3 w-1/2 rounded-full bg-white/[0.07]" />
                  <div className="mt-2.5 h-2.5 w-1/3 rounded-full bg-white/[0.04]" />
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <div className="h-2.5 rounded-full bg-white/[0.05]" />
                    <div className="h-2.5 rounded-full bg-white/[0.05]" />
                    <div className="h-2.5 rounded-full bg-white/[0.05]" />
                    <div className="h-2.5 rounded-full bg-white/[0.05]" />
                  </div>
                  <div className="mt-6 h-8 rounded-xl bg-white/[0.04]" />
                </div>
              ))}
            </div>
          ) : null}

          {sections.map((section) => (
            <section key={section.name || 'all'}>
              {section.name ? (
                <div className="mb-2.5 flex items-center gap-2.5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{section.name}</h2>
                  <span className="tnum rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/40">
                    {section.running}/{section.bots.length}
                  </span>
                  <span className="h-px flex-1 bg-white/[0.07]" />
                  <RowAction
                    label={`Broadcast to ${section.name}`}
                    disabled={!section.running}
                    onClick={() => firePreset({ includeCategories: [section.name] })}
                  >
                    <Send className="h-3 w-3" />
                  </RowAction>
                  <RowAction
                    label={`Start all in ${section.name}`}
                    busy={groupBusy === `${section.name}:start`}
                    onClick={() => groupLifecycle(section, 'start')}
                  >
                    <Play className="h-3 w-3" />
                  </RowAction>
                  <RowAction
                    label={`Stop all in ${section.name}`}
                    busy={groupBusy === `${section.name}:stop`}
                    onClick={() => groupLifecycle(section, 'stop')}
                  >
                    <Square className="h-3 w-3" />
                  </RowAction>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.bots.map((bot) => (
                  <FleetCard
                    key={bot.id}
                    bot={bot}
                    active={bot.id === selected}
                    checked={checked.has(bot.id)}
                    selectMode={selectMode}
                    busy={rowBusy.startsWith(`${bot.id}:`) ? rowBusy.split(':')[1] : ''}
                    onOpen={openBot}
                    onCheck={toggleCheck}
                    onLifecycle={rowLifecycle}
                    onBroadcast={(target) => firePreset({ botIds: [target.id] })}
                  />
                ))}
              </div>
            </section>
          ))}

          {!fleet.loading && !visible.length ? (
            <div className="panel-surface !rounded-2xl">
              <EmptyState
                icon={<Bot className="h-5 w-5" />}
                title={fleet.bots.length ? 'Nothing matches' : 'No bots yet'}
                description={
                  fleet.bots.length
                    ? 'Loosen the filters or clear the search to bring the roster back.'
                    : 'Create your first bot to get a console, inventory view, and module controls.'
                }
                action={
                  fleet.bots.length ? null : (
                    <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={atBotLimit}>
                      <Plus className="h-3.5 w-3.5" />
                      New bot
                    </Button>
                  )
                }
              />
            </div>
          ) : null}
        </div>
      ) : (
        /* ---------- split view ---------- */
        <div className="grid items-start gap-4 md:grid-cols-[19rem_minmax(0,1fr)] lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[23rem_minmax(0,1fr)]">
          {/* mobile pane switcher */}
          <div className="col-span-full flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 md:hidden">
            <button
              type="button"
              onClick={() => setPane('roster')}
              aria-pressed={pane === 'roster'}
              className={cn(
                'flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg text-xs font-medium transition',
                pane === 'roster' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
              )}
            >
              <List className="h-3.5 w-3.5" />
              Roster ({visible.length})
            </button>
            <button
              type="button"
              onClick={() => setPane('workspace')}
              aria-pressed={pane === 'workspace'}
              className={cn(
                'flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium transition',
                pane === 'workspace' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
              )}
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selectedBot ? nameOf(selectedBot) : 'Workspace'}</span>
            </button>
          </div>

          {/* roster rail */}
          <aside
            className={cn(
              'panel-surface flex min-h-0 flex-col overflow-hidden !rounded-[20px] md:sticky md:top-[calc(var(--header-h)+1rem)] md:max-h-[calc(100vh-var(--header-h)-2.5rem)]',
              pane !== 'roster' && 'hidden md:flex'
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Roster</span>
              <span className="flex items-center gap-2">
                {categoryFilter !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('all')}
                    title="Clear the category filter"
                    className="inline-flex max-w-[9rem] items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/70 transition hover:border-white/25 hover:text-white"
                  >
                    <span className="truncate">{categoryFilter}</span>
                    <X className="h-3 w-3 shrink-0" />
                  </button>
                ) : null}
                <span
                  title={isAdmin ? `${fleet.bots.length} bots registered` : `${fleet.bots.length} of ${FREE_BOT_QUOTA} bots used`}
                  className={cn(
                    'tnum rounded-full px-2 py-0.5 text-[10px] font-medium',
                    atBotLimit ? 'border border-white/25 bg-white/[0.08] text-white' : 'bg-white/[0.07] text-white/50'
                  )}
                >
                  {visible.length}
                  {visible.length !== fleet.bots.length ? ` / ${fleet.bots.length}` : ''}
                </span>
              </span>
            </div>

            <div className="console-scrollbar min-h-0 flex-1 overflow-y-auto p-2">{rosterBody}</div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                <span className={cn('h-1.5 w-1.5 rounded-full', runningTotal ? 'bg-white anim-pulse' : 'bg-white/25')} />
                <span className="tnum font-medium text-white/70">{runningTotal}</span> live
              </span>
              <span className="hidden flex-wrap items-center justify-end gap-x-2 gap-y-1 lg:flex">
                {SHORTCUTS.map(([keys, label]) => (
                  <span key={label} className="flex items-center gap-1 text-[10px] text-white/25">
                    <kbd className="kbd">{keys}</kbd>
                    {label}
                  </span>
                ))}
              </span>
            </div>
          </aside>

          {/* workspace */}
          <div className={cn('min-w-0', pane !== 'workspace' && 'hidden md:block')}>
            {selected ? (
              <BotWorkspace
                key={selected}
                botId={selected}
                fleetBots={fleet.bots}
                fleetLoading={fleet.loading}
                onDeleted={() => {
                  setSelected('');
                  fleet.reload();
                }}
              />
            ) : (
              <div className="panel-surface !rounded-2xl px-6 py-14">
                <EmptyState
                  icon={<Bot className="h-5 w-5" />}
                  title={fleet.bots.length ? 'Select a bot' : 'No bots yet'}
                  description={
                    fleet.bots.length
                      ? 'Pick a bot from the roster to open its console, configuration, inventory, modules, and scripts.'
                      : 'Create your first bot to get a console, inventory view, and module controls.'
                  }
                  action={
                    fleet.bots.length ? null : (
                      <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={atBotLimit}>
                        <Plus className="h-3.5 w-3.5" />
                        New bot
                      </Button>
                    )
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Broadcast composer stays mounted so drafts survive closing. */}
      <BroadcastModal bots={fleet.bots} activeJob={fleet.activeJob} selectedIds={checkedIds} preset={castPreset} />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={bulkDelete}
        loading={deleting}
        title={`Delete ${checked.size} bot${checked.size === 1 ? '' : 's'}`}
        confirmLabel={`Delete ${checked.size} bot${checked.size === 1 ? '' : 's'}`}
        description={`They will be stopped, removed from the roster, and their data directories deleted. This cannot be undone.`}
      />

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${moveCount} bot${moveCount === 1 ? '' : 's'}`}
        description="Pick an existing category or type a new one. The roster regroups instantly."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button loading={moveBusy} disabled={!moveCount} onClick={moveCategory}>
              <FolderInput className="h-3.5 w-3.5" />
              Move{moveCount ? ` (${moveCount})` : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Category" hint="Leave blank for Uncategorized. 48 characters max.">
            <Input
              value={moveValue}
              onChange={(event) => setMoveValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  moveCategory();
                }
              }}
              placeholder={UNCATEGORIZED}
              maxLength={48}
              list="nativelaunch-category-options"
              autoFocus
            />
          </Field>
          {allCategories.length ? (
            <div>
              <span className="field-label">Existing categories</span>
              <div className="flex flex-wrap gap-1.5">
                {allCategories.map((cat) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setMoveValue(cat.name)}
                    className={cn(
                      'inline-flex min-h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium transition',
                      moveValue === cat.name
                        ? 'border-white bg-white text-black'
                        : 'border-white/[0.10] bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white'
                    )}
                  >
                    <span className="max-w-[140px] truncate">{cat.name}</span>
                    <span className={cn('tnum text-[10px]', moveValue === cat.name ? 'text-black/55' : 'text-white/30')}>{cat.total}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <CreateBotsDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fleetBots={fleet.bots}
        isAdmin={isAdmin}
        userEmail={user.email}
        owners={owners.data}
        proxyOptions={proxyOptions}
        poolSummary={poolSummary}
        categories={allCategories}
        onCreated={(id) => {
          fleet.reload();
          if (id) {
            setSelected(id);
            setPane('workspace');
          }
        }}
      />
    </div>
  );
}
