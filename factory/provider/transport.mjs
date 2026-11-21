// Production admission seam. The injected transport must perform ONE physical
// attempt with SDK/router retries disabled. No credential discovery or networking
// occurs here. An interrupted attempt is never automatically replayed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFailure } from '../../packages/model-client/router.mjs';

const SCRIPT = fileURLToPath(new URL('./broker.py', import.meta.url));
const DIMENSIONS = ['requests', 'input_tokens', 'output_tokens', 'spend_microusd'];

export class ProviderCallError extends Error {
  constructor(code, { ambiguous = false, reservationKey = null, durableOutcome = null } = {}) {
    super(code);
    this.name = 'ProviderCallError';
    Object.assign(this, { code, ambiguous, reservationKey, durableOutcome });
  }
}

// Same plain-JSON sorting rule as the frozen contract's documentHash. Keep the
// transport dependency-free; cross-check this helper against that export in CI.
export function canonicalRequest(value) {
  const seen = new Set();
  function sort(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError('Plain finite JSON required');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new TypeError('Plain JSON required');
    for (const key of Reflect.ownKeys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || descriptor.get || descriptor.set || (!descriptor.enumerable && key !== 'length')) throw new TypeError('JSON accessors refused');
    }
    seen.add(v);
    const result = Array.isArray(v) ? v.map(sort) : Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
    seen.delete(v);
    return result;
  }
  return JSON.stringify(sort(value));
}
export const requestHash = value => createHash('sha256').update(canonicalRequest(value)).digest('hex');

export function budgetPolicyArgs(broker) {
  const p=broker?.budgetPolicy;if(p===undefined)return [];
  if(!p||Object.keys(p).sort().join()!==['epoch','policySha','profile','profileSha'].sort().join()||!path.isAbsolute(p.profile??'')||!Number.isSafeInteger(p.epoch)||p.epoch<1||!['profileSha','policySha'].every(k=>/^[a-f0-9]{64}$/.test(p[k]??'')))throw new TypeError('Exact adopted budget policy pin required');
  return ['--budget-profile',p.profile,'--budget-profile-sha',p.profileSha,'--budget-epoch',String(p.epoch),'--budget-policy-sha',p.policySha];
}

