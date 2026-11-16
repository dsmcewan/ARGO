// Guarded SDK surfaces for the actual embedded Pantheon consumer. All transport
// functions and tariff/token mappers come from the trusted operator composition.
import { readFileSync, mkdirSync, lstatSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runOpenItem } from '../../pantheon/src/board/run-item.mjs';
import { certifiedArtifacts } from '../../pantheon/src/board/artifacts.mjs';
import { frontierCandidates } from '../../pantheon/src/route/frontier.mjs';
import { models } from '../../packages/model-client/index.mjs';
import { brokerCommand, callOnce, canonicalRequest, requestHash, ProviderCallError } from './transport.mjs';

const IDS = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = ['mission_id','wave_id','repo_id','ticket_id','epoch','spec_sha','base_oid','candidate_oid','tree_oid','policy_sha','attempt_id','idempotency_key','dependency_versions'];
const dimensions = ['requests','input_tokens','output_tokens','spend_microusd'];
// This adapter is intentionally a narrow, opt-in runner. It can only account
// for the SDK-shaped OpenAI and Anthropic transports it owns. AGY CLI, Google,
// xAI, raw-client scripts, and arbitrary callers are outside that boundary and
// must be refused here rather than accidentally being described as guarded.
export const GUARDED_VENDORS = Object.freeze(['openai','anthropic']);
const GUARDED_VENDOR_SET = new Set(GUARDED_VENDORS);
const copy = value => JSON.parse(canonicalRequest(value));
const shaFile = url => createHash('sha256').update(readFileSync(url)).digest('hex');
const adapterSources = () => Object.fromEntries([
  './pantheon.mjs', './transport.mjs', './broker.py',
  '../../packages/model-client/models.json', '../../packages/model-client/router.mjs',
  '../../packages/model-client/client.mjs', '../../packages/model-client/request.mjs', '../../packages/model-client/wire.mjs',
  '../../pantheon/src/sdk/adapter.mjs', '../../pantheon/src/sdk/seat-sdk.mjs',
  '../../pantheon/src/route/frontier.mjs', '../../pantheon/src/board/run-item.mjs',
].map(name => [name, shaFile(new URL(name, import.meta.url))]));

function taskShape(task) {
  task = copy(task);
  if (task.schema_version !== 'argo.factory/v1' || task.kind !== 'task' || !task.identity || FIELDS.some(k => !Object.hasOwn(task.identity, k))) throw new TypeError('Complete frozen task envelope required');
  // Full contract validation and authorization belong to the F02/F05 caller.
  // Here every field (including dependencies and policy) enters the binding.
  return task;
}

function checkedRoutes(routes) {
  if (!Array.isArray(routes) || !routes.length) throw new TypeError('Explicit operator routes required');
  const pools = new Set();
  return routes.map(route => {
    if (!GUARDED_VENDOR_SET.has(route?.vendor)) throw new ProviderCallError('guarded_vendor_scope_refused');
    const registry = models[route.vendor];
    if (!registry || !IDS.test(route.pool ?? '') || pools.has(route.pool) || !IDS.test(route.credentialRef ?? '') || !IDS.test(route.principalId ?? '') ||
        !HASH.test(route.sourceSha256 ?? '') || !Array.isArray(route.models) || !route.models.length ||
        route.models.some(m => !Object.values(registry).includes(m)) ||
        ['estimate','invoke','measure'].some(k => typeof route[k] !== 'function')) throw new TypeError('Invalid trusted route, model, or transport binding');
    pools.add(route.pool);
    return Object.freeze({ vendor: route.vendor, pool: route.pool, credentialRef: route.credentialRef, principalId: route.principalId,
      models: Object.freeze([...route.models]), sourceSha256: route.sourceSha256,
      estimate: route.estimate, invoke: route.invoke, measure: route.measure,
      ...(typeof route.countRequest==='function'&&typeof route.hasCount==='function'?{countRequest:route.countRequest,hasCount:route.hasCount}:{}) });
  });
}

function wireInput(method, input, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('SDK request object required');
  if (Object.keys(options).some(k => !['headers','signal'].includes(k))) throw new TypeError('Unsupported SDK transport options');
  const request = { ...input };
  let signal = options.signal;
  if (request.config) {
    const { abortSignal, ...config } = request.config;
    signal ??= abortSignal;
    request.config = config;
  }
  // AbortSignal is local control, not part of the provider wire request digest.
  const body = copy(request);
  const headers = copy(options.headers ?? {});
  if (Object.entries(headers).some(([key,value]) => key.toLowerCase()!=='anthropic-beta' || typeof value !== 'string' || /[\r\n]/.test(value))) throw new TypeError('Only bound noncredential beta headers are supported');
  return { body, options: { headers }, signal };
}

