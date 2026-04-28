import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await pool.query(
      `SELECT id, from_addr, to_addr, subject, date, labels, body, thread_id
       FROM emails WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
