import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';

// Household scoping (soupi#21): the real app and services against a real
// Postgres with two households, A and B. Every request is made as A's member,
// using B's ids; each must be refused (403 for B's household in the path, 404
// for B's ids under A's household) and must leave B's data exactly as it was.

const auth = vi.hoisted(() => ({ userId: 'it_user_a' }));
vi.mock('@clerk/express', () => ({
    clerkClient: { users: { getUser: vi.fn() } },
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: auth.userId }),
}));
vi.mock('../../src/services/scraper', () => ({ scrapeRecipe: vi.fn(async () => null) }));
// The Python ingredient parser isn't available here; return the saved recipe as is.
vi.mock('../../src/services/ingredient', async () => {
    const { default: prisma } = await import('../../prisma');
    return {
        parseIngredients: (arg: number | { id: number }) =>
            prisma.recipe.findUniqueOrThrow({
                include: { ingredients: true, tags: true },
                where: { id: typeof arg === 'number' ? arg : arg.id },
            }),
    };
});

const { default: prisma } = await import('../../prisma');
const { default: app } = await import('../../src/app');
const { disarmAll } = await import('../../src/services/timer-scheduler');

type Seeded = Awaited<ReturnType<typeof seedHousehold>>;
let A: Seeded;
let B: Seeded;
let server: Server;
let base: string;

async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        method,
    });
    // A live-update stream never ends: report its status and close it.
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
        await res.body?.cancel();
        return { json: undefined, status: res.status };
    }
    const text = await res.text();
    let json: unknown = undefined;
    try {
        json = text ? JSON.parse(text) : undefined;
    } catch {
        json = text;
    }
    return { json, status: res.status };
}

async function resetDatabase() {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

async function seedHousehold(tag: string) {
    const user = await prisma.user.create({
        data: {
            clerkId: `clerk_${tag}`,
            email: `${tag}@example.test`,
            id: `it_user_${tag}`,
            name: tag,
        },
    });
    const household = await prisma.household.create({
        data: {
            joinToken: `JOIN-${tag.toUpperCase()}`,
            members: { connect: { id: user.id } },
            name: `house ${tag}`,
        },
    });
    await prisma.user.update({
        data: { defaultHouseholdId: household.id },
        where: { id: user.id },
    });
    const pantry = await prisma.pantry.create({
        data: { householdId: household.id, isDefault: true, name: 'pantry' },
    });
    const category = await prisma.itemCategory.create({
        data: { name: `category ${tag}`, pantryId: pantry.id, sortOrder: 5 },
    });
    const item = await prisma.pantryItem.create({
        data: {
            categoryId: category.id,
            isInStock: true,
            name: `item ${tag}`,
            pantryId: pantry.id,
        },
    });
    const recipeTag = await prisma.recipeTag.create({
        data: { householdId: household.id, name: `tag ${tag}` },
    });
    const recipe = await prisma.recipe.create({
        data: {
            householdId: household.id,
            ingredients: { create: [{ item: `item ${tag}`, sentence: `1 item ${tag}` }] },
            instructions: ['cook'],
            name: `recipe ${tag}`,
            tags: { connect: { id: recipeTag.id } },
        },
    });
    const plan = await prisma.plan.create({ data: { householdId: household.id } });
    const planDay = await prisma.planDay.create({
        data: { date: null, planId: plan.id, recipes: { connect: { id: recipe.id } } },
    });
    const keys = webpush.generateVAPIDKeys(); // any valid P-256 public key will do
    const subscription = await prisma.pushSubscription.create({
        data: {
            auth: 'YXV0aC1zZWNyZXQ',
            endpoint: `https://web.push.apple.com/it-${tag}`,
            p256dh: keys.publicKey,
            userId: user.id,
        },
    });
    const timer = await prisma.timerAlert.create({
        data: {
            detail: `recipe ${tag}`,
            endsAt: new Date(Date.now() + 3_600_000),
            id: randomUUID(),
            label: 'step 1',
            subscriptionId: subscription.id,
        },
    });
    return {
        category,
        household,
        item,
        pantry,
        plan,
        planDay,
        recipe,
        recipeTag,
        subscription,
        timer,
        user,
    };
}

/** Everything household B owns, to compare before and after each request. */
async function snapshotB() {
    const id = B.household.id;
    return JSON.stringify({
        household: await prisma.household.findUnique({ include: { members: true }, where: { id } }),
        pantries: await prisma.pantry.findMany({
            include: { itemCategories: true, pantryItems: true },
            where: { householdId: id },
        }),
        plans: await prisma.plan.findMany({
            include: { planDays: { include: { recipes: { select: { id: true } } } } },
            where: { householdId: id },
        }),
        push: await prisma.pushSubscription.findMany({
            include: { timers: true },
            where: { userId: B.user.id },
        }),
        recipes: await prisma.recipe.findMany({
            include: { ingredients: true, planDays: { select: { id: true } }, tags: true },
            where: { householdId: id },
        }),
        tags: await prisma.recipeTag.findMany({ where: { householdId: id } }),
        user: await prisma.user.findUnique({ where: { id: B.user.id } }),
    });
}

beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    disarmAll();
    server.close();
    await prisma.$disconnect();
});
beforeEach(async () => {
    disarmAll();
    await resetDatabase();
    A = await seedHousehold('a');
    B = await seedHousehold('b');
    auth.userId = A.user.id;
});

