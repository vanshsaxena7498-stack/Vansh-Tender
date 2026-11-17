import express from 'express';
import { apiJsonErrorMiddleware, createApiRouter } from '../server-core.ts';

const app = express();
app.use(express.json({ limit: '12mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);
app.use(apiJsonErrorMiddleware);

export default app;
