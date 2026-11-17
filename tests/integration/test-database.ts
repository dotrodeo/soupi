/** Refuses anything but a local database whose name ends in "_test": the
 *  integration suite deletes every row. */
export function assertTestDatabase(url: string | undefined): void {
    let parsed: URL;
    try {
        parsed = new URL(url ?? '');
    } catch {
        throw new Error('Integration tests need DATABASE_URL (a local *_test Postgres database)');
    }
    const name = parsed.pathname.replace(/^\//, '');
    const local = ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname);
    if (!local || !name.endsWith('_test')) {
        throw new Error(
            `Refusing to run integration tests against ${parsed.hostname}/${name}: ` +
                'use a local database whose name ends in "_test"',
        );
    }
}
