import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

import OpenAI from 'openai';
import neo4j from 'neo4j-driver';
import { QdrantClient } from '@qdrant/js-client-rest';
import pg from 'pg';

// ── Config ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = join(__dirname, 'prompts.json');

const EVENTS_COLLECTION = 'events';
const ENTITIES_COLLECTION = 'entities';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_DIM = 1536;

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphEntity {
  name: string;
  type: string;
  info: string;
  properties: Record<string, unknown>;
  aliases: string[];
}

interface GraphRelationship {
  from: string;
  type: string;
  to: string;
  properties: Record<string, unknown>;
}

interface TranscriptEvent {
  description: string;
  timestamp: string | null;
  entity_names: string[];
}

interface UserPreference {
  key: string;
  value: string;
}

interface Extraction {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  events: TranscriptEvent[];
  user_preferences: UserPreference[];
}

interface ExistingNode {
  type: string;
  name: string;
  info: string;
  aliases: string[];
}

interface ExistingEdge {
  from: string;
  type: string;
  to: string;
}

// ── Prompt loader ──────────────────────────────────────────────────────────

function loadPrompt(field: string): string {
  const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
  const raw = prompts[field];
  if (!raw) throw new Error(`Prompt field '${field}' not found in prompts.json`);
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
  if (!text.trim()) throw new Error(`Prompt field '${field}' is empty`);
  return text.trim();
}

// ── Clients ────────────────────────────────────────────────────────────────

function getPgClient(): pg.Client {
  const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
  return client;
}

function getNeo4jDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
  );
}

function getQdrantClient(): QdrantClient {
  return new QdrantClient({ url: process.env.QDRANT_URL });
}

// ── Postgres helpers ───────────────────────────────────────────────────────

const DEMO_USER_ID = 1;

