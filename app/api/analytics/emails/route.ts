import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const label = searchParams.get('label');
  const search = searchParams.get('search');

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (label) {
      conditions.push(`$${idx} = ANY(labels)`);
      params.push(label);
      idx++;
    }

    if (search) {
      conditions.push(
        `(subject ILIKE $${idx} OR from_addr ILIKE $${idx} OR body ILIKE $${idx})`
      );
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM emails ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, from_addr, to_addr, subject, date, labels,
              LEFT(body, 300) AS body_preview, thread_id
       FROM emails
       ${where}
       ORDER BY date DESC NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return NextResponse.json({ emails: result.rows, total, limit, offset });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
