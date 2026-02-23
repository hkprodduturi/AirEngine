import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { apiRouter } from './api.js';
import { webhookRouter } from './webhooks.js';
import { requireAuth } from './auth.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', apiRouter);
app.use('/webhooks', webhookRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
