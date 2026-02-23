import { Router } from 'express';
import { prisma } from './prisma.js';

export const apiRouter = Router();

apiRouter.post('/auth/login', async (req, res) => {
  try {
    // TODO: implement handler: auth.login
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/auth/register', async (req, res) => {
  try {
    // TODO: implement handler: auth.register
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/users', async (req, res) => {
  try {
    const result = await prisma.user.findMany();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.put('/users/:id', async (req, res) => {
  try {
    const result = await prisma.user.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/workspaces', async (req, res) => {
  try {
    const result = await prisma.workspace.findMany();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/workspaces', async (req, res) => {
  try {
    const result = await prisma.workspace.create({ data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/projects', async (req, res) => {
  try {
    const result = await prisma.project.findMany();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/projects', async (req, res) => {
  try {
    const result = await prisma.project.create({ data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.put('/projects/:id', async (req, res) => {
  try {
    const result = await prisma.project.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.delete('/projects/:id', async (req, res) => {
  try {
    const result = await prisma.project.delete({ where: { id: parseInt(req.params.id) } });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/tasks', async (req, res) => {
  try {
    const result = await prisma.task.findMany();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/tasks', async (req, res) => {
  try {
    const result = await prisma.task.create({ data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.put('/tasks/:id', async (req, res) => {
  try {
    const result = await prisma.task.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.delete('/tasks/:id', async (req, res) => {
  try {
    const result = await prisma.task.delete({ where: { id: parseInt(req.params.id) } });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/tasks/:id/comments', async (req, res) => {
  try {
    const result = await prisma.comment.findMany();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/tasks/:id/comments', async (req, res) => {
  try {
    const result = await prisma.comment.create({ data: req.body });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/stats', async (req, res) => {
  try {
    // TODO: implement handler: ~db.Task.aggregate
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/invite', async (req, res) => {
  try {
    // TODO: implement handler: invite.send
    res.status(501).json({ error: 'Not implemented' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
