import 'dotenv/config';

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  STRIPE_SECRET: process.env.STRIPE_SECRET!,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET!,
  SMTP_HOST: process.env.SMTP_HOST!,
  SMTP_PORT: process.env.SMTP_PORT!,
  PORT: process.env.PORT!,
};

// Validate required environment variables
const required = ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET', 'GITHUB_WEBHOOK_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
