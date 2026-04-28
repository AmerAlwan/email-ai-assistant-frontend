import { NextResponse } from 'next/server';
import pg from 'pg';
import neo4j from 'neo4j-driver';
import { QdrantClient } from '@qdrant/js-client-rest';

const EMAILS_COLLECTION = 'emails';

function getPgClient() {
  return new pg.Client({ connectionString: process.env.POSTGRES_URL });
}

function getNeo4jDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
  );
}

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export const revalidate = 0;

// POST /api/analytics/settings/reset-sent-emails
export async function POST() {
  const driver = getNeo4jDriver();
  const neo4jSession = driver.session();
  const pgClient = getPgClient();
  await pgClient.connect();

  try {
    // 1. Get the User node email from Neo4j
    const result = await neo4jSession.run(
      'MATCH (u:User) WHERE u.email IS NOT NULL RETURN u.email AS email LIMIT 1',
    );
    const record = result.records[0];

    // Fall back to DEMO_USER_EMAIL if no User node with email exists
    const userEmail: string =
      (record?.get('email') as string | null) ?? process.env.DEMO_USER_EMAIL ?? '';

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Could not determine user email from Neo4j or DEMO_USER_EMAIL' },
        { status: 404 },
      );
    }

    // 2. Delete all emails where from_addr matches the user email (Postgres)
    const del = await pgClient.query(
      'DELETE FROM emails WHERE from_addr = $1',
      [userEmail],
    );

    // 3. Delete matching points from Qdrant by sender field
    let qdrantDeleted = 0;
    try {
      const qdrant = getQdrant();
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some((c) => c.name === EMAILS_COLLECTION);
      if (exists) {
        await qdrant.delete(EMAILS_COLLECTION, {
          filter: {
            must: [{ key: 'sender', match: { value: userEmail } }],
          },
        });
        qdrantDeleted = del.rowCount ?? 0;
      }
    } catch (qdrantErr) {
      const message = qdrantErr instanceof Error ? qdrantErr.message : String(qdrantErr);
      return NextResponse.json({ deleted: del.rowCount, userEmail, qdrant_error: message });
    }

    return NextResponse.json({ deleted: del.rowCount, userEmail, qdrant_deleted: qdrantDeleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await neo4jSession.close();
    await driver.close();
    await pgClient.end();
  }
}
