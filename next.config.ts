import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'neo4j-driver', '@qdrant/js-client-rest', '@anthropic-ai/sdk', 'openai'],
};

export default nextConfig;
