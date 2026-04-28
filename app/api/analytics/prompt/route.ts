import { NextRequest, NextResponse } from 'next/server';

const AGENT_API = process.env.AGENT_API_URL ?? 'http://agent:8000';

export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(`${AGENT_API}/api/prompt/agent-instructions`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${AGENT_API}/api/prompt/agent-instructions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
