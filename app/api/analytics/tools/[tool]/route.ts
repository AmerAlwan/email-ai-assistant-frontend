import { NextRequest, NextResponse } from 'next/server';

const AGENT_API = process.env.AGENT_API_URL ?? 'http://agent:8000';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tool: string }> },
) {
  const { tool } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${AGENT_API}/api/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ detail: String(err) }, { status: 500 });
  }
}
