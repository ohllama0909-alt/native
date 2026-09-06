'use client';

/**
 * Bot creation - single or bulk.
 *
 * Both modes build the exact same config object; bulk sends it once as
 * `defaults` to POST /bots/batch so a whole batch lands on the same server,
 * category, and modules with proxies spread automatically. Rolled usernames are
 * verified unregistered and reserved server-side as they appear.
 */

import { useEffect, useMemo, useState } from 'react';
import { Dices, Minus, Plus, Sparkles } from 'lucide-react';
import { useToast } from '@/components/providers';
import { Button, Checkbox, Modal } from '@/components/ui';
import { ErrorNote, Field, Input, Select } from '@/components/dash-ui';
import { FormSection, SegmentedControl } from '@/components/fleet-ui';
import { api, cn } from '@/lib/api';
import {
  BATCH_MAX,
  BLANK_BOT,
  BOT_ID,
  FREE_BOT_QUOTA,
  LAST_BOT_CONFIG_KEY,
  MINECRAFT_USERNAME,
  UNCATEGORIZED,
  getNextBotId,
  loadLastBotConfig,
  nameOf,
  saveLastBotConfig,
} from '@/lib/fleet';

function newBulkRow(username = '', inspiredBy = '') {
  return { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, username, inspiredBy };
}

/**
 * Single or bulk creation.
 *
 * Bulk rolls N verified-unregistered names and posts them to /bots/batch with
 * one shared defaults object, so the whole batch lands on the same server,
 * category, and module configuration with proxies spread automatically.
 */
