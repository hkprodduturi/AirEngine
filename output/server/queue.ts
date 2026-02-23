// Queue jobs from @queue block
// TODO: Add bull/bullmq or similar queue

export const queueJobs = {
  sendEmail: async (data: unknown) => { /* TODO: !email.send */ },
  generateReport: async (data: unknown) => { /* TODO: !reports.generate */ },
};