async function ensureUserPreferencesTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id     INTEGER PRIMARY KEY,
      preferences JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function ensureSessionTranscriptsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS session_transcripts (
      session_id  TEXT PRIMARY KEY,
      transcript  TEXT NOT NULL,
      summary     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function saveSessionTranscript(
  client: pg.Client,
  sessionId: string,
  transcript: string,
  summary: string,
): Promise<void> {
  await client.query(
    `INSERT INTO session_transcripts (session_id, transcript, summary)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id) DO UPDATE
       SET transcript = EXCLUDED.transcript,
           summary    = EXCLUDED.summary`,
    [sessionId, transcript, summary],
  );
}

async function generateSessionSummary(
  openai: OpenAI,
  transcript: string,
): Promise<string> {
  const systemPrompt = loadPrompt('session_summary');
  const response = await openai.chat.completions.create({
    model: 'gpt-5.4-nano',
    max_completion_tokens: 512,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
  });
  return (response.choices[0].message.content ?? '').trim();
}

async function getUserPreferences(client: pg.Client): Promise<UserPreference[]> {
  const { rows } = await client.query<{ preferences: Record<string, string> }>(
    'SELECT preferences FROM user_preferences WHERE user_id = $1',
    [DEMO_USER_ID],
  );
  if (rows.length === 0) return [];
  return Object.entries(rows[0].preferences).map(([key, value]) => ({ key, value }));
}

async function saveUserPreferences(
  client: pg.Client,
  prefs: UserPreference[],
): Promise<void> {
  // Merge new/changed keys into the existing JSONB object
  const patch = Object.fromEntries(prefs.map(({ key, value }) => [key, value]));
  await client.query(
    `INSERT INTO user_preferences (user_id, preferences)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE
       SET preferences = user_preferences.preferences || EXCLUDED.preferences,
           updated_at  = NOW()`,
    [DEMO_USER_ID, JSON.stringify(patch)],
  );
}

// ── Qdrant helpers ─────────────────────────────────────────────────────────

async function ensureEntitiesCollection(qdrant: QdrantClient): Promise<void> {
  const { collections } = await qdrant.getCollections();
  const existing = new Set(collections.map((c) => c.name));
  if (!existing.has(ENTITIES_COLLECTION)) {
    await qdrant.createCollection(ENTITIES_COLLECTION, {
      vectors: { size: VECTOR_DIM, distance: 'Cosine' },
    });
  }
}

/**
 * Embed each entity's name + aliases + info and upsert into the entities collection.
 * Point ID is stable (derived from entity name) so re-runs are idempotent.
 */
async function saveEntitiesToQdrant(
  qdrant: QdrantClient,
  entities: GraphEntity[],
): Promise<void> {
  for (const entity of entities) {
    const name = entity.name?.trim();
    if (!name) continue;
    const info = entity.info?.trim() ?? '';
    const aliases = entity.aliases ?? [];

    // Rich text blob: name + aliases + info for broad semantic coverage
    const parts = [name];
    if (aliases.length > 0) parts.push(`Also known as: ${aliases.join(', ')}`);
    if (info) parts.push(info);
    const text = parts.join('. ');

    const vector = await embed(text);
    const pointId = stableUUID(`entity:${name}`);

    await qdrant.upsert(ENTITIES_COLLECTION, {
      points: [
        {
          id: pointId,
          vector,
          payload: {
            name,
            type: entity.type ?? 'Entity',
            info,
            aliases,
          },
        },
      ],
    });
  }
}

async function ensureEventsCollection(qdrant: QdrantClient): Promise<void> {
  const { collections } = await qdrant.getCollections();
  const existing = new Set(collections.map((c) => c.name));
  if (!existing.has(EVENTS_COLLECTION)) {
    await qdrant.createCollection(EVENTS_COLLECTION, {
      vectors: { size: VECTOR_DIM, distance: 'Cosine' },
    });
  }
}

function stableUUID(input: string): string {
  // Derive a deterministic UUID v5-style from a string using SHA-1
  const hash = createHash('sha1').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

async function embed(text: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return response.data[0].embedding;
}

/**
 * Embed and upsert each event into Qdrant.
 * Returns a map of entity_name → list of event point IDs that involve that entity.
 */
async function saveEventsToQdrant(
  qdrant: QdrantClient,
  events: TranscriptEvent[],
  sessionId: string,
): Promise<Map<string, string[]>> {
  // entityName -> [pointId, ...]
  const entityEventMap = new Map<string, string[]>();

  for (const event of events) {
    const vector = await embed(event.description);
    const pointId = stableUUID(`${sessionId}:${event.description}`);

    await qdrant.upsert(EVENTS_COLLECTION, {
      points: [
        {
          id: pointId,
          vector,
          payload: {
            type: 'event',
            source_type: 'session',
            session_id: sessionId,
            description: event.description,
            timestamp: event.timestamp ?? null,
            entity_names: event.entity_names,
          },
        },
      ],
    });

    for (const entityName of event.entity_names) {
      const existing = entityEventMap.get(entityName) ?? [];
      existing.push(pointId);
      entityEventMap.set(entityName, existing);
    }
  }

  return entityEventMap;
}

/**
 * For each entity involved in events, append the event Qdrant point IDs
 * to that node's event_ids list in Neo4j.
 */
async function stampEventIdsOnNodes(
  session: ReturnType<ReturnType<typeof getNeo4jDriver>['session']>,
  entityEventMap: Map<string, string[]>,
): Promise<void> {
  for (const [entityName, eventIds] of entityEventMap) {
    await session.run(
      `MATCH (n {name: $name})
       SET n.event_ids = apoc.coll.toSet(coalesce(n.event_ids, []) + $eventIds)`,
      { name: entityName, eventIds },
    );
  }
}

// ── Neo4j helpers ──────────────────────────────────────────────────────────

async function getExistingNodes(session: ReturnType<ReturnType<typeof getNeo4jDriver>['session']>): Promise<ExistingNode[]> {
  const result = await session.run(
    'MATCH (n) RETURN labels(n)[0] AS type, n.name AS name, n.info AS info, n.aliases AS aliases',
  );
  return result.records.map((r) => ({
    type: r.get('type') as string,
    name: r.get('name') as string,
    info: (r.get('info') as string) || '',
    aliases: (r.get('aliases') as string[]) || [],
  }));
}

async function getExistingEdges(session: ReturnType<ReturnType<typeof getNeo4jDriver>['session']>): Promise<ExistingEdge[]> {
  const result = await session.run(
    'MATCH (a)-[r]->(b) RETURN a.name AS from_name, type(r) AS rel_type, b.name AS to_name',
  );
  return result.records.map((r) => ({
    from: r.get('from_name') as string,
    type: r.get('rel_type') as string,
    to: r.get('to_name') as string,
  }));
}

async function saveToNeo4j(
  session: ReturnType<ReturnType<typeof getNeo4jDriver>['session']>,
  extraction: Extraction,
  sessionId: string,
): Promise<void> {
  // Ensure fixed User node
  await session.run("MERGE (:User {name: 'User'})");

  for (const entity of extraction.entities) {
    if (entity.name === 'User') continue; // fixed node already ensured above
    const nodeType = entity.type || 'Entity';
    await session.run(
      `MERGE (n:${nodeType} {name: $name})
       SET n += $properties
       SET n.info = $info
       SET n.aliases = apoc.coll.toSet(coalesce(n.aliases, []) + $aliases)
       SET n.session_ids = CASE
         WHEN $sessionId IN coalesce(n.session_ids, []) THEN n.session_ids
         ELSE coalesce(n.session_ids, []) + $sessionId
       END`,
      {
        name: entity.name,
        properties: entity.properties ?? {},
        info: entity.info,
        aliases: entity.aliases,
        sessionId,
      },
    );
  }

  for (const rel of extraction.relationships) {
    const relType = rel.type.toUpperCase().replace(/\s+/g, '_');
    await session.run(
      `MATCH (a {name: $fromName})
       MATCH (b {name: $toName})
       MERGE (a)-[r:${relType}]->(b)
       SET r += $properties`,
      { fromName: rel.from, toName: rel.to, properties: rel.properties ?? {} },
    ).catch((err: unknown) => {
      console.warn(`[saveToNeo4j] skipping relationship ${rel.from} -[${relType}]-> ${rel.to}:`, (err as Error).message);
    });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function ingestTranscript(
  transcript: string,
  sessionId: string,
): Promise<Extraction> {
  const systemPrompt = loadPrompt('transcript_ingestion');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const driver = getNeo4jDriver();
  const pgClient = getPgClient();
  const qdrant = getQdrantClient();

  await pgClient.connect();

  const neo4jSession = driver.session();

  try {
    await ensureUserPreferencesTable(pgClient);
    await ensureSessionTranscriptsTable(pgClient);
    await ensureEventsCollection(qdrant);
    await ensureEntitiesCollection(qdrant);

    // Load current state to pass to LLM
    // Neo4j session cannot run concurrent transactions — run sequentially
    const existingNodes = await getExistingNodes(neo4jSession);
    const existingEdges = await getExistingEdges(neo4jSession);
    const currentPrefs = await getUserPreferences(pgClient);

    const userMessage = [
      'Extract entities, relationships, events, and user preferences from this session transcript:',
      '',
      transcript,
      '',
      '---',
      'Existing graph nodes (deduplicate against these — match by name and aliases):',
      existingNodes.length ? JSON.stringify(existingNodes, null, 2) : '(none yet)',
      '',
      '---',
      'Existing graph edges (omit any identical from/type/to triple already listed here):',
      existingEdges.length ? JSON.stringify(existingEdges, null, 2) : '(none yet)',
      '',
      '---',
      'Current user preferences (return only new or changed keys):',
      currentPrefs.length ? JSON.stringify(currentPrefs, null, 2) : '(none yet)',
    ].join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-nano',
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    let raw = (response.choices[0].message.content ?? '').trim();
    if (raw.startsWith('```')) {
      raw = raw.split('\n').slice(1).join('\n');
      raw = raw.slice(0, raw.lastIndexOf('```')).trim();
    }

    const extraction: Extraction = JSON.parse(raw);

    // Persist everything
    await saveToNeo4j(neo4jSession, extraction, sessionId);
    console.log(`[${sessionId}] saved ${extraction.entities.length} entities, ${extraction.relationships.length} relationships to Neo4j`);

    await saveEntitiesToQdrant(qdrant, extraction.entities);
    console.log(`[${sessionId}] upserted ${extraction.entities.length} entity vector(s) to Qdrant`);

    const entityEventMap = await saveEventsToQdrant(qdrant, extraction.events, sessionId);
    console.log(`[${sessionId}] embedded and saved ${extraction.events.length} events to Qdrant`);

    await stampEventIdsOnNodes(neo4jSession, entityEventMap);
    console.log(`[${sessionId}] stamped event IDs onto ${entityEventMap.size} node(s) in Neo4j`);

    if (extraction.user_preferences.length > 0) {
      await saveUserPreferences(pgClient, extraction.user_preferences);
      console.log(`[${sessionId}] saved ${extraction.user_preferences.length} user preference(s) to Postgres`);
    }

    const summary = await generateSessionSummary(openai, transcript).catch((err) => {
      console.error(`[${sessionId}] generateSessionSummary failed:`, err);
      return '(summary unavailable)';
    });
    await saveSessionTranscript(pgClient, sessionId, transcript, summary).catch((err) => {
      console.error(`[${sessionId}] saveSessionTranscript failed:`, err);
    });
    console.log(`[${sessionId}] saved transcript and summary to Postgres`);

    return extraction;
  } finally {
    await neo4jSession.close();
    await driver.close();
    await pgClient.end();
  }
}

// ── CLI entry-point ────────────────────────────────────────────────────────
// Run directly:  node --loader ts-node/esm tools/ingestion.ts [transcript.txt] [sessionId]
// or:            npx tsx tools/ingestion.ts [transcript.txt] [sessionId]

const RUN_AS_SCRIPT = false;

if (RUN_AS_SCRIPT) {
  (async () => {
    const transcriptFile = process.argv[2] ?? join(__dirname, 'test_transcript.txt');
    const sessionId = process.argv[3] ?? `session-${Date.now()}`;

    console.log(`Reading transcript from: ${transcriptFile}`);
    console.log(`Session ID: ${sessionId}`);

    const transcript = readFileSync(transcriptFile, 'utf-8');

    console.log('\n--- Starting ingestion ---\n');
    const result = await ingestTranscript(transcript, sessionId);

    console.log('\n--- Ingestion complete ---');
    console.log(`  Entities   : ${result.entities.length}`);
    console.log(`  Relationships: ${result.relationships.length}`);
    console.log(`  Events     : ${result.events.length}`);
    console.log(`  Preferences: ${result.user_preferences.length}`);

    if (result.entities.length > 0) {
      console.log('\nEntities:');
      for (const e of result.entities) {
        console.log(`  [${e.type}] ${e.name} — ${e.info}`);
      }
    }

    if (result.user_preferences.length > 0) {
      console.log('\nUser preferences:');
      for (const p of result.user_preferences) {
        console.log(`  ${p.key} = ${p.value}`);
      }
    }
  })().catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
}