function reservationEstimate(route, method, request) {
  const estimate = copy(route.estimate({ method, request: copy(request) }));
  if (Object.keys(estimate).sort().join() !== [...dimensions].sort().join() ||
      estimate.requests !== 1 || dimensions.some(d => !Number.isSafeInteger(estimate[d]) || estimate[d] < 0)) throw new TypeError('Single-attempt safe integer ceilings required');
  if (!method.endsWith('.count')) {
    const cap = request.max_output_tokens ?? request.max_tokens ?? request.config?.maxOutputTokens;
    if (estimate.output_tokens < 1 || (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1))) throw new TypeError('Positive provider output cap required');
    // Native legacy requests sometimes omit caps, and frontier defaults can be
    // larger than the operator's allotment. Enforce the operator ceiling on the
    // actual wire body before hashing/reserving/sending that body.
    const bounded = Math.min(cap ?? estimate.output_tokens, estimate.output_tokens);
    if (method.startsWith('models.')) request.config = { ...request.config, maxOutputTokens: bounded };
    else if (method.startsWith('messages.')) request.max_tokens = bounded;
    else request.max_output_tokens = bounded;
  }
  return estimate;
}

/** Supply directly as runOpenItem's makeClientFor. No SDK or credential loader. */
export function createPantheonClientFactory({ broker, task, execution, routes, owner, signal, timeoutMs = 60000, maxBufferedBytes = 1048576 }) {
  const frozenTask = taskShape(task), frozenExecution = copy(execution);
  if (!IDS.test(owner ?? '') || !frozenExecution || typeof frozenExecution !== 'object') throw new TypeError('Explicit trusted execution identity and owner required');
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1024 || maxBufferedBytes > 16777216) throw new TypeError('Bounded stream buffer required');
  const selected = checkedRoutes(routes), sources = adapterSources();
  const trustedBroker = copy(broker), taskSha256 = requestHash({ task: frozenTask, execution: frozenExecution });
  const receipts = [], clients = new Map();
  // Open existing state at construction; never create budgets per factory/wave.
  brokerCommand(trustedBroker, 'snapshot');

  function makeClientFor(vendor, { pool, poolConfig } = {}) {
    const candidates = selected.filter(r => r.vendor === vendor && (pool === undefined || r.pool === pool));
    if (candidates.length !== 1) throw new ProviderCallError('unconfigured_or_ambiguous_provider_pool');
    const route = candidates[0];
    if (poolConfig && (poolConfig.id !== route.pool || poolConfig.vendor !== vendor)) throw new ProviderCallError('provider_pool_binding_mismatch');
    if (clients.has(route.pool)) return clients.get(route.pool);
    const sourceSha256 = requestHash({ adapter_sources: sources, transport_source_sha256: route.sourceSha256 });

    async function guarded(method, input, options) {
      const wire = wireInput(method, input, options);
      if (!route.models.includes(wire.body.model)) throw new ProviderCallError('unreserved_provider_model');
      // Concrete production routes can require an exact separately admitted
      // count preflight. The request digest, account/pool and shared broker are
      // identical to generation; count failure never falls through to paid work.
      if (!method.endsWith('.count') && typeof route.countRequest==='function' && !route.hasCount(wire.body)) {
        await guarded(vendor==='anthropic'?'messages.count':'responses.inputTokens.count',route.countRequest({method,request:wire.body}),options);
      }
      const requested = reservationEstimate(route, method, wire.body);
      const envelope = { vendor, principal_id: route.principalId, pool: route.pool, method, body: wire.body, options: wire.options };
      const requestSha256 = requestHash(envelope), key = `pantheon:${taskSha256}:${requestSha256}`;
      const combined = [signal, wire.signal].filter(Boolean);
      const abort = combined.length ? AbortSignal.any(combined) : undefined;
      const result = await callOnce({ broker: trustedBroker, pool: route.pool, key, owner,
        request: envelope, requested, timeoutMs, signal: abort,
        binding: { task_sha256: taskSha256, request_sha256: requestSha256, source_sha256: sourceSha256,
          model: wire.body.model, credential_ref: route.credentialRef },
        invoke: async ({ request: bound, signal: callSignal, operation }) => {
          // Only this fixed injected function performs the physical attempt. SDK
          // construction/retry policy is the trusted transport's responsibility.
          const raw = await route.invoke({ method, request: bound.body, options: bound.options, signal: callSignal,
            operation: Object.freeze({ ...operation, vendor, principalId: route.principalId, taskSha256, sourceSha256 }) });
          const streaming = Boolean(raw?.[Symbol.asyncIterator]);
          const events = []; let bytes = 0, response = null;
          if (streaming) {
            for await (const event of raw) {
              callSignal.throwIfAborted();
              const clean = copy(event); bytes += Buffer.byteLength(canonicalRequest(clean));
              if (bytes > maxBufferedBytes || events.length >= 10000) throw new ProviderCallError('provider_stream_bound_exceeded', { ambiguous: true });
              events.push(clean);
            }
          } else {
            response = copy(raw);
            if (Buffer.byteLength(canonicalRequest(response)) > maxBufferedBytes) throw new ProviderCallError('provider_response_bound_exceeded', { ambiguous: true });
          }
          const usage = await route.measure({ method, request: bound.body, response, events: copy(events) });
          return { value: { streaming, events, response }, usage };
        } });
      receipts.push(Object.freeze({ vendor, principalId: route.principalId, method, requestSha256, taskSha256, reservation: result.reservation }));
      if (!result.value.streaming) return result.value.response;
      const events = result.value.events;
      return { async *[Symbol.asyncIterator]() { for (const event of events) yield event; } };
    }
    const responses = Object.freeze({ create: (request, options) => guarded('responses.create', request, options),
      inputTokens: Object.freeze({ count: (request, options) => guarded('responses.inputTokens.count', request, options) }) });
    const messages = Object.freeze({ create: (request, options) => guarded('messages.create', request, options) });
    const client = Object.freeze(vendor === 'anthropic' ? { messages, beta: Object.freeze({ messages }) } : { responses });
    clients.set(route.pool, client); return client;
  }
  return Object.freeze({ makeClientFor, taskSha256,
    sourceBinding: requestHash({ sources, routes: selected.map(({vendor,pool,credentialRef,principalId,models,sourceSha256}) => ({vendor,pool,credentialRef,principalId,models,sourceSha256})) }),
    receipts: () => copy(receipts),
    snapshot: () => brokerCommand(trustedBroker, 'snapshot'),
    recoverExpired: () => brokerCommand(trustedBroker, 'recover_expired'),
  });
}

