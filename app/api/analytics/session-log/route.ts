import { NextRequest, NextResponse } from 'next/server';
import { QdrantClient } from '@qdrant/js-client-rest';

const EVENTS_COLLECTION = 'events';

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
  const offset = searchParams.get('offset') ?? undefined;
  const sessionId = searchParams.get('session_id');

  const qdrant = getQdrant();

  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === EVENTS_COLLECTION);
    if (!exists) {
      return NextResponse.json({ events: [], next_offset: null });
    }

    const filter =
      sessionId
        ? {
            must: [
              { key: 'session_id', match: { value: sessionId } },
            ],
          }
        : undefined;

    const result = await qdrant.scroll(EVENTS_COLLECTION, {
      limit,
      offset: offset ?? undefined,
      with_payload: true,
      with_vector: false,
      filter,
    });

    const events = (result.points ?? []).map((p) => ({
      id: String(p.id),
      session_id: (p.payload as Record<string, unknown>)?.session_id ?? null,
      description: (p.payload as Record<string, unknown>)?.description ?? null,
      timestamp: (p.payload as Record<string, unknown>)?.timestamp ?? null,
      entity_names: (p.payload as Record<string, unknown>)?.entity_names ?? [],
    }));

    return NextResponse.json({
      events,
      next_offset: result.next_page_offset ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