export function CreateBotsDialog({ open, onClose, fleetBots, isAdmin, userEmail, owners, proxyOptions, poolSummary, categories, onCreated }) {
  const { toast } = useToast();
  const [form, setForm] = useState(BLANK_BOT);
  const [mode, setMode] = useState('single');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rerolling, setRerolling] = useState('');
  const [usernameMeta, setUsernameMeta] = useState(null);
  const [restored, setRestored] = useState(false);

  const atLimit = !isAdmin && fleetBots.length >= FREE_BOT_QUOTA;
  const maxBulk = isAdmin ? BATCH_MAX : Math.max(1, Math.min(BATCH_MAX, FREE_BOT_QUOTA - fleetBots.length));
  const bulkAllowed = !atLimit && maxBulk > 1;

  // Re-seed from the last created bot every time the dialog opens, so ids keep
  // counting up and the operator does not retype the same server details.
  useEffect(() => {
    if (!open) return;
    const saved = loadLastBotConfig();
    const nextId = getNextBotId(fleetBots, saved && saved.lastId);
    setForm(
      saved
        ? { ...BLANK_BOT, ...saved, id: nextId, username: '', proxyId: saved.proxyId ?? 'auto' }
        : { ...BLANK_BOT, id: nextId }
    );
    setRestored(!!saved);
    setMode('single');
    setRows(Array.from({ length: Math.max(1, Math.min(5, maxBulk)) }, () => newBulkRow()));
    setError('');
    setBusy('');
    setRerolling('');
    setUsernameMeta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (changes) => setForm((current) => ({ ...current, ...changes }));

  const syncRows = (count) => {
    const size = Math.max(1, Math.min(maxBulk, count));
    setRows((current) => {
      if (current.length === size) return current;
      if (current.length > size) return current.slice(0, size);
      return [...current, ...Array.from({ length: size - current.length }, () => newBulkRow())];
    });
  };

  /** Per-row validation: format, fleet collisions, and in-batch duplicates. */
  const issues = useMemo(() => {
    const taken = new Set((fleetBots || []).map((bot) => String(nameOf(bot)).toLowerCase()));
    const seen = new Set();
    return rows.map((row) => {
      const name = row.username.trim();
      if (!name) return 'Empty - roll a name or type one in';
      if (!MINECRAFT_USERNAME.test(name)) return 'Use 3-16 letters, numbers, or underscores';
      const lower = name.toLowerCase();
      if (taken.has(lower)) return 'Already used by another bot';
      if (seen.has(lower)) return 'Duplicate name in this batch';
      seen.add(lower);
      return '';
    });
  }, [rows, fleetBots]);
  const bulkValid = rows.length > 0 && rows.length <= maxBulk && issues.every((issue) => !issue);

  /** Shared payload for both modes. Bulk sends it as `defaults`. */
  const buildConfig = () => {
    const payload = {
      category: form.category.trim() || UNCATEGORIZED,
      host: form.host.trim() || BLANK_BOT.host,
      port: Number(form.port) || 25565,
      version: form.version.trim() || BLANK_BOT.version,
      auth: form.auth,
      autoReconnect: form.autoReconnect,
      reconnectDelay: Math.round((Number(form.reconnectDelaySec) || 5) * 1000),
      afkMode: form.afkMode,
      autoRegister: form.autoRegister,
      autoLogin: form.autoLogin,
      webhookUrl: form.webhookUrl.trim(),
      discord: {
        enabled: form.discordEnabled,
        token: form.discordToken.trim(),
        guildId: form.discordGuildId.trim(),
      },
      boneCollector: {
        collectSlot: Number(form.collectSlot) || 13,
        cycleDelay: Math.round((Number(form.cycleDelaySec) || 15) * 1000),
      },
    };
    if (form.proxyId === 'auto') payload.autoProxy = true;
    else if (form.proxyId) payload.proxyId = form.proxyId;
    if (form.loginPassword) payload.loginPassword = form.loginPassword;
    if (isAdmin && form.ownerId) payload.ownerId = form.ownerId;
    return payload;
  };

  const createOne = async () => {
    if (atLimit) {
      setError(`Bot limit reached: standard accounts can have a maximum of ${FREE_BOT_QUOTA} bots.`);
      return;
    }
    const saved = loadLastBotConfig();
    const id = form.id.trim() || getNextBotId(fleetBots, saved && saved.lastId);
    if (!BOT_ID.test(id)) {
      setError('Bot ID must be 1-24 characters: letters, numbers, hyphen, or underscore.');
      return;
    }
    const username = form.username.trim() || id;
    if (!MINECRAFT_USERNAME.test(username)) {
      setError('Minecraft username must be 3-16 letters, numbers, or underscores.');
      return;
    }

    setBusy('single');
    setError('');
    try {
      const result = await api('/bots', { method: 'POST', body: JSON.stringify({ id, username, ...buildConfig() }) });
      saveLastBotConfig(form, id);
      const via = result && result.assignedProxy ? ` on ${result.assignedProxy.label}` : '';
      if (form.startOnCreate) {
        try {
          await api(`/bots/${encodeURIComponent(id)}/start`, { method: 'POST' });
          toast(`${id} created and started${via}`, 'success');
        } catch (startErr) {
          toast(`${id} created${via}, but failed to start: ${startErr.message}`, 'warning');
        }
      } else {
        toast(`${id} created${via || (result && result.proxyNote ? ' (direct - pool full)' : '')}`, 'success');
      }
      onClose();
      onCreated((result && result.bot && result.bot.id) || id);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const createMany = async () => {
    if (!bulkValid || atLimit) return;
    setBusy('bulk');
    setError('');
    try {
      const result = await api('/bots/batch', {
        method: 'POST',
        body: JSON.stringify({
          defaults: { ...buildConfig(), startOnCreate: form.startOnCreate },
          bots: rows.map((row) => ({ username: row.username.trim() })),
        }),
      });
      const made = result.created || [];
      const failed = result.failed || [];
      if (made.length) saveLastBotConfig(form, made[made.length - 1].id);
      if (failed.length) {
        toast(`${made.length} created · ${failed.length} failed (${failed[0].username}: ${failed[0].reason})`, 'warning');
      } else {
        toast(`${made.length} bots created${form.startOnCreate ? ' and starting' : ''}`, 'success');
      }
      onClose();
      onCreated(made[0] && made[0].id);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const generateOne = async () => {
    setBusy('name');
    setError('');
    try {
      const result = await api('/usernames/generate', { method: 'POST' });
      patch({ username: result.username });
      setUsernameMeta(result);
      toast(`${result.username} is fresh and reserved for you`, 'success');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const rollAll = async () => {
    setBusy('roll');
    setError('');
    try {
      const result = await api('/usernames/generate-batch', {
        method: 'POST',
        body: JSON.stringify({ count: rows.length }),
      });
      const names = result.usernames || [];
      setRows(names.map((entry) => newBulkRow(entry.username, entry.inspiredBy || '')));
      if (result.partial) {
        toast(`Rolled ${names.length} of ${rows.length} - Mojang throttled the rest, roll the remainder again`, 'warning');
      } else {
        toast(`Rolled ${names.length} fresh, reserved names`, 'success');
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const rollOne = async (key) => {
    setRerolling(key);
    try {
      const result = await api('/usernames/generate', { method: 'POST' });
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, username: result.username, inspiredBy: result.inspiredBy || '' } : row))
      );
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRerolling('');
    }
  };

  const bulk = mode === 'bulk';
  const rolling = busy === 'roll';
  const creating = busy === 'single' || busy === 'bulk';

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={bulk ? `New bots · ${rows.length}` : 'New bot'}
      description={
        bulk
          ? 'One shared configuration, one name per bot, proxies spread automatically.'
          : "Everything here can be changed later in the bot's Configuration tab."
      }
      footer={
        <>
          <p className="mr-auto self-center text-[11px] text-white/35">
            {isAdmin ? 'Admin - no quota' : `${fleetBots.length}/${FREE_BOT_QUOTA} slots used`}
          </p>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {bulk ? (
            <Button variant="primary" loading={busy === 'bulk'} disabled={atLimit || !bulkValid} onClick={createMany}>
              Create {rows.length} bot{rows.length === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button variant="primary" loading={busy === 'single'} disabled={atLimit} onClick={createOne}>
              Create bot
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {atLimit ? (
          <p className="rounded-xl border border-white/25 bg-white/[0.06] p-3 text-xs leading-relaxed text-white/85">
            <strong>Account limit reached.</strong> Standard accounts can register a maximum of {FREE_BOT_QUOTA} bots (
            {fleetBots.length}/{FREE_BOT_QUOTA} used). Delete an existing bot to create a new one.
          </p>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {bulkAllowed ? (
          <SegmentedControl
            ariaLabel="Creation mode"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError('');
            }}
            options={[
              { value: 'single', label: 'Single bot', icon: Plus },
              { value: 'bulk', label: `Bulk · up to ${maxBulk}`, icon: Dices },
            ]}
          />
        ) : null}

        {restored ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs">
            <span className="text-white/60">Restored settings from your last created bot.</span>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem(LAST_BOT_CONFIG_KEY);
                } catch {
                  /* nothing to clear */
                }
                setForm({ ...BLANK_BOT, id: getNextBotId(fleetBots) });
                setRestored(false);
                toast('Form reset to default settings', 'info');
              }}
              className="shrink-0 text-white/40 underline transition hover:text-white"
            >
              Reset to defaults
            </button>
          </div>
        ) : null}

        <FormSection
          title={bulk ? 'Names' : 'Identity'}
          hint={
            bulk
              ? 'Bot IDs are auto-assigned. Every rolled name is verified unregistered and reserved as it appears.'
              : 'The ID names the process; the username is what the server sees.'
          }
        >
          {bulk ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-0.5 rounded-xl border border-white/10 bg-black/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => syncRows(rows.length - 1)}
                    disabled={rows.length <= 1 || rolling || creating}
                    aria-label="Fewer bots"
                    className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="tnum min-w-[4.5rem] text-center text-xs font-bold text-white">
                    {rows.length} bot{rows.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => syncRows(rows.length + 1)}
                    disabled={rows.length >= maxBulk || rolling || creating}
                    aria-label="More bots"
                    className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Button type="button" variant="secondary" onClick={rollAll} loading={rolling} disabled={creating}>
                  <Dices className="h-3.5 w-3.5" />
                  Roll {rows.length} name{rows.length === 1 ? '' : 's'}
                </Button>
              </div>

              <div className="console-scrollbar max-h-72 space-y-2 overflow-y-auto pr-1">
                {rows.map((row, index) => {
                  const issue = issues[index] || '';
                  const spinning = rerolling === row.key;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center gap-2">
                        <span className="tnum w-6 shrink-0 text-right text-[11px] text-white/30">{index + 1}</span>
                        <Input
                          value={row.username}
                          maxLength={16}
                          placeholder="miner_01"
                          aria-label={`Bot ${index + 1} username`}
                          disabled={rolling || creating}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRows((current) =>
                              current.map((entry) => (entry.key === row.key ? { ...entry, username: value, inspiredBy: '' } : entry))
                            );
                          }}
                          className={cn('min-w-0 flex-1 font-mono', issue && 'border-white/40 bg-white/[0.05]')}
                        />
                        <button
                          type="button"
                          onClick={() => rollOne(row.key)}
                          disabled={spinning || rolling || creating}
                          title="Re-roll this name"
                          aria-label="Re-roll this name"
                          className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/50 transition hover:border-white/30 hover:text-white disabled:opacity-40"
                        >
                          <Dices className={cn('h-3.5 w-3.5', spinning && 'anim-spin')} />
                        </button>
                      </div>
                      {issue ? (
                        <p className="mt-1 pl-8 text-[11px] text-white/55">{issue}</p>
                      ) : row.inspiredBy ? (
                        <p className="mt-1 pl-8 text-[11px] text-white/30">Reserved · inspired by {row.inspiredBy}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bot ID" hint="Auto-generated process identifier. Editable if needed.">
                <Input
                  value={form.id}
                  onChange={(event) => patch({ id: event.target.value })}
                  placeholder="bot-1"
                  aria-label="Bot ID"
                  className="font-mono text-xs"
                />
              </Field>
              <Field
                label="Minecraft username"
                hint={
                  usernameMeta
                    ? `Inspired by verified profile ${usernameMeta.inspiredBy}; confirmed unregistered and reserved.`
                    : 'Generate a verified, human-style name or enter your own.'
                }
              >
                <div className="flex gap-2">
                  <Input
                    value={form.username}
                    onChange={(event) => {
                      patch({ username: event.target.value });
                      setUsernameMeta(null);
                    }}
                    maxLength={16}
                    pattern="[A-Za-z0-9_]{3,16}"
                    placeholder="miner_01"
                    aria-label="Minecraft username"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={generateOne}
                    loading={busy === 'name'}
                    disabled={creating}
                    title="Generate and reserve an unregistered Minecraft username"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate
                  </Button>
                </div>
              </Field>
            </div>
          )}
        </FormSection>

        <FormSection title="Connection" hint="Where the bot joins from and how it gets there.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" hint="Groups the bot in the roster and in broadcasts.">
              <Input
                value={form.category}
                onChange={(event) => patch({ category: event.target.value })}
                placeholder={UNCATEGORIZED}
                list="nativelaunch-category-options"
                maxLength={48}
              />
            </Field>
            <Field label="Server host">
              <Input value={form.host} onChange={(event) => patch({ host: event.target.value })} />
            </Field>
            <Field label="Port">
              <Input type="number" value={form.port} onChange={(event) => patch({ port: event.target.value })} />
            </Field>
            <Field label="Version">
              <Input value={form.version} onChange={(event) => patch({ version: event.target.value })} />
            </Field>
            <Field label="Auth">
              <Select value={form.auth} onChange={(event) => patch({ auth: event.target.value })}>
                <option value="offline">Offline</option>
                <option value="microsoft">Microsoft</option>
              </Select>
            </Field>
            <Field label="Reconnect delay (seconds)" hint="Delay before rejoining after a disconnect.">
              <Input
                type="number"
                min="0.5"
                step="0.5"
                value={form.reconnectDelaySec}
                onChange={(event) => patch({ reconnectDelaySec: event.target.value })}
                placeholder="5"
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label="Proxy endpoint"
              hint={
                form.proxyId === 'auto'
                  ? poolSummary.total
                    ? `Smart spread across ${poolSummary.total} ${poolSummary.total === 1 ? 'proxy' : 'proxies'} · ${poolSummary.free} free slots · falls back to direct when full.`
                    : 'Pool is empty - creates with a direct connection for now.'
                  : form.proxyId
                    ? 'Pinned to this endpoint.'
                    : 'No proxy - connects straight from the panel host.'
              }
            >
              <Select value={form.proxyId} onChange={(event) => patch({ proxyId: event.target.value })}>
                <option value="auto">Auto - least-loaded endpoint (recommended)</option>
                <option value="">Direct connection</option>
                {proxyOptions.map((proxy) => (
                  <option key={proxy.id} value={proxy.id} disabled={proxy.freeSlots <= 0}>
                    {proxy.label}
                    {` · ${(proxy.assignedTo || []).length + (Number(proxy.hiddenAssignments) || 0)}/${proxy.capacity} used`}
                    {proxy.freeSlots <= 0 ? ' · full' : ` · ${proxy.freeSlots} left`}
                  </option>
                ))}
              </Select>
            </Field>
            {isAdmin ? (
              <Field className="sm:col-span-2" label="Owner" hint="Register this bot directly into another account.">
                <Select value={form.ownerId} onChange={(event) => patch({ ownerId: event.target.value })}>
                  <option value="">Me ({userEmail})</option>
                  {(owners || []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        </FormSection>

        <FormSection title="Behaviour" hint="Session handling and the bone collector loop.">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Checkbox
              checked={form.autoReconnect}
              onChange={(checked) => patch({ autoReconnect: checked })}
              label="Auto reconnect"
              description="Rejoin after a disconnect."
            />
            <Checkbox
              checked={form.afkMode}
              onChange={(checked) => patch({ afkMode: checked })}
              label="AFK mode"
              description="Keep the session alive while idle."
            />
            <Checkbox
              checked={form.autoRegister}
              onChange={(checked) => patch({ autoRegister: checked })}
              label="Auto register"
              description="Send /register on first join."
            />
            <Checkbox
              checked={form.autoLogin}
              onChange={(checked) => patch({ autoLogin: checked })}
              label="Auto login"
              description="Send /login with the password below."
            />
            <Checkbox
              checked={form.startOnCreate}
              onChange={(checked) => patch({ startOnCreate: checked })}
              label="Start immediately"
              description={bulk ? 'Launch every bot in the batch, staggered.' : 'Launch the bot right after it is created.'}
            />
          </div>

          {form.autoRegister || form.autoLogin ? (
            <div className="mt-4">
              <Field label="Login password" hint="Server password for /register and /login. Stored server-side.">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.loginPassword}
                  onChange={(event) => patch({ loginPassword: event.target.value })}
                  placeholder="Enter password..."
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Bone collector slot">
              <Input type="number" value={form.collectSlot} onChange={(event) => patch({ collectSlot: event.target.value })} />
            </Field>
            <Field label="Collector cycle (seconds)" hint="Seconds between collection cycles.">
              <Input
                type="number"
                min="1"
                step="1"
                value={form.cycleDelaySec}
                onChange={(event) => patch({ cycleDelaySec: event.target.value })}
                placeholder="15"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Integrations" hint="Optional. Relay events out to Discord or a webhook.">
          <Checkbox
            checked={form.discordEnabled}
            onChange={(checked) => patch({ discordEnabled: checked })}
            label="Discord alerts"
            description="Relay this bot's events to a Discord bot."
          />
          {form.discordEnabled ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Discord token">
                <Input
                  type="password"
                  autoComplete="off"
                  value={form.discordToken}
                  onChange={(event) => patch({ discordToken: event.target.value })}
                />
              </Field>
              <Field label="Guild ID">
                <Input value={form.discordGuildId} onChange={(event) => patch({ discordGuildId: event.target.value })} />
              </Field>
            </div>
          ) : null}
          <div className="mt-4">
            <Field label="Webhook URL" hint="Receives status and reward events.">
              <Input
                value={form.webhookUrl}
                onChange={(event) => patch({ webhookUrl: event.target.value })}
                placeholder="https://"
              />
            </Field>
          </div>
        </FormSection>

        <datalist id="nativelaunch-category-options">
          {categories.map((cat) => (
            <option key={cat.name} value={cat.name} />
          ))}
        </datalist>
      </div>
    </Modal>
  );
}
