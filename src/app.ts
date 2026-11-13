import { clerkMiddleware } from '@clerk/express';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import pinoHttp from 'pino-http';

import logger from '../utils/logger';
import categoryRoutes from './routes/category';
import docsRoutes from './routes/docs';
import eventRoutes from './routes/events';
import healthRoutes from './routes/health';
import householdRoutes from './routes/household';
import metaRoutes from './routes/meta';
import pantryRoutes from './routes/pantry';
import planRoutes from './routes/plan';
import recipeRoutes from './routes/recipe';
import shoppingListRoutes from './routes/shopping-list';
import userRoutes from './routes/user';

const app = express();

// Behind the Cloudflare Tunnel / reverse proxy, trust one hop so req.ip and
// rate limiting key off the real client IP (via X-Forwarded-For).
app.set('trust proxy', 1);

// Health check before auth/parsing middleware: it reflects the app's own health
// (DB connectivity) and must work even if Clerk is down or misconfigured.
app.use('/health', healthRoutes);

// General rate limit for all other routes
const generalRateLimit = rateLimit({
    legacyHeaders: false,
    limit: 600,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: 'draft-8',
    windowMs: 15 * 60 * 1000,
});

// SSE streams reconnect over time (proxy timeouts, token refresh, network
// changes), so each reconnect would spend a general-API slot. Give them their
// own generous bucket so the live stream can't starve normal requests (or vice
// versa).
const streamRateLimit = rateLimit({
    legacyHeaders: false,
    limit: 300,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: 'draft-8',
    windowMs: 15 * 60 * 1000,
});

// Restrict CORS to an allowlist when CORS_ORIGINS is set; otherwise allow all (dev).
const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : {}));
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(clerkMiddleware({ debug: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/docs', docsRoutes);
app.use('/meta', metaRoutes);
app.use('/user', generalRateLimit, userRoutes);
app.use('/', generalRateLimit, householdRoutes);
app.use('/', generalRateLimit, recipeRoutes);
app.use('/', generalRateLimit, pantryRoutes);
app.use('/', generalRateLimit, shoppingListRoutes);
app.use('/', generalRateLimit, categoryRoutes);
app.use('/', generalRateLimit, planRoutes);
app.use('/events', streamRateLimit, eventRoutes);

export default app;
