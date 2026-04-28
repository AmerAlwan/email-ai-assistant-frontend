import { NextResponse } from 'next/server';
import { ingestTranscript } from '@/tools/ingestion';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { transcript, sessionId } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return new NextResponse('transcript is required', { status: 400 });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return new NextResponse('sessionId is required', { status: 400 });
    }

    const result = await ingestTranscript(transcript, sessionId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ingest-transcript]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
