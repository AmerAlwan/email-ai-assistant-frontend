import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import OpenAI from 'openai';
import neo4j from 'neo4j-driver';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Filter, FieldCondition } from '@qdrant/js-client-rest';

// ── Config ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const EMAILS_COLLECTION = 'emails';
const EVENTS_COLLECTION = 'events';
const ENTITIES_COLLECTION = 'entities';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const SEARCH_LIMIT = 20;

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Optional metadata filters for email search.
 * All fields are optional — only provided fields are applied.
 */
export interface EmailSearchFilters {
  sender?: string;
  to?: string;
  thread_id?: string;
  /** One or more labels the email must have (matched with "any of") */
  labels?: string[];
  /** ISO date string — only emails on or after this date */
  date_from?: string;
  /** ISO date string — only emails on or before this date */
  date_to?: string;
}

export interface EmailSearchResult {
  score: number;
  email_id: string | null;
  sender: string | null;
  to: string | null;
  subject: string | null;
  date: string | null;
  thread_id: string | null;
  labels: string[];
  body_preview: string | null;
}

// ── Clients ────────────────────────────────────────────────────────────────

function getQdrantClient(): QdrantClient {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

function getNeo4jDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
  );
}

function isCollectionNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e['status'] === 404) return true;
  const data = e['data'] as Record<string, unknown> | undefined;
  const status = data?.['status'] as Record<string, unknown> | undefined;
  const msg = status?.['error'] ?? e['message'] ?? '';
  return typeof msg === 'string' && msg.toLowerCase().includes("doesn't exist");
}

// ── Embedding ──────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return response.data[0].embedding;
}

// ── Filter builder ─────────────────────────────────────────────────────────

function buildFilter(filters: EmailSearchFilters): Filter | undefined {
  const must: FieldCondition[] = [];

  if (filters.sender) {
    must.push({ key: 'sender', match: { value: filters.sender } });
  }

  if (filters.to) {
    must.push({ key: 'to', match: { value: filters.to } });
  }

  if (filters.thread_id) {
    must.push({ key: 'thread_id', match: { value: filters.thread_id } });
  }

  if (filters.labels && filters.labels.length > 0) {
    // Match any email that has at least one of the requested labels
    must.push({ key: 'labels', match: { any: filters.labels } });
  }

  if (filters.date_from) {
    must.push({ key: 'date', range: { gte: filters.date_from } });
  }

  if (filters.date_to) {
    must.push({ key: 'date', range: { lte: filters.date_to } });
  }

  if (must.length === 0) return undefined;

  return { must } as unknown as Filter;
}
// ── Graph search types ─────────────────────────────────────────────────────

export interface GraphNode {
  name: string;
  type: string;
  info: string;
  aliases: string[];
  properties: Record<string, unknown>;
}

export interface GraphRelationship {
  direction: 'outgoing' | 'incoming';
  type: string;
  node: GraphNode;
}

export interface GraphSearchResult {
  /** The best-matching node from the entities vector search */
  match_score: number;
  node: GraphNode;
  /** All nodes directly connected to the matched node, with their relationship */
  connected: GraphRelationship[];
}
// ── Event types ───────────────────────────────────────────────────────────

/**
 * Optional metadata filters for event search.
 */
export interface EventSearchFilters {
  /** Limit to a specific session */
  session_id?: string;
  /** Only events that involve all of these entity names */
  entity_names?: string[];
  /** ISO datetime — only events on or after this timestamp */
  timestamp_from?: string;
  /** ISO datetime — only events on or before this timestamp */
  timestamp_to?: string;
}

export interface EventSearchResult {
  point_id: string;
  score: number;
  session_id: string | null;
  description: string | null;
  timestamp: string | null;
  entity_names: string[];
}

function buildEventFilter(filters: EventSearchFilters): Filter | undefined {
  const must: FieldCondition[] = [];

  if (filters.session_id) {
    must.push({ key: 'session_id', match: { value: filters.session_id } });
  }

  if (filters.entity_names && filters.entity_names.length > 0) {
    // All listed entity names must appear in the event's entity_names array
    for (const name of filters.entity_names) {
      must.push({ key: 'entity_names', match: { value: name } });
    }
  }

  if (filters.timestamp_from) {
    must.push({ key: 'timestamp', range: { gte: filters.timestamp_from } });
  }

  if (filters.timestamp_to) {
    must.push({ key: 'timestamp', range: { lte: filters.timestamp_to } });
  }

  if (must.length === 0) return undefined;

  return { must } as unknown as Filter;
}