describe("routes with household B in the path are refused to A's member (403)", () => {
    const routes = (): [string, string, unknown?][] => {
        const h = B.household.id;
        const p = B.pantry.id;
        return [
            ['GET', `/events/${h}`],
            ['GET', `/household/${h}/recipes`],
            ['POST', `/household/${h}/recipes`, { name: 'x' }],
            ['POST', `/household/${h}/recipes/from-url?url=https://example.test/r`],
            ['GET', `/household/${h}/recipes/tags`],
            ['GET', `/household/${h}/recipes/scrape?url=https://example.test/r`],
            ['GET', `/household/${h}/recipes/${B.recipe.id}`],
            ['DELETE', `/household/${h}/recipes/${B.recipe.id}`],
            ['POST', `/household/${h}/recipes/${B.recipe.id}/made`, { recipeId: B.recipe.id }],
            ['GET', `/household/${h}/pantry`],
            ['POST', `/household/${h}/pantry/${p}`, { id: B.item.id, name: 'x' }],
            ['GET', `/household/${h}/pantry/${p}/items`],
            ['GET', `/household/${h}/pantry/${p}/items/${B.item.id}`],
            ['DELETE', `/household/${h}/pantry/${p}/items/${B.item.id}`],
            ['GET', `/household/${h}/pantry/${p}/category`],
            ['POST', `/household/${h}/pantry/${p}/category`, { name: 'x' }],
            ['GET', `/household/${h}/pantry/${p}/category/${B.category.id}`],
            ['POST', `/household/${h}/pantry/${p}/category/sort-order`, [B.category.id]],
            ['DELETE', `/household/${h}/pantry/${p}/category/${B.category.id}`],
            ['GET', `/household/${h}/pantry/${p}/shopping-list`],
            ['POST', `/household/${h}/pantry/${p}/shopping-list`, { itemIds: [B.item.id] }],
            ['GET', `/household/${h}/plan`],
            ['POST', `/household/${h}/plan/day`, { date: '2026-12-01', planId: B.plan.id }],
            ['DELETE', `/household/${h}/plan/day/${B.planDay.id}`],
            ['POST', `/household/${h}/plan/day/${B.planDay.id}/recipes`, [B.recipe.id]],
            ['DELETE', `/household/${h}/plan/day/${B.planDay.id}/recipes/${B.recipe.id}`],
        ];
    };

    it('every one returns 403 and changes nothing', async () => {
        const before = await snapshotB();
        const results: string[] = [];
        for (const [method, path, body] of routes()) {
            const { status } = await call(method, path, body);
            results.push(`${status} ${method} ${path}`);
        }
        expect(results.filter((r) => !r.startsWith('403'))).toEqual([]);
        expect(await snapshotB()).toBe(before);
    });
});

