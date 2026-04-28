import { NextRequest, NextResponse } from 'next/server';
import pg from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';

const EVENTS_COLLECTION = 'events';

function getPgClient() {
  return new pg.Client({ connectionString: process.env.POSTGRES_URL });
}

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const client = getPgClient();
  await client.connect();
  const qdrant = getQdrant();

  try {
    // 1. Delete the session transcript from Postgres
    await client.query('DELETE FROM session_transcripts WHERE session_id = $1', [sessionId]);

    // 2. Delete all events with this session_id from Qdrant
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === EVENTS_COLLECTION);
    if (exists) {
      await qdrant.delete(EVENTS_COLLECTION, {
        filter: {
          must: [{ key: 'session_id', match: { value: sessionId } }],
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end();
  }
}