// ── Core search function ───────────────────────────────────────────────────

/**
 * Semantic search over the emails Qdrant collection.
 *
 * Metadata filters are applied server-side BEFORE vector scoring, so only
 * emails matching the filter are candidates for the ANN search.
 *
 * @param query    Natural-language search string (will be embedded)
 * @param filters  Optional structured metadata filters
 * @returns        Up to 20 ranked results
 */
export async function searchEmails(
  query: string,
  filters: EmailSearchFilters = {},
): Promise<EmailSearchResult[]> {
  const qdrant = getQdrantClient();

  const [vector, filter] = await Promise.all([
    embed(query),
    Promise.resolve(buildFilter(filters)),
  ]);

  let results;
  try {
    results = await qdrant.search(EMAILS_COLLECTION, {
      vector,
      limit: SEARCH_LIMIT,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
  } catch (err: unknown) {
    if (isCollectionNotFound(err)) return [];
    throw err;
  }

  return results.map((hit) => {
    const p = (hit.payload ?? {}) as Record<string, unknown>;
    return {
      score: hit.score,
      email_id: (p.email_id as string) ?? null,
      sender: (p.sender as string) ?? null,
      to: (p.to as string) ?? null,
      subject: (p.subject as string) ?? null,
      date: (p.date as string) ?? null,
      thread_id: (p.thread_id as string) ?? null,
      labels: (p.labels as string[]) ?? [],
      body_preview: (p.body_preview as string) ?? null,
    };
  });
}

/**
 * Semantic search over the events Qdrant collection.
 *
 * Metadata filters are applied server-side BEFORE vector scoring.
 *
 * @param query    Natural-language search string (will be embedded)
 * @param filters  Optional structured metadata filters
 * @returns        Up to 20 ranked results
 */
export async function searchEvents(
  query: string,
  filters: EventSearchFilters = {},
): Promise<EventSearchResult[]> {
  const qdrant = getQdrantClient();

  const [vector, filter] = await Promise.all([
    embed(query),
    Promise.resolve(buildEventFilter(filters)),
  ]);

  let results;
  try {
    results = await qdrant.search(EVENTS_COLLECTION, {
      vector,
      limit: SEARCH_LIMIT,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
  } catch (err: unknown) {
    if (isCollectionNotFound(err)) return [];
    throw err;
  }

  return results.map((hit) => {
    const p = (hit.payload ?? {}) as Record<string, unknown>;
    return {
      point_id: String(hit.id),
      score: hit.score,
      session_id: (p.session_id as string) ?? null,
      description: (p.description as string) ?? null,
      timestamp: (p.timestamp as string) ?? null,
      entity_names: (p.entity_names as string[]) ?? [],
    };
  });
}

/**
 * Semantic graph search:
 * 1. Embed the query and find the best-matching entity in Qdrant.
 * 2. Pull that node + all directly connected nodes from Neo4j.
 */
export async function searchGraph(query: string): Promise<GraphSearchResult | null> {
  const qdrant = getQdrantClient();

  // Step 1 — find best entity match via vector search
  let hits;
  try {
    hits = await qdrant.search(ENTITIES_COLLECTION, {
      vector: await embed(query),
      limit: 1,
      with_payload: true,
    });
  } catch (err: unknown) {
    if (isCollectionNotFound(err)) return null;
    throw err;
  }

  if (hits.length === 0) return null;

  const hit = hits[0];
  const matchedName = (hit.payload as Record<string, unknown>)['name'] as string;

  // Step 2 — pull node + neighbours from Neo4j
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n {name: $name})
       OPTIONAL MATCH (n)-[r_out]->(neighbor_out)
       OPTIONAL MATCH (n)<-[r_in]-(neighbor_in)
       RETURN
         n,
         collect(DISTINCT {rel: r_out, node: neighbor_out, dir: 'outgoing'}) AS outgoing,
         collect(DISTINCT {rel: r_in,  node: neighbor_in,  dir: 'incoming'}) AS incoming`,
      { name: matchedName },
    );

    if (result.records.length === 0) return null;

    const rec = result.records[0];
    const rawNode = rec.get('n');

    function toGraphNode(n: typeof rawNode): GraphNode {
      const p = n.properties as Record<string, unknown>;
      return {
        name: (p['name'] as string) ?? '',
        type: n.labels?.[0] ?? 'Entity',
        info: (p['info'] as string) ?? '',
        aliases: (p['aliases'] as string[]) ?? [],
        properties: Object.fromEntries(
          Object.entries(p).filter(([k]) => !['name', 'type', 'info', 'aliases'].includes(k)),
        ),
      };
    }

    const connected: GraphRelationship[] = [];

    for (const entry of rec.get('outgoing') as Record<string, unknown>[]) {
      if (!entry['node']) continue;
      connected.push({
        direction: 'outgoing',
        type: (entry['rel'] as { type: string }).type,
        node: toGraphNode(entry['node']),
      });
    }

    for (const entry of rec.get('incoming') as Record<string, unknown>[]) {
      if (!entry['node']) continue;
      connected.push({
        direction: 'incoming',
        type: (entry['rel'] as { type: string }).type,
        node: toGraphNode(entry['node']),
      });
    }

    return {
      match_score: hit.score,
      node: toGraphNode(rawNode),
      connected,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

// ── Get by ID ──────────────────────────────────────────────────────────────

export interface FullEmail {
  id: string;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  date: string | null;
  body: string | null;
  labels: string[];
  thread_id: string | null;
  raw: unknown;
  seeded_at: string | null;
}

/**
 * Fetch a single email by its ID from Postgres.
 * Returns null if not found.
 */
export async function getEmail(emailId: string): Promise<FullEmail | null> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  try {
    const { rows } = await client.query<FullEmail>(
      'SELECT id, from_addr, to_addr, subject, date, body, labels, thread_id, raw, seeded_at FROM emails WHERE id = $1',
      [emailId],
    );
    return rows[0] ?? null;
  } finally {
    await client.end();
  }
}

export interface FullEvent {
  point_id: string;
  session_id: string | null;
  description: string | null;
  timestamp: string | null;
  entity_names: string[];
}

/**
 * Fetch a single event by its Qdrant point ID.
 * Returns null if the collection doesn't exist or the point is not found.
 */
export async function getEvent(pointId: string): Promise<FullEvent | null> {
  const qdrant = getQdrantClient();
  let points;
  try {
    const result = await qdrant.retrieve(EVENTS_COLLECTION, {
      ids: [pointId],
      with_payload: true,
    });
    points = result;
  } catch (err: unknown) {
    if (isCollectionNotFound(err)) return null;
    throw err;
  }
  if (points.length === 0) return null;
  const p = (points[0].payload ?? {}) as Record<string, unknown>;
  return {
    point_id: pointId,
    session_id: (p['session_id'] as string) ?? null,
    description: (p['description'] as string) ?? null,
    timestamp: (p['timestamp'] as string) ?? null,
    entity_names: (p['entity_names'] as string[]) ?? [],
  };
}

// ── CLI entry-point ────────────────────────────────────────────────────────

const RUN_AS_SCRIPT = true;

if (RUN_AS_SCRIPT) {
  (async () => {
    // ── Toggle which search to run ──────────────────────────────────────
    const MODE: 'emails' | 'events' | 'graph' | 'get_email' | 'get_event' = 'events';
    // ────────────────────────────────────────────────────────────────────

    if (MODE === 'emails') {
      // ── Edit these to test email search ──────────────────────────────
      const query = 'reducing design cost';
      const filters: EmailSearchFilters = {
        // sender: 'billing@acmecorp.com',
        // labels: ['INBOX'],
        // date_from: '2026-04-01',
        // date_to: '2026-04-30',
      };
      // ──────────────────────────────────────────────────────────────────

      console.log(`[emails] Query  : ${query}`);
      console.log(`[emails] Filters: ${JSON.stringify(filters)}`);
      console.log('Searching...\n');

      const results = await searchEmails(query, filters);

      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`${results.length} result(s):\n`);
        for (const r of results.slice(0, 3)) {
          console.log(`  [${r.score.toFixed(4)}] ${r.subject ?? '(no subject)'}`);
          console.log(`          From   : ${r.sender ?? '-'}`);
          console.log(`          To     : ${r.to ?? '-'}`);
          console.log(`          Date   : ${r.date ?? '-'}`);
          console.log(`          Labels : ${r.labels.join(', ') || '-'}`);
          console.log(`          Preview: ${r.body_preview ?? ''}`);
          console.log();
        }
      }
    } else if (MODE === 'events') {
      // ── Edit these to test event search ──────────────────────────────
      const query = 'email sent to Sarah about kickoff meeting';
      const filters: EventSearchFilters = {
        // session_id: 'session-test-001',
        // entity_names: ['Sarah Chen'],
        // timestamp_from: '00:00:00',
        // timestamp_to:   '00:05:00',
      };
      // ──────────────────────────────────────────────────────────────────

      console.log(`[events] Query  : ${query}`);
      console.log(`[events] Filters: ${JSON.stringify(filters)}`);
      console.log('Searching...\n');

      const results = await searchEvents(query, filters);

      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`${results.length} result(s):\n`);
        for (const r of results.slice(0, 5)) {
          console.log(`  [${r.score.toFixed(4)}] ${r.description ?? '(no description)'}`);
          console.log(`          Session  : ${r.session_id ?? '-'}`);
          console.log(`          Timestamp: ${r.timestamp ?? '-'}`);
          console.log(`          Point ID : ${r.point_id ?? '-'}`);
          console.log(`[events] Entities : ${r.entity_names.join(', ') || '-'}`);
          console.log();
        }
      }
    } else if (MODE === 'graph') {
      // ── Edit this to test graph search ───────────────────────────────
      const query = 'Sarah';
      // ──────────────────────────────────────────────────────────────────

      console.log(`[graph] Query: ${query}`);
      console.log('Searching...\n');

      const result = await searchGraph(query);

      if (!result) {
        console.log('No matching node found.');
      } else {
        const n = result.node;
        console.log(`Match [${result.match_score.toFixed(4)}]: [${n.type}] ${n.name}`);
        console.log(`  Info    : ${n.info || '-'}`);
        console.log(`  Aliases : ${n.aliases.join(', ') || '-'}`);
        if (Object.keys(n.properties).length > 0) {
          console.log(`  Props   : ${JSON.stringify(n.properties)}`);
        }
        if (result.connected.length === 0) {
          console.log('  (no connected nodes)');
        } else {
          console.log(`\n  Connected (${result.connected.length}):`);
          for (const c of result.connected) {
            const arrow = c.direction === 'outgoing' ? `--[${c.type}]-->` : `<--[${c.type}]--`;
            console.log(`    ${n.name} ${arrow} [${c.node.type}] ${c.node.name}`);
            console.log(`      Info: ${c.node.info || '-'}`);
          }
        }
      }
    } else if (MODE === 'get_email') {
      // ── Edit this to test getEmail ──────────────────────────────────
      const emailId = 'email-008';
      // ──────────────────────────────────────────────────────────────────

      console.log(`[get_email] ID: ${emailId}`);
      const email = await getEmail(emailId);
      if (!email) {
        console.log('Email not found.');
      } else {
        console.log(`  From   : ${email.from_addr ?? '-'}`);
        console.log(`  To     : ${email.to_addr ?? '-'}`);
        console.log(`  Subject: ${email.subject ?? '-'}`);
        console.log(`  Date   : ${email.date ?? '-'}`);
        console.log(`  Labels : ${email.labels?.join(', ') || '-'}`);
        console.log(`  Body   :\n${email.body ?? '(empty)'}`);
      }
    } else if (MODE === 'get_event') {
      // ── Edit this to test getEvent ──────────────────────────────────
      const pointId = '06308842-3ad1-532e-86e9-89c6ccc3423a';
      // ──────────────────────────────────────────────────────────────────

      console.log(`[get_event] ID: ${pointId}`);
      const event = await getEvent(pointId);
      if (!event) {
        console.log('Event not found.');
      } else {
        console.log(`  Session  : ${event.session_id ?? '-'}`);
        console.log(`  Timestamp: ${event.timestamp ?? '-'}`);
        console.log(`  Entities : ${event.entity_names.join(', ') || '-'}`);
        console.log(`  Desc     : ${event.description ?? '-'}`);
      }
    }
  })().catch((err) => {
    console.error('Search failed:', err);
    process.exit(1);
  });
}