/** Effect-free preflight shared by admission and the real native consumer. */
export function selectPantheonSeats({ routes, task, spec = {}, producerModel }) {
  const selected = checkedRoutes(routes), pools = selected.map(r => ({ id: r.pool, vendor: r.vendor }));
  const candidates = (role, pin) => frontierCandidates(role, { pools, ...(pin?{pin}:{}) })
    .filter(c => selected.some(r => r.vendor === c.vendor && r.pool === c.pool && r.models.includes(c.model)));
  const planners = candidates('planner'), implementer = candidates('implementer',producerModel)[0];
  if(producerModel && implementer?.model!==producerModel)throw new ProviderCallError('native_producer_model_unavailable');
  if (!planners.length || !implementer) throw new ProviderCallError('canonical_role_route_unavailable');
  const maker = selected.find(r => r.pool === implementer.pool);
  if (task.author?.vendor !== maker.vendor || task.author?.principal_id !== maker.principalId) throw new ProviderCallError('task_producer_identity_mismatch');
  for (const slot of spec.slots ?? []) {
    if (!slot.model) continue;
    const route = selected.find(r => r.models.includes(slot.model));
    if (!route || route.vendor !== maker.vendor || route.principalId !== maker.principalId) throw new ProviderCallError('slot_route_could_bypass_guarded_client');
  }
  // Preserve canonical reviewer preference. Existing operator pins permit a
  // canonical frontier producer model to review when preferred vendors are
  // unavailable; this is a startup assignment, never an effect-time retry.
  const reviewers = candidates('reviewer'), seen = new Set(reviewers.map(c=>`${c.pool}:${c.model}`));
  for (const model of new Set([...planners,...candidates('implementer')].map(c=>c.model))) {
    for (const candidate of candidates('reviewer',model).filter(c=>c.model===model)) {
      const key=`${candidate.pool}:${candidate.model}`;
      if (!seen.has(key)) { seen.add(key); reviewers.push({...candidate,rank:reviewers.length}); }
    }
  }
  let independentVendor = false;
  for (const planner of planners) {
    const plannerRoute=selected.find(r=>r.pool===planner.pool);
    for (const reviewer of reviewers) {
      if ([maker.vendor,planner.vendor].includes(reviewer.vendor)) continue;
      independentVendor=true;
      const reviewRoute=selected.find(r=>r.pool===reviewer.pool);
      if ([maker.principalId,plannerRoute.principalId].includes(reviewRoute.principalId)) continue;
      // Native intake accepts an empty scout list. Its canonical scout routing
      // is not overrideable; never send an unbound alternate model to fill it.
      return {planner,implementer,reviewer,scout:candidates('scout')[0]??null};
    }
  }
  throw new ProviderCallError(independentVendor?'independent_reviewer_principal_unavailable':'independent_reviewer_route_unavailable');
}

