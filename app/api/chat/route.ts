import { NextResponse } from 'next/server';

// Proxy chat requests to the Python agent backend and forward its SSE stream.
const AGENT_URL = process.env.AGENT_API_URL ?? 'http://agent:8000';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const upstream = await fetch(`${AGENT_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    // Forward the SSE stream directly to the browser
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new NextResponse(message, { status: 500 });
  }
}
