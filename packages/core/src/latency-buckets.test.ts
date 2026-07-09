import { test } from "node:test";
import assert from "node:assert/strict";
import {
  latencyBucketIndex,
  LATENCY_EDGES_MICROS,
  LATENCY_BUCKET_LABELS,
  NUM_LATENCY_BUCKETS,
} from "./latency-buckets.js";

test("latencyBucketIndex maps durations to the expected bucket", () => {
  assert.equal(latencyBucketIndex(0), 0); // <1ms
  assert.equal(latencyBucketIndex(999), 0);
  assert.equal(latencyBucketIndex(1_000), 1); // edge is exclusive lower -> next bucket
  assert.equal(latencyBucketIndex(1_500), 1); // 1–2ms
  assert.equal(latencyBucketIndex(4_999), 2); // 2–5ms
  assert.equal(latencyBucketIndex(60_000), 6); // 50–100ms
  assert.equal(latencyBucketIndex(2_499_999), 10); // 1–2.5s
  assert.equal(latencyBucketIndex(2_500_000), 11); // ≥2.5s, open-ended
  assert.equal(latencyBucketIndex(9_999_999), 11);
});

test("every edge value lands in the bucket above it (boundaries are lower-exclusive)", () => {
  LATENCY_EDGES_MICROS.forEach((edge, i) => {
    assert.equal(latencyBucketIndex(edge), i + 1);
    assert.equal(latencyBucketIndex(edge - 1), i);
  });
});

test("labels and bucket count line up", () => {
  assert.equal(NUM_LATENCY_BUCKETS, LATENCY_EDGES_MICROS.length + 1);
  assert.equal(LATENCY_BUCKET_LABELS.length, NUM_LATENCY_BUCKETS);
});

test("non-finite durations fall back to the first bucket rather than throwing", () => {
  assert.equal(latencyBucketIndex(NaN), 0);
  assert.equal(latencyBucketIndex(Infinity), 0); // guarded to 0, not classified
});
