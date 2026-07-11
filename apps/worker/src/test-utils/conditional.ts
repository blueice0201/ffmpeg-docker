import { describe } from 'vitest';

export const describeIntegration = process.env['TEST_MODE'] === 'integration' ? describe : describe.skip;
