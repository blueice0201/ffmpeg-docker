import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  composeManifestDocRoute,
  convertRoute,
  convertSequentialRoute,
  convertTaskRoute,
  convertTimelineRoute
} from './schemas';
import { ComposeManifestDocumentationSchema } from './openapi-schemas';
import { parseAndSubmitConvert } from './submit-request';
import {
  COMPOSE_MANIFEST_UPLOAD_NOTES,
  SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE,
  TIMELINE_COMPOSE_MANIFEST_EXAMPLE
} from './openapi-examples';
import { getConvertTask, readConvertTaskOutput } from '~/utils/task-query';

function registerConvertSubmitRoute(
  app: OpenAPIHono,
  route: typeof convertRoute | typeof convertSequentialRoute | typeof convertTimelineRoute,
  expectedMode?: 'sequential' | 'timeline'
) {
  app.openapi(route, async (c) => {
    const result = await parseAndSubmitConvert(c, expectedMode);
    if (!result.ok) {
      return c.json(result.body, result.statusCode);
    }

    return c.json(
      {
        taskId: result.taskId,
        status: result.status
      },
      202
    );
  });
}

export function registerConvertRoutes(app: OpenAPIHono) {
  registerConvertSubmitRoute(app, convertRoute);
  registerConvertSubmitRoute(app, convertSequentialRoute, 'sequential');
  registerConvertSubmitRoute(app, convertTimelineRoute, 'timeline');

  app.openapi(composeManifestDocRoute, (c) => {
    return c.json(
      ComposeManifestDocumentationSchema.parse({
        notes: [...COMPOSE_MANIFEST_UPLOAD_NOTES],
        sequentialExample: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE,
        timelineExample: TIMELINE_COMPOSE_MANIFEST_EXAMPLE,
        composeManifest: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE
      }),
      200
    );
  });

  app.openapi(convertTaskRoute, async (c) => {
    try {
      const { taskId } = c.req.valid('param');
      const { download } = c.req.valid('query');

      if (download === '1') {
        const output = await readConvertTaskOutput(taskId);
        if (!output) {
          const task = await getConvertTask(taskId);
          if (!task) {
            return c.json({ error: 'Task not found' }, 404);
          }
          if (task.status !== 'completed') {
            return c.json({ error: 'Task is not completed yet' }, 409);
          }
          return c.json({ error: 'Output file is not available for download' }, 404);
        }

        return c.body(new Uint8Array(output.buffer), 200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${output.filename}"`
        });
      }

      const task = await getConvertTask(taskId);
      if (!task) {
        return c.json({ error: 'Task not found' }, 404);
      }

      return c.json(task, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Failed to read convert task', message: errorMessage }, 500);
    }
  });
}
