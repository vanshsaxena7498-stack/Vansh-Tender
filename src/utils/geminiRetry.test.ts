import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_DELAYS_MS,
  executeWithRetryAndFallback,
  extractJsonObjectFromText,
  FALLBACK_PDF_MODEL,
  isRetryableGeminiError,
  PRIMARY_PDF_MODEL,
  sanitizeExtractErrorMessage,
  TimeoutError,
  withRetry,
  withTimeout,
} from './geminiRetry.ts';

test('withRetry retries 3 times with 2000ms -> 4000ms -> 8000ms delays on 503 high demand', async () => {
  const recordedDelays: number[] = [];
  let calls = 0;

  const res = await withRetry(
    async () => {
      calls += 1;
      if (calls <= 3) {
        throw { status: 503, message: 'UNAVAILABLE: model experiencing high demand' };
      }
      return 'extracted-ok';
    },
    {
      maxRetries: 3,
      delaysMs: DEFAULT_RETRY_DELAYS_MS,
      sleepFn: async (ms) => {
        recordedDelays.push(ms);
      },
    },
  );

  assert.equal(res.value, 'extracted-ok');
  assert.equal(res.attempts, 4);
  assert.deepEqual(recordedDelays, [2000, 4000, 8000]);
});

test('withRetry retries on 429 rate limit and skips non-retryable 403 API key errors', async () => {
  assert.equal(isRetryableGeminiError({ status: 503, message: 'high demand' }), true);
  assert.equal(isRetryableGeminiError({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true);
  assert.equal(isRetryableGeminiError(new Error('503 UNAVAILABLE')), true);
  assert.equal(
    isRetryableGeminiError({ status: 403, message: 'PERMISSION_DENIED: API_KEY_INVALID' }),
    false,
  );

  let authCalls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        authCalls += 1;
        throw { status: 403, message: 'PERMISSION_DENIED' };
      },
      {
        maxRetries: 3,
        sleepFn: async () => {},
      },
    ),
  );
  assert.equal(authCalls, 1);
});

test('executeWithRetryAndFallback automatically switches to fast fallback model after 3 primary retries fail', async () => {
  const modelsTried: string[] = [];
  const recordedDelays: number[] = [];
  let fallbackTriggered = false;

  const outcome = await executeWithRetryAndFallback({
    primaryModel: PRIMARY_PDF_MODEL,
    fallbackModel: FALLBACK_PDF_MODEL,
    primaryRetryOptions: {
      sleepFn: async (ms) => {
        recordedDelays.push(ms);
      },
    },
    fallbackRetryOptions: {
      sleepFn: async (ms) => {
        recordedDelays.push(ms);
      },
    },
    onFallback: ({ fromModel, toModel }) => {
      fallbackTriggered = true;
      assert.equal(fromModel, PRIMARY_PDF_MODEL);
      assert.equal(toModel, FALLBACK_PDF_MODEL);
    },
    runAttempt: async (model) => {
      modelsTried.push(model);
      if (model === PRIMARY_PDF_MODEL) {
        throw new Error('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}');
      }
      return { tenderId: 'GEM/2026/B/9990001' };
    },
  });

  assert.equal(fallbackTriggered, true);
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.modelUsed, FALLBACK_PDF_MODEL);
  assert.equal(outcome.primaryAttempts, 4);
  assert.equal(outcome.totalAttempts, 5);
  assert.deepEqual(modelsTried, [
    PRIMARY_PDF_MODEL,
    PRIMARY_PDF_MODEL,
    PRIMARY_PDF_MODEL,
    PRIMARY_PDF_MODEL,
    FALLBACK_PDF_MODEL,
  ]);
  assert.deepEqual(recordedDelays, [2000, 4000, 8000]);
  assert.deepEqual(outcome.result, { tenderId: 'GEM/2026/B/9990001' });
});

test('withTimeout rejects cleanly with TimeoutError when promise stalls', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 15, 'Timed out in test'),
    (err: unknown) => err instanceof TimeoutError && err.message === 'Timed out in test',
  );
});

test('extractJsonObjectFromText parses markdown-wrapped and noisy JSON safely', () => {
  const fenced = '```json\n{"tenderId":"GEM/2026/B/1234","estimatedValue":50000}\n```';
  assert.deepEqual(extractJsonObjectFromText(fenced), {
    tenderId: 'GEM/2026/B/1234',
    estimatedValue: 50000,
  });
  assert.equal(extractJsonObjectFromText('not valid json at all'), null);
});

test('sanitizeExtractErrorMessage strips raw Google/Vercel JSON and HTML errors', () => {
  const raw503 =
    '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}';
  const cleaned503 = sanitizeExtractErrorMessage(raw503, 503);
  assert.equal(cleaned503.includes('{'), false);
  assert.match(cleaned503, /busy/i);

  const rawHtml = '<!DOCTYPE html><html><body>504 Gateway Time-out</body></html>';
  const cleanedHtml = sanitizeExtractErrorMessage(rawHtml, 504);
  assert.equal(cleanedHtml.includes('<'), false);
  assert.match(cleanedHtml, /timeout/i);
});
