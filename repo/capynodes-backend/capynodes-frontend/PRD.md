# Product Requirements Document (PRD) – Revised Scope

## Product Name
AI Design Code Editor (MVP Focus)

## Overview
A standalone web-based node editor for practicing AI/ML system design, built with React Flow. Users build architecture diagrams for given AI system design problems. Upon submission, an evaluation engine provides instant AI-powered feedback based on the diagram and problem constraints.

**Scope Limitation**: This MVP includes **only the frontend editor and client-side evaluation engine**. No user accounts, problem library backend, dashboard, progress tracking, or server-side storage. All evaluation happens client-side via direct LLM API calls.

## Goals
- Deliver a highly polished, intuitive node-based editor specialized for AI/ML system design.
- Provide immediate, detailed AI feedback on submitted diagrams.
- Validate core value proposition: Visual diagramming + automated evaluation for AI system design practice.

## Target Users
- AI/ML engineers practicing system design interviews.
- Anyone wanting to prototype or visualize AI architectures quickly.

## Key Features

### 1. Node-Based Editor (Core Product – Built with React Flow)
- Full-screen immersive canvas.
- Sidebar palette with categorized, searchable nodes.
- Drag-and-drop to add nodes; bezier edges with multiple handles (input/output).
- Smooth interactions: Zoom, pan, minimap, grid snap, auto-routing.
- Undo/redo stack (Ctrl+Z/Y).
- Auto-layout button (dagre/elkjs integration for clean hierarchical layout).
- Node selection: Click to open properties panel (configure throughput, model size, cost estimates, etc.).
- Real-time validation: Visual indicators (e.g., red borders on missing required connections, tooltips for incompatibilities).
- Keyboard shortcuts: Delete, duplicate, multi-select.
- Export options: PNG, SVG, JSON.
- Responsive design (desktop primary; tablet support).

### 2. Nodes Library (AI/ML-Specific)
Custom nodes with icons, category colors, and configurable properties.

| Category            | Example Nodes                                      | Key Configurable Properties                          |
|---------------------|----------------------------------------------------|-----------------------------------------------------|
| Data Ingestion      | Kafka, Kinesis, S3, API Endpoint                   | Expected QPS/TPS, message size                      |
| Storage             | PostgreSQL, DynamoDB, Redis (Cache), Pinecone (Vector DB), Feature Store | Capacity, read/write latency, consistency model     |
| Processing          | Spark, Flink, Batch ETL                            | Parallelism, compute type                           |
| ML Components       | Feature Engineering, Model Training, Fine-Tuning   | Framework, distributed (yes/no)                     |
| Models              | Custom Transformer, LLM API, Quantized Model       | Parameter count, tokens/sec, cost per query         |
| Serving             | vLLM/TGI Server, Sagemaker Endpoint, Batch Inference | Target QPS, latency goal, GPU type                  |
| Scaling/Reliability | Load Balancer, Sharding, Replication, SQS Queue    | Autoscaling rules, failover strategy                |
| Monitoring          | Prometheus, Logging, A/B Testing                   | Key metrics                                         |
| Misc                | Client, CDN, Rate Limiter, Auth                    | Custom notes                                        |

- 50+ core nodes at launch.
- Nodes support multiple input/output handles for data flow.
- Hover tooltips with brief best-practice descriptions.

### 3. Problem Input & Constraints
- Single text area at top for pasting or typing the problem statement.
- Dedicated constraints section (structured inputs):
  - Target QPS/RPS
  - Latency requirement (e.g., p99 < 200ms)
  - Monthly budget estimate
  - Data volume/scale
  - Other (e.g., GDPR compliance, multi-region)
- Constraints displayed prominently during design.

### 4. Evaluation Engine (Client-Side)
- Submit button triggers evaluation.
- Diagram serialized to structured JSON (nodes, edges, positions, properties).
- JSON + problem text + constraints sent directly to LLM API (user provides own API key for OpenAI/Groq/Anthropic/Grok).
- Structured prompt template ensures consistent scoring:
  ```
  You are an expert AI system design interviewer.
  Problem: {problem_text}
  Constraints: {constraints}
  User diagram (JSON): {diagram_json}

  Evaluate on:
  - Scalability (30%)
  - Latency & Performance (25%)
  - Cost Efficiency (15%)
  - Reliability & Fault Tolerance (15%)
  - Completeness & Best Practices (10%)
  - Ethical/Security Considerations (5%)

  Provide:
  - Overall score (0–100)
  - Breakdown per category with explanation
  - Key strengths
  - Critical improvements (reference specific nodes/components)
  - Suggested model solution (high-level description)
  ```
- Feedback displayed in clean, readable panel (collapsible sections).
- Response time target: <15 seconds.
- Retry button if API fails.

### 5. Additional UX Features
- Load/Save local designs (via browser localStorage or file download/upload).
- Template starter diagrams for common patterns (e.g., basic RAG, recommendation pipeline).
- Dark/light mode toggle.
- Onboarding tour for first-time users.

## Tech Stack (Frontend Only)
- Framework: Next.js (App Router) + TypeScript + Tailwind CSS
- Editor: @xyflow/react (React Flow)
- State Management: Zustand or React Context (for diagram state)
- LLM Calls: Direct fetch to user-provided API endpoint (no backend proxy)
- Deployment: Vercel (static + client-side only)

## Out of Scope (Intentionally Excluded)
- User authentication
- Problem library/database
- Multiple saved submissions/history
- Leaderboards, streaks, progress tracking
- Community features
- Server-side evaluation or storage

## Success Metrics (MVP)
- User completion of full design → submit → receive feedback flow
- Average session time >15 minutes
- Qualitative feedback on editor intuitiveness and evaluation accuracy
- GitHub stars / community shares if open-sourced
