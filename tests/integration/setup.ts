import webpush from 'web-push';

import { assertTestDatabase } from './test-database';

assertTestDatabase(process.env.DATABASE_URL);

// The ingredient parser (Python) and Clerk are mocked in the tests; these only
// satisfy env validation. Push is switched on with a throwaway key pair.
process.env.NLP_PARSER_PATH ??= '/dev/null';
process.env.NLP_PYTHON_PATH ??= '/usr/bin/python3';
process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_integration';
process.env.CLERK_SECRET_KEY ??= 'sk_test_integration';
process.env.OPENAI_API_KEY ??= 'sk-integration';
process.env.LOG_LEVEL ??= 'warn';
const keys = webpush.generateVAPIDKeys();
process.env.APP_URL = 'https://sous.example.test';
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
