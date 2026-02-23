import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // TODO: Implement authentication check
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // TODO: Verify token
  next();
}

export function requireRole(role: 'admin' | 'member' | 'viewer') {
  return (req: Request, res: Response, next: NextFunction) => {
    // TODO: Check user role
    next();
  };
}
