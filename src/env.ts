import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
    // Web push for timer alerts: all three set turns it on (services/push-sender.ts).
    APP_URL: z.string().url().optional(),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    CLERK_SECRET_KEY: z.string().min(1),
    DATABASE_URL: z.string().url(),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    NLP_PARSER_PATH: z.string().min(1).optional(),
    NLP_PYTHON_PATH: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
    const missing = Object.keys(result.error.flatten().fieldErrors).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = result.data;
