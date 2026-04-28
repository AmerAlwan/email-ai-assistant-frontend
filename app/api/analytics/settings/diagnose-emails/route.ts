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

export async function GET() {
  const report: Record<string, unknown> = {};

  // ── Postgres ───────────────────────────────────────────────────────────────
  const pgClient = getPgClient();
  await pgClient.connect();
  try {
    const fromResult = await pgClient.query<{ from_addr: string; count: string }>(
      `SELECT from_addr, COUNT(*) AS count FROM emails GROUP BY from_addr ORDER BY count DESC LIMIT 30`,
    );
    const toResult = await pgClient.query<{ to_addr: string; count: string }>(
      `SELECT to_addr, COUNT(*) AS count FROM emails GROUP BY to_addr ORDER BY count DESC LIMIT 30`,
    );
    report.postgres_from_addr = fromResult.rows;
    report.postgres_to_addr = toResult.rows;
  } finally {
    await pgClient.end();
  }

  // ── Qdrant emails ──────────────────────────────────────────────────────────
  const qdrant = getQdrant();
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === EMAILS_COLLECTION);
    if (exists) {
      const sample = await qdrant.scroll(EMAILS_COLLECTION, {
        limit: 10,
        with_payload: true,
        with_vector: false,
      });
      report.qdrant_sample = sample.points.map((p) => ({
        sender: (p.payload as Record<string, unknown>)?.sender,
        to: (p.payload as Record<string, unknown>)?.to,
      }));
    } else {
      report.qdrant = 'collection does not exist';
    }
  } catch (err) {
    report.qdrant_error = err instanceof Error ? err.message : String(err);
  }

  // ── Neo4j ──────────────────────────────────────────────────────────────────
  const driver = getNeo4jDriver();
  const neo4jSession = driver.session();
  try {
    const result = await neo4jSession.run(
      `MATCH (u:User) RETURN u.name AS name, u.email AS email, properties(u) AS props`,
    );
    report.neo4j_users = result.records.map((r) => ({
      name: r.get('name'),
      email: r.get('email'),
      props: r.get('props'),
    }));
  } finally {
    await neo4jSession.close();
    await driver.close();
  }

  return NextResponse.json(report);
}
