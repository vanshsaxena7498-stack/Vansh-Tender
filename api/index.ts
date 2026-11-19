import express, { type Request, type Response } from 'express';
import { apiJsonErrorMiddleware, createApiRouter } from '../server-core.ts';

export const app = express();
app.use(express.json({ limit: '12mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: 'API endpoint not found.' });
});
app.use(apiJsonErrorMiddleware);

export function restoreVercelApiUrl(rawUrl: string, headers: Record<string, string | string[] | undefined>): string {
  const safeUrl = rawUrl || '/';
  const qIdx = safeUrl.indexOf('?');
  const pathPart = qIdx >= 0 ? safeUrl.slice(0, qIdx) : safeUrl;
  const queryPart = qIdx >= 0 ? safeUrl.slice(qIdx + 1) : '';
  const params = new URLSearchParams(queryPart);
  const rewrittenPath = params.get('__api_path');

  if (rewrittenPath) {
    params.delete('__api_path');
    const cleanSubPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    const apiPath = cleanSubPath.startsWith('/api/') || cleanSubPath === '/api'
      ? cleanSubPath
      : `/api${cleanSubPath}`;
    const remainingQs = params.toString();
    return `${apiPath}${remainingQs ? `?${remainingQs}` : ''}`;
  }

  if (pathPart === '/api/index' || pathPart === '/index' || pathPart === '/') {
    const matched =
      (typeof headers['x-matched-path'] === 'string' && headers['x-matched-path']) ||
      (typeof headers['x-invoke-path'] === 'string' && headers['x-invoke-path']) ||
      (typeof headers['x-forwarded-uri'] === 'string' && headers['x-forwarded-uri']) ||
      '';
    if (matched && matched !== '/api/index' && matched !== '/index' && matched !== '/') {
      const cleanMatched = matched.split('?')[0];
      const normalized = cleanMatched.startsWith('/api/')
        ? cleanMatched
        : `/api${cleanMatched.startsWith('/') ? '' : '/'}${cleanMatched}`;
      return `${normalized}${queryPart ? `?${queryPart}` : ''}`;
    }
  }

  return safeUrl;
}

export default function handler(req: Request, res: Response) {
  req.url = restoreVercelApiUrl(req.url, req.headers);
  return app(req, res);
}