/** Concrete native consumer. Native local ship is not F02 review/publication authority. */
export async function runAdmittedPantheonItem({ spec, expectedExecutionSpecSha, task, boardDir, broker, routes, owner, signal, timeoutMs = 60000,
  revisions = 1, progress, resume = false, maxBufferedBytes, producerModel, identityStage='frozen-task' }) {
  spec = copy(spec); task = taskShape(task);
  if (!path.isAbsolute(boardDir ?? '') || !path.isAbsolute(spec.repo_root ?? '')) throw new TypeError('Absolute supervisor-owned board and repository paths required');
  if (!HASH.test(expectedExecutionSpecSha ?? '') || expectedExecutionSpecSha !== requestHash(spec)) throw new ProviderCallError('ticket_spec_binding_mismatch');
  if (!Number.isSafeInteger(revisions) || revisions < 1 || revisions > 3) throw new TypeError('Bounded revision count required');
  if(!['frozen-task','native-input-snapshot'].includes(identityStage))throw new TypeError('Explicit identity stage required');
  const selected=checkedRoutes(routes),pools=selected.map(r=>({id:r.pool,vendor:r.vendor}));
  const {planner,implementer,reviewer,scout}=selectPantheonSeats({routes:selected,task,spec,producerModel});
  const execution = { identity_stage:identityStage, ticket: spec, board_root: path.resolve(boardDir),
    limits:{revisions,timeout_ms:timeoutMs,max_buffered_bytes:maxBufferedBytes??1048576},routing: {
    planner, implementer, reviewer, scout,
  } };
  const factory = createPantheonClientFactory({ broker, task, execution, routes: selected, owner, signal, timeoutMs, maxBufferedBytes });
  const state = factory.snapshot();
  const binding = { schema_version: 1, task_sha256: factory.taskSha256, source_sha256: factory.sourceBinding,
    database_id: state.database_id, config_sha256: state.config_sha256 };
  const bindingPath = path.join(boardDir, 'provider-binding.json');
  // Native resume binds its ticket spec, but not the upstream native Board task.
  // Bind that additional authority before any provider effect, and never mint a
  // new native identity around an older board's already-shipped artifacts.
  for (let current = path.resolve(boardDir); ; current = path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new ProviderCallError('provider_board_symlink_refused');
    if (path.dirname(current) === current) break;
  }
  if (resume) {
    if (!existsSync(bindingPath) || !lstatSync(bindingPath).isFile() || lstatSync(bindingPath).isSymbolicLink() || lstatSync(bindingPath).size > 4096 ||
        canonicalRequest(JSON.parse(readFileSync(bindingPath,'utf8'))) !== canonicalRequest(binding)) throw new ProviderCallError('provider_resume_binding_mismatch');
  } else {
    if (existsSync(bindingPath) || existsSync(path.join(boardDir,'run.json'))) throw new ProviderCallError('provider_board_already_bound');
    mkdirSync(boardDir,{recursive:true,mode:0o700});
    const fd=openSync(bindingPath,'wx',0o600);
    try { writeSync(fd,canonicalRequest(binding)); fsyncSync(fd); } finally { closeSync(fd); }
    const parent=openSync(boardDir,'r');try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  // Native routeCall's cache must not skip to another seat. Admission/refusal is
  // centralized in the shared broker; its errors carry no retryable HTTP status.
  const cooldown = Object.freeze({ get: async () => null, success: async () => {}, refuse: async () => {} });
  const result = await runOpenItem(spec, { dir: boardDir, ...(resume ? { resume: boardDir } : {}),
    makeClientFor: factory.makeClientFor, pools, profile: 'argo', scouts: scout?[scout.vendor]:[],
    seatOverrides: { planner, implementer, reviewer }, cooldown, revisions,
    signal, turnTimeoutMs: timeoutMs + 1000, progress });
  const artifacts = [];
  let certificate = null;
  if (result.ok && result.shipped) {
    const run = JSON.parse(readFileSync(path.join(boardDir, 'run.json'), 'utf8'));
    certificate = run.certificate;
    for (const artifact of certifiedArtifacts(run, { repoRoot: spec.repo_root, outDir: result.outDir })) {
      artifacts.push({ slot: artifact.slot, path: artifact.path, cid: artifact.cid, bytes: artifact.bytes,
        sha256: createHash('sha256').update(artifact.contents).digest('hex'), contentBase64: artifact.contents.toString('base64') });
    }
  }
  const reservations=Object.values(factory.snapshot().reservations).filter(row=>row.binding.task_sha256===factory.taskSha256);
  return { ...result, artifacts, certificate, provider: { identity_stage:identityStage, task_sha256: factory.taskSha256, receipts: factory.receipts(),
    held: reservations.filter(row=>['dispatched','unknown','quarantined'].includes(row.status)) },
    authority: 'native-local-pipeline-only' };
}
