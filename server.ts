import 'dotenv/config';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createApiRouter } from './server-core.ts';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Vansh Tender Software server listening on http://${HOST}:${PORT}`);
  });
}

void startServer();
