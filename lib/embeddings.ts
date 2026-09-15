import { GoogleGenerativeAI } from "@google/generative-ai";
import { TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

// In-memory cache for pre-computed embeddings
let cachedNodeEmbeddings: { id: string; embedding: number[] }[] | null = null;

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);

  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.warn("Failed to generate Gemini embedding, falling back to lexical similarity:", err);
    return null;
  }
}

function nodeToSearchableText(node: TrafficNode): string {
  const routesStr = node.routeOptions
    ? node.routeOptions.map((r) => `${r.name}: ${r.description} (~${r.distanceKm} km, ~${r.baseTimeMins} mins)`).join("; ")
    : "";

  return `${node.name} (${node.area})
Choke points: ${node.chokePoints.join(", ")}
Peak hours: ${node.peakHours}
Traffic patterns: ${node.trafficPatterns}
Route options: ${routesStr}`;
}

// Lightweight lexical score fallback
function calculateLexicalScore(query: string, text: string): number {
  const queryTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const textLower = text.toLowerCase();
  let matches = 0;

  for (const token of queryTokens) {
    if (token.length > 2 && textLower.includes(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(queryTokens.length, 1);
}

export async function searchKnowledgeBase(
  query: string,
  topK: number = 3
): Promise<{ node: TrafficNode; score: number; text: string }[]> {
  const queryEmbedding = await getEmbedding(query);

  if (queryEmbedding) {
    if (!cachedNodeEmbeddings) {
      cachedNodeEmbeddings = [];
      for (const node of nodes) {
        const text = nodeToSearchableText(node);
        const emb = await getEmbedding(text);
        if (emb) {
          cachedNodeEmbeddings.push({ id: node.id, embedding: emb });
        }
      }
    }

    if (cachedNodeEmbeddings.length > 0) {
      const scored = cachedNodeEmbeddings.map((item) => {
        const node = nodes.find((n) => n.id === item.id)!;
        const score = cosineSimilarity(queryEmbedding, item.embedding);
        return { node, score, text: nodeToSearchableText(node) };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    }
  }

  // Fallback: Lexical TF similarity ranking
  const lexicalScored = nodes.map((node) => {
    const text = nodeToSearchableText(node);
    const score = calculateLexicalScore(query, text);
    return { node, score, text };
  });

  return lexicalScored.sort((a, b) => b.score - a.score).slice(0, topK);
}