describe("B's ids under A's own household are refused, and B is unchanged", () => {
    const attacks = (): {
        body?: unknown;
        method: string;
        name: string;
        path: string;
        status: number;
    }[] => {
        const h = A.household.id;
        const p = A.pantry.id;
        return [
            // recipes
            {
                method: 'GET',
                name: "read B's recipe",
                path: `/household/${h}/recipes/${B.recipe.id}`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "delete B's recipe",
                path: `/household/${h}/recipes/${B.recipe.id}`,
                status: 404,
            },
            {
                body: { id: B.recipe.id, name: 'hijacked' },
                method: 'POST',
                name: "edit B's recipe",
                path: `/household/${h}/recipes`,
                status: 404,
            },
            {
                body: { recipeId: B.recipe.id },
                method: 'POST',
                name: "mark B's recipe made",
                path: `/household/${h}/recipes/${B.recipe.id}/made`,
                status: 404,
            },
            {
                body: { finishedPantryItems: [B.item.id], recipeId: A.recipe.id },
                method: 'POST',
                name: "use up B's pantry item via own recipe",
                path: `/household/${h}/recipes/${A.recipe.id}/made`,
                status: 204,
            },
            {
                body: { lowPantryItems: [B.item.id], recipeId: A.recipe.id },
                method: 'POST',
                name: "mark B's pantry item low via own recipe",
                path: `/household/${h}/recipes/${A.recipe.id}/made`,
                status: 204,
            },
            // pantry
            {
                body: { name: 'x' },
                method: 'POST',
                name: "add an item to B's pantry",
                path: `/household/${h}/pantry/${B.pantry.id}`,
                status: 404,
            },
            {
                body: { id: B.item.id, isInStock: false, name: 'x' },
                method: 'POST',
                name: "edit B's item through own pantry",
                path: `/household/${h}/pantry/${p}`,
                status: 404,
            },
            {
                body: { categoryId: B.category.id, name: 'new item' },
                method: 'POST',
                name: "use B's category on own item",
                path: `/household/${h}/pantry/${p}`,
                status: 404,
            },
            {
                method: 'GET',
                name: "read B's item",
                path: `/household/${h}/pantry/${B.pantry.id}/items/${B.item.id}`,
                status: 404,
            },
            {
                method: 'GET',
                name: "read B's item through own pantry",
                path: `/household/${h}/pantry/${p}/items/${B.item.id}`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "delete B's item",
                path: `/household/${h}/pantry/${B.pantry.id}/items/${B.item.id}`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "delete B's item through own pantry",
                path: `/household/${h}/pantry/${p}/items/${B.item.id}`,
                status: 404,
            },
            // categories
            {
                body: { name: 'x' },
                method: 'POST',
                name: "add a category to B's pantry",
                path: `/household/${h}/pantry/${B.pantry.id}/category`,
                status: 404,
            },
            {
                body: { id: B.category.id, name: 'hijacked' },
                method: 'POST',
                name: "rename B's category through own pantry",
                path: `/household/${h}/pantry/${p}/category`,
                status: 404,
            },
            {
                method: 'GET',
                name: "read B's category",
                path: `/household/${h}/pantry/${B.pantry.id}/category/${B.category.id}`,
                status: 404,
            },
            {
                method: 'GET',
                name: "read B's category through own pantry",
                path: `/household/${h}/pantry/${p}/category/${B.category.id}`,
                status: 404,
            },
            {
                body: [B.category.id],
                method: 'POST',
                name: "reorder B's categories",
                path: `/household/${h}/pantry/${B.pantry.id}/category/sort-order`,
                status: 404,
            },
            {
                body: [B.category.id, A.category.id],
                method: 'POST',
                name: "reorder B's category through own pantry",
                path: `/household/${h}/pantry/${p}/category/sort-order`,
                status: 204,
            },
            {
                method: 'DELETE',
                name: "delete B's category",
                path: `/household/${h}/pantry/${B.pantry.id}/category/${B.category.id}`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "delete B's category through own pantry",
                path: `/household/${h}/pantry/${p}/category/${B.category.id}`,
                status: 404,
            },
            // shopping list
            {
                body: { itemIds: [B.item.id] },
                method: 'POST',
                name: "put B's item on a list",
                path: `/household/${h}/pantry/${B.pantry.id}/shopping-list`,
                status: 404,
            },
            {
                body: { itemIds: [B.item.id] },
                method: 'POST',
                name: "put B's item on own list",
                path: `/household/${h}/pantry/${p}/shopping-list`,
                status: 200,
            },
            // plan
            {
                body: { date: '2026-12-01', planId: B.plan.id },
                method: 'POST',
                name: "add a day to B's plan",
                path: `/household/${h}/plan/day`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "delete B's plan day",
                path: `/household/${h}/plan/day/${B.planDay.id}`,
                status: 404,
            },
            {
                body: [A.recipe.id],
                method: 'POST',
                name: "add own recipe to B's plan day",
                path: `/household/${h}/plan/day/${B.planDay.id}/recipes`,
                status: 404,
            },
            {
                body: [B.recipe.id],
                method: 'POST',
                name: "add B's recipe to own plan day",
                path: `/household/${h}/plan/day/${A.planDay.id}/recipes`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "remove a recipe from B's plan day",
                path: `/household/${h}/plan/day/${B.planDay.id}/recipes/${B.recipe.id}`,
                status: 404,
            },
            // household
            {
                body: { joinToken: 'WRONG-0000' },
                method: 'POST',
                name: 'join B without its code',
                path: `/household/${B.household.id}/join`,
                status: 404,
            },
            // timer alerts (per user)
            {
                body: {
                    detail: 'x',
                    label: 'x',
                    remainingMs: 60_000,
                    subscriptionId: B.subscription.id,
                },
                method: 'PUT',
                name: "start a timer on B's device",
                path: `/timers/${randomUUID()}`,
                status: 404,
            },
            {
                body: {
                    detail: 'x',
                    label: 'x',
                    remainingMs: 60_000,
                    subscriptionId: A.subscription.id,
                },
                method: 'PUT',
                name: "overwrite B's timer",
                path: `/timers/${B.timer.id}`,
                status: 404,
            },
            {
                method: 'DELETE',
                name: "cancel B's timer",
                path: `/timers/${B.timer.id}`,
                status: 204,
            },
            {
                body: { endpoint: B.subscription.endpoint },
                method: 'DELETE',
                name: "unsubscribe B's device",
                path: '/push/subscription',
                status: 204,
            },
        ];
    };

    it('each request gets the expected refusal and leaves B unchanged', async () => {
        const failures: string[] = [];
        for (const attack of attacks()) {
            const before = await snapshotB();
            const { status } = await call(attack.method, attack.path, attack.body);
            if (status !== attack.status)
                failures.push(`${attack.name}: got ${status}, want ${attack.status}`);
            if ((await snapshotB()) !== before)
                failures.push(`${attack.name}: changed household B`);
        }
        expect(failures).toEqual([]);
    });
});

