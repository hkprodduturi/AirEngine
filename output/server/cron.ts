// Cron jobs from @cron block
// TODO: Add node-cron or similar scheduler

export const cronJobs = [
  { name: 'cleanup', schedule: '0 0 * * *', handler: () => { /* TODO: !db.sessions.deleteExpired */ } },
  { name: 'digest', schedule: '0 8 * * *', handler: () => { /* TODO: !email.sendDailyDigest */ } },
];
