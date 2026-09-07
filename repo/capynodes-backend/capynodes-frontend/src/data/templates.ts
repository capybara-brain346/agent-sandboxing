import { Node, Edge } from '@xyflow/react';

export interface Template {
  id: string;
  name: string;
  description: string;
  problem: string;
  constraints: {
    targetQPS: string;
    latencyRequirement: string;
    monthlyBudget: string;
    dataVolume: string;
    other: string;
  };
  nodes: Node[];
  edges: Edge[];
}

export const templates: Template[] = [
  {
    id: 'rag-pipeline',
    name: 'RAG Pipeline',
    description: 'Retrieval-Augmented Generation system for Q&A',
    problem: 'Design a Retrieval-Augmented Generation (RAG) system for a customer support chatbot that can answer questions based on company documentation.',
    constraints: {
      targetQPS: '100',
      latencyRequirement: 'p99 < 3s',
      monthlyBudget: '$5,000',
      dataVolume: '10GB documents',
      other: 'Must cite sources',
    },
    nodes: [
      { id: 'client-1', type: 'client', position: { x: 0, y: 200 }, data: { type: 'Web', expectedUsers: 10000 } },
      { id: 'api-gateway-1', type: 'api-gateway', position: { x: 200, y: 200 }, data: { rateLimit: 1000 } },
      { id: 'embedding-1', type: 'embedding-model', position: { x: 400, y: 100 }, data: { modelName: 'text-embedding-3-small', dimension: 1536 } },
      { id: 'pinecone-1', type: 'pinecone', position: { x: 600, y: 100 }, data: { dimension: 1536, metric: 'cosine' } },
      { id: 'llm-1', type: 'llm-api', position: { x: 600, y: 300 }, data: { provider: 'OpenAI', model: 'gpt-4o-mini', tokensPerSec: 100 } },
      { id: 'redis-1', type: 'redis', position: { x: 400, y: 300 }, data: { clusterMode: true, memory: 8 } },
    ],
    edges: [
      { id: 'e1', source: 'client-1', target: 'api-gateway-1', type: 'smoothstep', animated: true },
      { id: 'e2', source: 'api-gateway-1', target: 'embedding-1', type: 'smoothstep', animated: true },
      { id: 'e3', source: 'embedding-1', target: 'pinecone-1', type: 'smoothstep', animated: true },
      { id: 'e4', source: 'pinecone-1', target: 'llm-1', type: 'smoothstep', animated: true },
      { id: 'e5', source: 'api-gateway-1', target: 'redis-1', type: 'smoothstep', animated: true },
      { id: 'e6', source: 'redis-1', target: 'llm-1', type: 'smoothstep', animated: true },
    ],
  },
  {
    id: 'recommendation-system',
    name: 'Recommendation System',
    description: 'E-commerce product recommendation pipeline',
    problem: 'Design a real-time product recommendation system for an e-commerce platform serving personalized recommendations on the homepage and product pages.',
    constraints: {
      targetQPS: '10,000',
      latencyRequirement: 'p99 < 100ms',
      monthlyBudget: '$20,000',
      dataVolume: '1TB user events/day',
      other: 'Must handle cold start',
    },
    nodes: [
      { id: 'client-1', type: 'client', position: { x: 0, y: 200 }, data: { type: 'Web', expectedUsers: 1000000 } },
      { id: 'cdn-1', type: 'cdn', position: { x: 150, y: 200 }, data: { provider: 'CloudFront' } },
      { id: 'lb-1', type: 'load-balancer', position: { x: 300, y: 200 }, data: { type: 'Application (L7)' } },
      { id: 'kafka-1', type: 'kafka', position: { x: 300, y: 50 }, data: { qps: 50000, partitions: 24 } },
      { id: 'feature-store-1', type: 'feature-store', position: { x: 450, y: 200 }, data: { provider: 'Feast', onlineStore: 'Redis' } },
      { id: 'redis-1', type: 'redis', position: { x: 600, y: 100 }, data: { clusterMode: true, memory: 32 } },
      { id: 'model-1', type: 'classification-model', position: { x: 600, y: 300 }, data: { type: 'Multi-class', classes: 1000 } },
      { id: 'triton-1', type: 'triton-server', position: { x: 750, y: 200 }, data: { dynamicBatching: true, gpuCount: 4 } },
      { id: 'spark-1', type: 'spark', position: { x: 450, y: 50 }, data: { executors: 20, mode: 'Streaming' } },
    ],
    edges: [
      { id: 'e1', source: 'client-1', target: 'cdn-1', type: 'smoothstep', animated: true },
      { id: 'e2', source: 'cdn-1', target: 'lb-1', type: 'smoothstep', animated: true },
      { id: 'e3', source: 'lb-1', target: 'kafka-1', type: 'smoothstep', animated: true },
      { id: 'e4', source: 'lb-1', target: 'feature-store-1', type: 'smoothstep', animated: true },
      { id: 'e5', source: 'feature-store-1', target: 'redis-1', type: 'smoothstep', animated: true },
      { id: 'e6', source: 'feature-store-1', target: 'model-1', type: 'smoothstep', animated: true },
      { id: 'e7', source: 'model-1', target: 'triton-1', type: 'smoothstep', animated: true },
      { id: 'e8', source: 'kafka-1', target: 'spark-1', type: 'smoothstep', animated: true },
      { id: 'e9', source: 'spark-1', target: 'feature-store-1', type: 'smoothstep', animated: true },
    ],
  },
  {
    id: 'llm-serving',
    name: 'LLM Serving Platform',
    description: 'High-throughput LLM inference platform',
    problem: 'Design a scalable LLM serving platform that can host multiple fine-tuned models with different latency and cost requirements.',
    constraints: {
      targetQPS: '500',
      latencyRequirement: 'p99 < 2s for standard, < 500ms for fast',
      monthlyBudget: '$100,000',
      dataVolume: '',
      other: 'Multi-tenant, model versioning',
    },
    nodes: [
      { id: 'client-1', type: 'client', position: { x: 0, y: 200 }, data: { type: 'API' } },
      { id: 'api-gateway-1', type: 'api-gateway', position: { x: 150, y: 200 }, data: { rateLimit: 10000 } },
      { id: 'auth-1', type: 'auth', position: { x: 150, y: 50 }, data: { method: 'API Key' } },
      { id: 'rate-limiter-1', type: 'rate-limiter', position: { x: 300, y: 200 }, data: { algorithm: 'Token Bucket', limit: 1000 } },
      { id: 'lb-1', type: 'load-balancer', position: { x: 450, y: 200 }, data: { type: 'Application (L7)' } },
      { id: 'sqs-1', type: 'sqs-queue', position: { x: 600, y: 100 }, data: { type: 'Standard', dlq: true } },
      { id: 'vllm-1', type: 'vllm-server', position: { x: 600, y: 250 }, data: { targetQPS: 200, gpuType: 'A100-80GB', replicas: 4 } },
      { id: 'vllm-2', type: 'vllm-server', position: { x: 600, y: 350 }, data: { targetQPS: 100, gpuType: 'H100', replicas: 2 } },
      { id: 'redis-1', type: 'redis', position: { x: 750, y: 100 }, data: { clusterMode: true, memory: 16 } },
      { id: 'prometheus-1', type: 'prometheus', position: { x: 800, y: 300 }, data: { scrapeInterval: 15 } },
    ],
    edges: [
      { id: 'e1', source: 'client-1', target: 'api-gateway-1', type: 'smoothstep', animated: true },
      { id: 'e2', source: 'api-gateway-1', target: 'auth-1', type: 'smoothstep', animated: true },
      { id: 'e3', source: 'auth-1', target: 'rate-limiter-1', type: 'smoothstep', animated: true },
      { id: 'e4', source: 'rate-limiter-1', target: 'lb-1', type: 'smoothstep', animated: true },
      { id: 'e5', source: 'lb-1', target: 'sqs-1', type: 'smoothstep', animated: true },
      { id: 'e6', source: 'lb-1', target: 'vllm-1', type: 'smoothstep', animated: true },
      { id: 'e7', source: 'lb-1', target: 'vllm-2', type: 'smoothstep', animated: true },
      { id: 'e8', source: 'vllm-1', target: 'redis-1', type: 'smoothstep', animated: true },
      { id: 'e9', source: 'vllm-1', target: 'prometheus-1', type: 'smoothstep', animated: true },
      { id: 'e10', source: 'vllm-2', target: 'prometheus-1', type: 'smoothstep', animated: true },
    ],
  },
  {
    id: 'ml-training',
    name: 'ML Training Pipeline',
    description: 'End-to-end ML training infrastructure',
    problem: 'Design an ML training pipeline for continuous model improvement with experiment tracking, hyperparameter tuning, and automated deployment.',
    constraints: {
      targetQPS: '',
      latencyRequirement: 'Training job < 4 hours',
      monthlyBudget: '$30,000',
      dataVolume: '500GB training data',
      other: 'GPU training, reproducibility',
    },
    nodes: [
      { id: 's3-1', type: 's3-ingestion', position: { x: 0, y: 200 }, data: { dataFormat: 'Parquet' } },
      { id: 'validation-1', type: 'data-validation', position: { x: 150, y: 200 }, data: { tool: 'Great Expectations' } },
      { id: 'feature-1', type: 'feature-engineering', position: { x: 300, y: 200 }, data: { framework: 'Spark ML' } },
      { id: 'airflow-1', type: 'airflow', position: { x: 300, y: 50 }, data: { workers: 4, executor: 'Kubernetes' } },
      { id: 'tuning-1', type: 'hyperparameter-tuning', position: { x: 450, y: 200 }, data: { method: 'Bayesian', trials: 50 } },
      { id: 'training-1', type: 'model-training', position: { x: 600, y: 200 }, data: { framework: 'PyTorch', distributed: true, gpuType: 'A100' } },
      { id: 's3-2', type: 's3-storage', position: { x: 750, y: 200 }, data: { storageClass: 'Standard' } },
      { id: 'sagemaker-1', type: 'sagemaker-endpoint', position: { x: 900, y: 200 }, data: { instanceType: 'ml.g5.xlarge', minInstances: 1 } },
      { id: 'ab-1', type: 'ab-testing', position: { x: 900, y: 50 }, data: { platform: 'LaunchDarkly', trafficSplit: 10 } },
    ],
    edges: [
      { id: 'e1', source: 's3-1', target: 'validation-1', type: 'smoothstep', animated: true },
      { id: 'e2', source: 'validation-1', target: 'feature-1', type: 'smoothstep', animated: true },
      { id: 'e3', source: 'airflow-1', target: 'feature-1', type: 'smoothstep', animated: true },
      { id: 'e4', source: 'feature-1', target: 'tuning-1', type: 'smoothstep', animated: true },
      { id: 'e5', source: 'tuning-1', target: 'training-1', type: 'smoothstep', animated: true },
      { id: 'e6', source: 'training-1', target: 's3-2', type: 'smoothstep', animated: true },
      { id: 'e7', source: 's3-2', target: 'sagemaker-1', type: 'smoothstep', animated: true },
      { id: 'e8', source: 'sagemaker-1', target: 'ab-1', type: 'smoothstep', animated: true },
    ],
  },
];

export const getTemplate = (id: string): Template | undefined => {
  return templates.find((t) => t.id === id);
};
