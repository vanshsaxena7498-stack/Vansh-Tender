import express from 'express';
import { createApiRouter } from '../server-core.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
