import { NextResponse } from 'next/server';
import pg from 'pg';

function getPgClient() {
  return new pg.Client({ connectionString: process.env.POSTGRES_URL });
}

export const revalidate = 0;

export async function GET() {
  const client = getPgClient();
  await client.connect();
  try {
    const result = await client.query<{
      session_id: string;
      transcript: string;
      summary: string | null;
      created_at: string;
    }>(
      `SELECT session_id, transcript, summary, created_at
       FROM session_transcripts
       ORDER BY created_at DESC`,
    );
    return NextResponse.json({ sessions: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end();
  }
}