export function brokerCommand(broker, command, params = {}) {
  if (!broker || !['database', 'config'].every(k => typeof broker[k] === 'string' && path.isAbsolute(broker[k]))) throw new TypeError('Absolute operator-owned broker paths required');
  const python = broker.python ?? '/usr/bin/python3';
  if (!path.isAbsolute(python)) throw new TypeError('Absolute trusted Python path required');
  const args = ['-I', '-S', SCRIPT, command, '--database', broker.database, '--config', broker.config];
  if (broker.databaseId) args.push('--database-id', broker.databaseId);
  args.push(...budgetPolicyArgs(broker));
  const input = canonicalRequest(params);
  if (Buffer.byteLength(input) > 65536) throw new TypeError('Bounded broker input required');
  let output;
  try {
    output = execFileSync(python, args, {
      input, encoding: 'utf8', timeout: 20000, maxBuffer: 1048576,
      // Do not propagate provider secrets or Python import overrides to the CLI.
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new ProviderCallError('broker_unavailable_or_refused');
  }
  let reply;
  try { reply = JSON.parse(output); } catch { throw new ProviderCallError('broker_invalid_response'); }
  if (reply.ok !== true) throw new ProviderCallError('broker_refused');
  return reply.result;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export async function callOnce({ broker, pool, key, binding, requested, request, owner, invoke, signal, timeoutMs = 60000 }) {
  if (typeof invoke !== 'function') throw new TypeError('Injected single-attempt transport required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError('Bounded timeout required');
  broker = deepFreeze(JSON.parse(canonicalRequest(broker)));
  binding = deepFreeze(JSON.parse(canonicalRequest(binding)));
  requested = deepFreeze(JSON.parse(canonicalRequest(requested)));
  // Freeze a copy so caller or transport mutation cannot change the paid request
  // after its digest has been reserved. No prompts/content enter the broker DB.
  const frozenRequest = deepFreeze(JSON.parse(canonicalRequest(request)));
  if (requestHash(frozenRequest) !== binding?.request_sha256) throw new ProviderCallError('request_binding_mismatch');
  if (frozenRequest && typeof frozenRequest === 'object' && Object.hasOwn(frozenRequest, 'model') && frozenRequest.model !== binding.model) throw new ProviderCallError('request_model_mismatch');
  if (requested?.requests !== 1) throw new TypeError('One physical call requires one request reservation');
  if (signal?.aborted) throw new ProviderCallError('cancelled_before_admission');
  const reserve = brokerCommand(broker, 'reserve', { pool, key, binding, requested });
  if (reserve.status !== 'reserved') throw new ProviderCallError(reserve.status, { reservationKey: key });
  if (signal?.aborted) {
    brokerCommand(broker, 'cancel', { key });
    throw new ProviderCallError('cancelled_before_dispatch', { reservationKey: key });
  }
  const claim = brokerCommand(broker, 'claim_dispatch', { key, owner, lease_ms: timeoutMs + 5000 });
  if (claim.status !== 'dispatched') throw new ProviderCallError(claim.status, { reservationKey: key });
  const fence = { owner: claim.owner, epoch: claim.epoch, token: claim.token };
  const controller = new AbortController();
  let timer, onAbort;
  try {
    const interrupted = new Promise((_, reject) => {
      const stop = code => { controller.abort(); reject(new ProviderCallError(code, { ambiguous: true, reservationKey: key })); };
      onAbort = () => stop('cancelled_after_dispatch');
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => stop('provider_deadline'), timeoutMs);
      if (signal?.aborted) onAbort();
    });
    // A cancellation in the narrow claim-to-call gap is still conservatively
    // unknown because durable dispatch intent has already been committed.
    const attempt = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new ProviderCallError('cancelled_after_dispatch', { ambiguous: true });
      return invoke({ request: frozenRequest, signal: controller.signal,
        operation: Object.freeze({ pool, key, model: binding.model, credentialRef: binding.credential_ref, requestSha256: binding.request_sha256 }) });
    });
    const response = await Promise.race([attempt, interrupted]);
    const usage = response?.usage;
    if (!usage || Object.keys(usage).sort().join() !== [...DIMENSIONS].sort().join() ||
        !DIMENSIONS.every(d => Number.isSafeInteger(usage[d]) && usage[d] >= 0) || usage.requests !== 1) throw new ProviderCallError('missing_or_invalid_usage', { ambiguous: true });
    const settled = brokerCommand(broker, 'settle', { key, fence, actual: usage });
    if (settled.status !== 'settled') throw new ProviderCallError('provider_usage_overrun', { ambiguous: true, durableOutcome: settled.status });
    return { value: response.value, reservation: settled };
  } catch (error) {
    controller.abort();
    // Do not infer that a 429, auth error, reset or timeout was unbilled. The
    // response only closes future admission; this attempt remains encumbered.
    try {
      const status = error?.status ?? error?.response?.status;
      const failure = classifyFailure(error);
      if ([401, 403].includes(status)) brokerCommand(broker, 'auth_expired', { pool });
      if (failure.retryable) {
        const now = Date.now();
        const indicated = Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : failure.retryMs;
        const wait = indicated === null ? 60000 : Math.ceil(indicated);
        brokerCommand(broker, 'refuse', { pool, retry_at_ms: now + Math.min(wait, Number.MAX_SAFE_INTEGER - now) });
      }
    } catch { /* Existing dispatch intent still holds capacity on DB failure. */ }
    let durableOutcome = error?.durableOutcome ?? 'dispatch-intent-retained';
    try { durableOutcome = brokerCommand(broker, 'mark_unknown', { key, fence }).status; } catch { /* Recovery must inspect retained dispatch/quarantine. */ }
    throw new ProviderCallError(error instanceof ProviderCallError ? error.code : 'provider_outcome_unknown', { ambiguous: true, reservationKey: key, durableOutcome });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
