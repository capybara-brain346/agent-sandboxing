import { Node, Edge } from '@xyflow/react';
import { Constraints, EvaluationResult, ApiSettings } from '@/store/editor-store';
import { getNodeDefinition } from '@/data/node-definitions';

interface DiagramData {
  nodes: Node[];
  edges: Edge[];
  problemStatement: string;
  constraints: Constraints;
}

function serializeDiagram(data: DiagramData): string {
  const nodesSummary = data.nodes.map((node) => {
    const definition = getNodeDefinition(node.type || '');
    return {
      id: node.id,
      type: node.type,
      label: definition?.label || node.type,
      category: definition?.category,
      position: node.position,
      properties: node.data,
    };
  });

  const edgesSummary = data.edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    fromHandle: edge.sourceHandle,
    toHandle: edge.targetHandle,
  }));

  return JSON.stringify(
    {
      nodes: nodesSummary,
      connections: edgesSummary,
      nodeCount: nodesSummary.length,
      connectionCount: edgesSummary.length,
    },
    null,
    2
  );
}

function buildPrompt(data: DiagramData): string {
  const diagramJson = serializeDiagram(data);
  
  const constraintsText = [
    data.constraints.targetQPS && `Target QPS: ${data.constraints.targetQPS}`,
    data.constraints.latencyRequirement && `Latency Requirement: ${data.constraints.latencyRequirement}`,
    data.constraints.monthlyBudget && `Monthly Budget: ${data.constraints.monthlyBudget}`,
    data.constraints.dataVolume && `Data Volume: ${data.constraints.dataVolume}`,
    data.constraints.other && `Other: ${data.constraints.other}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `You are an expert AI system design interviewer evaluating a candidate's architecture diagram.

## Problem Statement
${data.problemStatement || 'No problem statement provided. Evaluate the diagram as a general AI/ML system design.'}

## Constraints
${constraintsText || 'No specific constraints provided.'}

## Candidate's Diagram (JSON)
\`\`\`json
${diagramJson}
\`\`\`

## Evaluation Criteria
Evaluate the design on these weighted criteria:
1. **Problem Solution Match (25%)**: Does the design actually solve the specific problem? Are the chosen components relevant?
2. **Scalability (20%)**: Can the system handle the expected load? Are there bottlenecks?
3. **Latency & Performance (20%)**: Will the system meet latency requirements? Are there unnecessary hops?
4. **Cost Efficiency (10%)**: Is the architecture cost-effective? Any over-provisioning?
5. **Reliability & Fault Tolerance (10%)**: Are there single points of failure? Retry/fallback mechanisms?
6. **Completeness & Best Practices (10%)**: Does it follow ML/AI design patterns? Missing components?
7. **Security & Ethics (5%)**: Data privacy, authentication, model bias considerations?

## Response Format
Respond in the following JSON format only (no markdown, no extra text):
{
  "overallScore": <number 0-100>,
  "breakdown": [
    {
      "category": "<category name>",
      "score": <number 0-100>,
      "weight": <weight as decimal>,
      "explanation": "<1-2 sentence explanation>"
    }
  ],
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "improvements": ["<specific improvement referencing nodes/connections>", ...],
  "suggestedSolution": "<brief description of an ideal architecture for this problem>"
}`;
}

async function callOpenAI(prompt: string, settings: ApiSettings): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(prompt: string, settings: ApiSettings): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Anthropic API error');
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callGroq(prompt: string, settings: ApiSettings): Promise<string> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Groq API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGrok(prompt: string, settings: ApiSettings): Promise<string> {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'grok-2-latest',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Grok API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function parseResponse(response: string): EvaluationResult {
  // Try to extract JSON from the response
  let jsonStr = response;
  
  // Handle markdown code blocks
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      overallScore: parsed.overallScore || 0,
      breakdown: parsed.breakdown || [],
      strengths: parsed.strengths || [],
      improvements: parsed.improvements || [],
      suggestedSolution: parsed.suggestedSolution || '',
    };
  } catch {
    throw new Error('Failed to parse evaluation response. The AI returned an invalid format.');
  }
}

export async function evaluateDiagram(
  data: DiagramData,
  settings: ApiSettings
): Promise<EvaluationResult> {
  if (!settings.apiKey) {
    throw new Error('Please provide an API key to evaluate your design.');
  }

  if (data.nodes.length === 0) {
    throw new Error('Please add some nodes to your diagram before evaluating.');
  }

  const prompt = buildPrompt(data);

  let response: string;

  switch (settings.provider) {
    case 'openai':
      response = await callOpenAI(prompt, settings);
      break;
    case 'anthropic':
      response = await callAnthropic(prompt, settings);
      break;
    case 'groq':
      response = await callGroq(prompt, settings);
      break;
    case 'grok':
      response = await callGrok(prompt, settings);
      break;
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }

  return parseResponse(response);
}

export const providerModels: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  grok: ['grok-2-latest', 'grok-2-vision-latest'],
};
