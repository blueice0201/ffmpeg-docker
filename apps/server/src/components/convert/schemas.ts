import { createRoute, z } from '@hono/zod-openapi';
import { ErrorSchema } from '~/utils/schemas';
import {
  ComposeManifestDocumentationSchema,
  composeManifestFieldSchema,
  sequentialManifestFieldSchema,
  timelineManifestFieldSchema
} from './openapi-schemas';

export const ConvertSubmitResponseSchema = z
  .object({
    taskId: z.string().uuid(),
    status: z.literal('queued')
  })
  .openapi('ConvertSubmitResponse');

export const ConvertTaskResultSchema = z
  .object({
    contentType: z.string(),
    filename: z.string(),
    size: z.number().nonnegative(),
    url: z.url().optional(),
    downloadUrl: z.string().optional()
  })
  .openapi('ConvertTaskResult');

export const ConvertTaskResponseSchema = z
  .object({
    taskId: z.string().uuid(),
    status: z.enum(['queued', 'processing', 'completed', 'failed']),
    createdAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    progress: z.number().optional(),
    result: ConvertTaskResultSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
  })
  .openapi('ConvertTaskResponse');

const uploadToS3Field = z
  .enum(['true', 'false'])
  .optional()
  .openapi({
    description: 'Upload result to S3 when STORAGE_MODE=s3 (default false for async binary retention)'
  });

function convertSubmitMultipartSchema(manifestSchema: z.ZodString) {
  return z
    .object({
      manifest: manifestSchema,
      uploadToS3: uploadToS3Field
    })
    .passthrough()
    .describe(
      'Additional multipart fields are asset files. Each assets[].field in manifest must have a matching file upload field.'
    );
}

const convertSubmitRequestBody = {
  content: {
    'multipart/form-data': {
      schema: convertSubmitMultipartSchema(composeManifestFieldSchema())
    }
  },
  required: true as const
};

const convertSubmitResponses = {
  202: {
    content: {
      'application/json': {
        schema: ConvertSubmitResponseSchema
      }
    },
    description: 'Convert task accepted and queued'
  },
  400: {
    content: {
      'application/json': {
        schema: ErrorSchema
      }
    },
    description: 'Invalid manifest or missing assets'
  },
  413: {
    content: {
      'application/json': {
        schema: ErrorSchema
      }
    },
    description: 'Upload size limit exceeded'
  },
  500: {
    content: {
      'application/json': {
        schema: ErrorSchema
      }
    },
    description: 'Failed to queue convert task'
  }
};

export const convertRoute = createRoute({
  method: 'post',
  path: '/convert',
  tags: ['Convert'],
  summary: 'Queue video compose task (sequential or timeline)',
  description:
    'Accepts a compose manifest plus uploaded asset files. Use mode "sequential" or "timeline", or call the mode-specific endpoints below.',
  request: {
    body: convertSubmitRequestBody
  },
  responses: convertSubmitResponses
});

export const convertSequentialRoute = createRoute({
  method: 'post',
  path: '/convert/sequential',
  tags: ['Convert'],
  summary: 'Queue sequential video compose task',
  description:
    'Concatenates video/image/text segments in order. manifest.mode is optional and defaults to "sequential".',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: convertSubmitMultipartSchema(sequentialManifestFieldSchema())
        }
      },
      required: true
    }
  },
  responses: convertSubmitResponses
});

export const convertTimelineRoute = createRoute({
  method: 'post',
  path: '/convert/timeline',
  tags: ['Convert'],
  summary: 'Queue timeline video compose task',
  description:
    'Overlays video/image/text/audio clips on a timeline by start time. manifest.mode is optional and defaults to "timeline".',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: convertSubmitMultipartSchema(timelineManifestFieldSchema())
        }
      },
      required: true
    }
  },
  responses: convertSubmitResponses
});

export const composeManifestDocRoute = createRoute({
  method: 'get',
  path: '/doc/compose-manifest',
  tags: ['Convert'],
  summary: 'Compose manifest schema reference',
  description:
    'Returns compose manifest examples and registers OpenAPI component schemas used by /convert* multipart endpoints.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ComposeManifestDocumentationSchema
        }
      },
      description: 'Compose manifest documentation payload'
    }
  }
});

export const convertTaskRoute = createRoute({
  method: 'get',
  path: '/convert/{taskId}',
  tags: ['Convert'],
  request: {
    params: z.object({
      taskId: z.string().uuid()
    }),
    query: z.object({
      download: z.enum(['0', '1']).optional().openapi({
        description: 'Set to 1 to download the composed MP4 when task is completed'
      })
    })
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ConvertTaskResponseSchema
        },
        'video/mp4': {
          schema: z.string().openapi({ type: 'string', format: 'binary' })
        }
      },
      description: 'Task status JSON, or MP4 binary when download=1 and task is completed'
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      },
      description: 'Task not found'
    },
    409: {
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      },
      description: 'Task not completed yet (when download=1)'
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorSchema
        }
      },
      description: 'Failed to read task'
    }
  }
});
