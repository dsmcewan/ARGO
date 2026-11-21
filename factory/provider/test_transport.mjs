import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { brokerCommand, callOnce, requestHash } from './transport.mjs';

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'argo-transport-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const limits = { requests: 10, input_tokens: 100, output_tokens: 100, spend_microusd: 100 };
  const config = { schema_version: 1, global: { lifetime: limits, windows: [] }, pools: {
    shared: { credential_ref: 'fixture-ref', models: ['fixture-model'], lifetime: limits, windows: [] },
  } };
  const configPath = path.join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config));
  const broker = { database: path.join(dir, 'broker.sqlite'), config: configPath };
  broker.databaseId = brokerCommand(broker, 'initialize').database_id;
  const request = { model: 'fixture-model', messages: [{ role: 'user', content: 'offline synthetic' }] };
  const base = { broker, pool: 'shared', key: 'operation-1', owner: 'worker-1', request,
    binding: { task_sha256: '1'.repeat(64), source_sha256: '2'.repeat(64), request_sha256: requestHash(request), model: 'fixture-model', credential_ref: 'fixture-ref' },
    requested: { requests: 1, input_tokens: 10, output_tokens: 20, spend_microusd: 70 }, timeoutMs: 100 };
  const actual = { requests: 1, input_tokens: 4, output_tokens: 8, spend_microusd: 30 };
  return { base, actual, snapshot: () => brokerCommand(broker, 'snapshot') };
}

test('one physical success settles four actual dimensions and cannot replay', async t => {
  const { base, actual, snapshot } = setup(t); let calls = 0;
  const invoke = async ({ request }) => { calls++; assert.equal(Object.isFrozen(request.messages[0]), true); return { value: 'ok', usage: actual }; };
  const result = await callOnce({ ...base, invoke });
  assert.equal(result.value, 'ok'); assert.equal(result.reservation.status, 'settled');
  await assert.rejects(callOnce({ ...base, invoke }), e => e.code === 'settled');
  assert.equal(calls, 1); assert.deepEqual(snapshot().global.spent, actual);
});

test('ambiguous network reset executes once and retains ceiling after repeat', async t => {
  const { base, snapshot } = setup(t); let calls = 0;
  const invoke = async () => { calls++; throw Object.assign(new Error('fixture'), { code: 'ECONNRESET' }); };
  await assert.rejects(callOnce({ ...base, invoke }), e => e.ambiguous && e.durableOutcome === 'unknown');
  await assert.rejects(callOnce({ ...base, invoke }), e => e.code === 'unknown');
  assert.equal(calls, 1); assert.equal(snapshot().global.held.spend_microusd, 70);
});

test('changed body, source and task binding refuse before another invocation', async t => {
  const { base, actual } = setup(t); let calls = 0;
  const invoke = async () => { calls++; return { usage: actual }; };
  await assert.rejects(callOnce({ ...base, request: { changed: true }, invoke }), e => e.code === 'request_binding_mismatch');
  const differentModel = { ...base.request, model: 'unreserved-model' };
  await assert.rejects(callOnce({ ...base, request: differentModel, binding: { ...base.binding, request_sha256: requestHash(differentModel) }, invoke }), e => e.code === 'request_model_mismatch');
  await callOnce({ ...base, invoke });
  for (const field of ['source_sha256', 'task_sha256']) await assert.rejects(callOnce({ ...base, binding: { ...base.binding, [field]: '3'.repeat(64) }, invoke }));
  assert.equal(calls, 1);
});

test('concurrent wrappers share one dispatch fence', async t => {
  const { base, actual } = setup(t); let calls = 0;
  const invoke = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { usage: actual }; };
  const results = await Promise.allSettled([callOnce({ ...base, timeoutMs: 1000, invoke }), callOnce({ ...base, timeoutMs: 1000, invoke })]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('pre-aborted call has no reservation or invocation', async t => {
  const { base, snapshot } = setup(t); const c = new AbortController(); c.abort(); let calls = 0;
  await assert.rejects(callOnce({ ...base, signal: c.signal, invoke: () => { calls++; } }), e => e.code === 'cancelled_before_admission');
  assert.equal(calls, 0); assert.deepEqual(snapshot().reservations, {});
});

test('abort after dispatch and ignored timeout retain unknown outcomes', async t => {
  const { base, snapshot } = setup(t); const c = new AbortController(); let calls = 0;
  await assert.rejects(callOnce({ ...base, signal: c.signal, invoke: () => { calls++; c.abort(); return new Promise(() => {}); } }), e => e.code === 'cancelled_after_dispatch');
  assert.equal(calls, 1); assert.equal(snapshot().reservations['operation-1'].status, 'unknown');
  const other = setup(t);
  await assert.rejects(callOnce({ ...other.base, timeoutMs: 10, invoke: () => new Promise(() => {}) }), e => e.code === 'provider_deadline' && e.durableOutcome === 'unknown');
});

test('auth refusal is durable and does not refund dispatched work', async t => {
  const { base, snapshot } = setup(t); let calls = 0;
  await assert.rejects(callOnce({ ...base, invoke: () => { calls++; throw { status: 401 }; } }));
  await assert.rejects(callOnce({ ...base, key: 'new', invoke: () => { calls++; } }), e => e.code === 'auth_required');
  assert.equal(calls, 1); assert.equal(snapshot().global.held.requests, 1);
});

test('429 Retry-After persists and refusal is not assumed unbilled', async t => {
  const { base, snapshot } = setup(t); let calls = 0;
  await assert.rejects(callOnce({ ...base, invoke: () => { calls++; throw { status: 429, retryAfterMs: 60000 }; } }));
  await assert.rejects(callOnce({ ...base, key: 'new', invoke: () => { calls++; } }), e => e.code === 'cooldown');
  assert.equal(calls, 1); assert.equal(snapshot().global.held.spend_microusd, 70);
});

test('existing model-client classifier preserves long HTTP Retry-After', async t => {
  const { base, snapshot } = setup(t);
  const before = Date.now();
  await assert.rejects(callOnce({ ...base, invoke: () => { throw { response: { status: 429 }, headers: new Headers({ 'retry-after': '172800' }) }; } }));
  assert.ok(snapshot().pools.shared.retry_at_ms >= before + 172800000);
});

test('missing usage retains charge; exceeding estimate records debt and quarantines', async t => {
  const { base, snapshot } = setup(t);
  await assert.rejects(callOnce({ ...base, invoke: () => ({ value: 'missing' }) }), e => e.code === 'missing_or_invalid_usage');
  assert.equal(snapshot().global.held.spend_microusd, 70);
  const other = setup(t);
  await assert.rejects(callOnce({ ...other.base, invoke: () => ({ usage: { ...other.actual, spend_microusd: 90 } }) }), e => e.code === 'provider_usage_overrun' && e.durableOutcome === 'quarantined');
  assert.equal(other.snapshot().global.held.spend_microusd, 90);
});

test('mutating caller data during transport cannot redirect settlement or identity', async t => {
  const { base, actual, snapshot } = setup(t);
  const savedBroker = { ...base.broker };
  await callOnce({ ...base, invoke: ({ operation, request }) => {
    base.broker.database = '/nonexistent'; base.binding.model = 'mutated'; base.request.messages[0].content = 'mutated';
    assert.equal(operation.model, 'fixture-model'); assert.equal(request.messages[0].content, 'offline synthetic');
    return { usage: actual };
  } });
  base.broker.database = savedBroker.database;
  assert.equal(snapshot().reservations['operation-1'].status, 'settled');
});
