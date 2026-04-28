import { NextResponse } from 'next/server';
import pg from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';

const EVENTS_COLLECTION = 'events';

function getPgClient() {
  return new pg.Client({ connectionString: process.env.POSTGRES_URL });
}

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export const revalidate = 0;

// POST /api/analytics/settings/reset-sessions
export async function POST() {
  const pgClient = getPgClient();
  await pgClient.connect();
  const qdrant = getQdrant();

  try {
    // 1. Delete all session transcripts from Postgres
    const del = await pgClient.query('DELETE FROM session_transcripts');

    // 2. Delete all events from Qdrant by dropping and recreating the collection
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === EVENTS_COLLECTION);
    if (exists) {
      await qdrant.deleteCollection(EVENTS_COLLECTION);
    }

    return NextResponse.json({ deletedSessions: del.rowCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pgClient.end();
  }
}
