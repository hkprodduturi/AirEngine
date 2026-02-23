import { Router } from 'express';
import { prisma } from './prisma.js';

export const webhookRouter = Router();

webhookRouter.post('/stripe/webhook', async (req, res) => {
  // TODO: implement handler: !processStripePayment
  res.status(501).json({ error: 'Not implemented' });
});

webhookRouter.post('/github/webhook', async (req, res) => {
  // TODO: implement handler: !processGithubEvent
  res.status(501).json({ error: 'Not implemented' });
});
