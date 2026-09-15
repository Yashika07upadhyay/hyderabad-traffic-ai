import { GoogleGenerativeAI } from "@google/generative-ai";
import { TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";
import precomputedVectors from "../data/vectors.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];
const vectorStore: { id: string; embedding: number[] }[] = precomputedVectors as {
  id: string;
  embedding: number[];
}[];

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

// Fast query embedding with a strict 1.5s timeout so it never hangs
export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    return null;
  }

  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 1500)
    );

    const embedPromise = (async () => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const result = await model.embedContent(text);
      return result.embedding.values;
    })();

    return await Promise.race([embedPromise, timeoutPromise]);
  } catch (err) {
    return null;
  }
}

// Instant lexical token scoring (0.01ms)
function calculateLexicalScore(query: string, node: TrafficNode): number {
  const q = query.toLowerCase();
  const tokens = q.split(/\W+/).filter((t) => t.length > 2);
  let score = 0;

  const targetText = `${node.name} ${node.area} ${(node.chokePoints || []).join(" ")} ${(node.routeOptions || []).map((r) => r.name).join(" ")}`.toLowerCase();

  for (const token of tokens) {
    if (targetText.includes(token)) score += 2;
  }

  if (node.id.includes("amb") && (q.includes("amb") || q.includes("sarath"))) score += 10;
  if (node.id.includes("dlf") && q.includes("dlf")) score += 10;
  if (node.id.includes("financial") && q.includes("financial")) score += 10;
  if (node.id.includes("cyber") && (q.includes("cyber") || q.includes("mindspace"))) score += 10;

  return score;
}

export async function searchKnowledgeBase(
  query: string,
  topK: number = 2
): Promise<{ node: TrafficNode; score: number }[]> {
  // 1. Try vector cosine similarity over precomputed vector store (instant database lookup)
  const queryEmbedding = await getEmbedding(query);

  if (queryEmbedding && vectorStore.length > 0) {
    const scored = vectorStore.map((item) => {
      const node = nodes.find((n) => n.id === item.id) || nodes[0];
      const score = cosineSimilarity(queryEmbedding, item.embedding);
      return { node, score };
    });

    return scored
      .filter((item) => item.score > 0.72)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // 2. Ultra-fast lexical fallback (<0.1ms)
  const lexicalScored = nodes
    .map((node) => {
      const score = calculateLexicalScore(query, node);
      return { node, score };
    })
    .filter((item) => item.score > 0);

  return lexicalScored.sort((a, b) => b.score - a.score).slice(0, topK);
}
