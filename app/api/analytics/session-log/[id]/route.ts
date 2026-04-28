import { NextRequest, NextResponse } from 'next/server';
import { QdrantClient } from '@qdrant/js-client-rest';

const EVENTS_COLLECTION = 'events';

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const qdrant = getQdrant();

  try {
    await qdrant.delete(EVENTS_COLLECTION, {
      points: [id],
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
