import { describe, expect, it } from 'vitest';
import {
  ComposeManifestSchema as RuntimeComposeManifestSchema,
  SequentialComposeManifestSchema as RuntimeSequentialSchema,
  TimelineComposeManifestSchema as RuntimeTimelineSchema
} from '@shared/queue/convert/schemas';
import {
  SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE,
  TIMELINE_COMPOSE_MANIFEST_EXAMPLE
} from './openapi-examples';

describe('compose openapi examples', () => {
  it('validates sequential example against runtime schema', () => {
    expect(RuntimeSequentialSchema.safeParse(SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE).success).toBe(true);
    expect(RuntimeComposeManifestSchema.safeParse(SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE).success).toBe(true);
  });

  it('validates timeline example against runtime schema', () => {
    expect(RuntimeTimelineSchema.safeParse(TIMELINE_COMPOSE_MANIFEST_EXAMPLE).success).toBe(true);
    expect(RuntimeComposeManifestSchema.safeParse(TIMELINE_COMPOSE_MANIFEST_EXAMPLE).success).toBe(true);
  });
});
