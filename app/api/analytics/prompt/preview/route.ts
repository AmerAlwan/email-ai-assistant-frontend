import { NextResponse } from 'next/server';

const AGENT_API = process.env.AGENT_API_URL ?? 'http://agent:8000';

export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API}/api/prompt/preview`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
