import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelId } from '../../packages/model-client/index.mjs';
import { createPantheonClientFactory, runAdmittedPantheonItem } from './pantheon.mjs';
import { fixtureRoutes, setup } from './testing.mjs';

test('admitted client refuses every unsupported vendor before a provider invocation', t => {
  const { execution } = setup(t);
  const options = execution();
  const executionBinding = { ticket: options.spec, board_root: options.boardDir };

  for (const vendor of ['xai', 'agy_google']) {
    const calls = [];
    const routes = fixtureRoutes(calls).filter(route => ['openai', 'anthropic', vendor].includes(route.vendor));
    assert.throws(() => createPantheonClientFactory({
      // Scope is checked before even a broker snapshot can be attempted.
      broker: { database: '/not-consulted-before-scope.sqlite', config: '/not-consulted-before-scope.json' },
      task: options.task,
      execution: executionBinding,
      routes,
      owner: options.owner,
    }), error => error?.code === 'guarded_vendor_scope_refused');
    assert.equal(calls.length, 0);
  }
});

test('admitted runner refuses an unsupported route before it enters the Pantheon pipeline', async t => {
  const { execution } = setup(t);
  const options = execution();
  const calls = [];
  const routes = fixtureRoutes(calls).filter(route => ['openai', 'anthropic', 'agy_google'].includes(route.vendor));
  await assert.rejects(runAdmittedPantheonItem({ ...options, routes }), error => error?.code === 'guarded_vendor_scope_refused');
  assert.equal(calls.length, 0);
});

test('admitted runner executes a supported independent pair without selecting an excluded lane', async t => {
  const { execution, snapshot } = setup(t);
  const options = execution();
  const calls = [];
  const routes = fixtureRoutes(calls).filter(route => ['openai', 'anthropic'].includes(route.vendor));
  const result = await runAdmittedPantheonItem({
    ...options,
    routes,
    producerModel: modelId('openai', 'astra'),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.shipped, true, JSON.stringify(result));
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => ['openai', 'anthropic'].includes(call.vendor)));
  assert.equal(snapshot().global.spent.requests, calls.length);
  assert.equal(result.provider.receipts.length, calls.length);
});