describe("lists never include B's data", () => {
    it("A's reads return only A's rows", async () => {
        const h = A.household.id;
        const p = A.pantry.id;
        const reads: [string, unknown][] = [];
        for (const path of [
            `/household/${h}/recipes`,
            `/household/${h}/recipes/tags`,
            `/household/${h}/pantry`,
            `/household/${h}/pantry/${p}/items`,
            `/household/${h}/pantry/${B.pantry.id}/items`,
            `/household/${h}/pantry/${p}/category`,
            `/household/${h}/pantry/${B.pantry.id}/category`,
            `/household/${h}/pantry/${p}/shopping-list`,
            `/household/${h}/pantry/${B.pantry.id}/shopping-list`,
            `/household/${h}/plan`,
            `/timers?subscriptionId=${B.subscription.id}`,
            `/user`,
        ]) {
            const { json, status } = await call('GET', path);
            expect(status, path).toBe(200);
            reads.push([path, json]);
        }
        const leaked = reads.filter(([, json]) =>
            /\bb\b|it_user_b|JOIN-B|house b/.test(JSON.stringify(json)),
        );
        expect(leaked.map(([path]) => path)).toEqual([]);
        // and A's own data is there, so the check above means something
        expect(JSON.stringify(reads)).toContain('recipe a');
        expect(JSON.stringify(reads)).toContain('item a');
    });
});

describe('controls: the same requests on A’s own ids work', () => {
    it('own reads and writes succeed', async () => {
        const h = A.household.id;
        const p = A.pantry.id;
        const results = [
            await call('GET', `/household/${h}/recipes/${A.recipe.id}`),
            await call('GET', `/household/${h}/pantry/${p}/items/${A.item.id}`),
            await call('GET', `/household/${h}/pantry/${p}/category/${A.category.id}`),
            await call('POST', `/household/${h}/pantry/${p}`, {
                categoryId: A.category.id,
                name: 'new item',
            }),
            await call('POST', `/household/${h}/pantry/${p}/shopping-list`, {
                itemIds: [A.item.id],
            }),
            await call('DELETE', `/household/${h}/plan/day/${A.planDay.id}/recipes/${A.recipe.id}`),
            await call('POST', `/household/${h}/plan/day/${A.planDay.id}/recipes`, [A.recipe.id]),
            await call('DELETE', `/household/${h}/plan/day/${A.planDay.id}`),
            await call('DELETE', `/household/${h}/pantry/${p}/items/${A.item.id}`),
            await call('DELETE', `/timers/${A.timer.id}`),
        ].map((r) => r.status);
        expect(results).toEqual([200, 200, 200, 200, 200, 204, 204, 204, 204, 204]);
        expect(
            (
                await call('POST', `/household/${h}/pantry/${p}/shopping-list`, {
                    itemIds: [B.item.id],
                })
            ).json,
        ).toEqual({ added: 0 });
    });

    it("A's member can subscribe to A's live updates", async () => {
        const controller = new AbortController();
        const res = await fetch(`${base}/events/${A.household.id}`, { signal: controller.signal });
        expect(res.status).toBe(200);
        controller.abort();
    });
});
