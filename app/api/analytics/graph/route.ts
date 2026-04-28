import { NextResponse } from 'next/server';
import neo4j from 'neo4j-driver';

function getDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
  );
}

export const revalidate = 0;

export async function GET() {
  const driver = getDriver();
  const session = driver.session();
  try {
    // Fetch all nodes
    const nodesResult = await session.run(
      'MATCH (n) RETURN id(n) AS internalId, labels(n)[0] AS type, properties(n) AS props'
    );
    const nodes = nodesResult.records.map((r) => {
      const props = r.get('props') as Record<string, unknown>;
      const internalId = (r.get('internalId') as { toNumber?: () => number } | number);
      const id = String(typeof internalId === 'object' && internalId !== null && 'toNumber' in internalId
        ? internalId.toNumber!()
        : internalId);
      return {
        id,
        type: r.get('type') as string,
        name: (props.name as string) ?? id,
        info: (props.info as string) ?? null,
        aliases: (props.aliases as string[]) ?? [],
        properties: Object.fromEntries(
          Object.entries(props).filter(([k]) => !['name', 'info', 'aliases', 'email_ids', 'session_ids', 'event_ids'].includes(k))
        ),
      };
    });

    // Fetch all edges
    const edgesResult = await session.run(
      'MATCH (a)-[r]->(b) RETURN id(a) AS fromId, id(b) AS toId, type(r) AS relType, properties(r) AS props'
    );
    const edges = edgesResult.records.map((r, i) => {
      const toNativeId = (v: unknown) => {
        if (typeof v === 'object' && v !== null && 'toNumber' in v) {
          return String((v as { toNumber: () => number }).toNumber());
        }
        return String(v);
      };
      return {
        id: `e${i}`,
        source: toNativeId(r.get('fromId')),
        target: toNativeId(r.get('toId')),
        label: r.get('relType') as string,
        properties: r.get('props') as Record<string, unknown>,
      };
    });

    return NextResponse.json({ nodes, edges });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await session.close();
    await driver.close();
  }
}
