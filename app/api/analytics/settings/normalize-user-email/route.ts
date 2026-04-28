import { NextResponse } from 'next/server';
import pg from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';

const EMAILS_COLLECTION = 'emails';

function getPgClient() {
  return new pg.Client({ connectionString: process.env.POSTGRES_URL });
}

function getQdrant() {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

export const revalidate = 0;

// POST /api/analytics/settings/normalize-user-email
export async function POST() {
  const canonical = process.env.DEMO_USER_EMAIL;
  if (!canonical) {
    return NextResponse.json({ error: 'DEMO_USER_EMAIL env var is not set' }, { status: 500 });
  }

  // Known aliases that are NOT already canonical
  const ALIASES = [
    'demo-user@gmail.com',
    'demo-user@company.com',
    'me@demo.local',
  ].filter((a) => a !== canonical);

  if (ALIASES.length === 0) {
    return NextResponse.json({ message: 'Nothing to normalize — all aliases match canonical' });
  }

  const pgClient = getPgClient();
  await pgClient.connect();

  try {
    // from_addr is plain TEXT
    const fromResult = await pgClient.query(
      `UPDATE emails SET from_addr = $1 WHERE from_addr = ANY($2::text[])`,
      [canonical, ALIASES],
    );

    // to_addr is TEXT (not TEXT[]) storing array-like strings e.g. "{demo-user@gmail.com}"
    // Use REPLACE() for each alias and LIKE for the WHERE filter
    let setExpr = 'to_addr';
    const likeConditions: string[] = [];
    const params: string[] = [canonical];

    for (let i = 0; i < ALIASES.length; i++) {
      const paramIdx = i + 2;
      setExpr = `replace(${setExpr}, $${paramIdx}, $1)`;
      likeConditions.push(`to_addr LIKE '%' || $${paramIdx} || '%'`);
      params.push(ALIASES[i]);
    }

    const toResult = await pgClient.query(
      `UPDATE emails SET to_addr = ${setExpr} WHERE ${likeConditions.join(' OR ')}`,
      params,
    );

    // ── Qdrant: fix sender and to fields ─────────────────────────────────────
    let qdrantSenderUpdated = 0;
    let qdrantToUpdated = 0;
    const aliasSet = new Set(ALIASES);

    try {
      const qdrant = getQdrant();
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some((c) => c.name === EMAILS_COLLECTION);

      if (exists) {
        let nextOffset: string | number | null = null;
        do {
          const { points, next_page_offset } = await qdrant.scroll(EMAILS_COLLECTION, {
            limit: 100,
            with_payload: true,
            with_vector: false,
            offset: nextOffset ?? undefined,
          });

          for (const point of points) {
            const payload = point.payload as Record<string, unknown>;
            const updates: Record<string, unknown> = {};

            // Fix sender: replace alias with canonical
            const sender = payload.sender as string | null | undefined;
            if (sender && aliasSet.has(sender)) {
              updates.sender = canonical;
            }

            // Fix to: normalize string → array, then replace any alias values
            const rawTo = payload.to;
            let toArr: string[];
            if (Array.isArray(rawTo)) {
              toArr = rawTo as string[];
            } else if (typeof rawTo === 'string') {
              toArr = [rawTo];
            } else {
              toArr = [];
            }

            const newTo = toArr.map((addr) => (aliasSet.has(addr) ? canonical : addr));
            const toNeedsUpdate =
              typeof rawTo === 'string' ||
              newTo.some((addr, i) => addr !== toArr[i]);

            if (toNeedsUpdate) {
              updates.to = newTo;
            }

            if (Object.keys(updates).length > 0) {
              await qdrant.setPayload(EMAILS_COLLECTION, {
                payload: updates,
                points: [point.id as string],
              });
              if ('sender' in updates) qdrantSenderUpdated++;
              if ('to' in updates) qdrantToUpdated++;
            }
          }

          nextOffset = next_page_offset ?? null;
        } while (nextOffset !== null);
      }
    } catch (qdrantErr) {
      // Non-fatal: return Qdrant error alongside Postgres results
      const message = qdrantErr instanceof Error ? qdrantErr.message : String(qdrantErr);
      return NextResponse.json({
        canonical,
        aliases: ALIASES,
        postgres: {
          from_addr_updated: fromResult.rowCount,
          to_addr_updated: toResult.rowCount,
        },
        qdrant_error: message,
      });
    }

    return NextResponse.json({
      canonical,
      aliases: ALIASES,
      postgres: {
        from_addr_updated: fromResult.rowCount,
        to_addr_updated: toResult.rowCount,
      },
      qdrant: {
        sender_updated: qdrantSenderUpdated,
        to_updated: qdrantToUpdated,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pgClient.end();
  }
}
