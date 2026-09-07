# CapyNodes

## 1. Backend Architecture

CapyNodes follows a hybrid architecture combining a robust Django backend with real-time capabilities via Django Channels and a managed database layer using Supabase (PostgreSQL).

### 1.1 Core Stack
- **Framework**: Django (Python 3.x)
- **Real-time**: Django Channels + Redis (Channel Layer)
- **Database**: PostgreSQL (via Supabase)
- **Task Processing**: Synchronous application code with planned background workers for long-running AI evaluations.

### 1.2 Database Schema Highlights
The system utilizes PostgreSQL JSONB fields extensively to handle the dynamic nature of React Flow diagrams and LLM responses.

| Model | Primary Purpose | Key Fields |
| :--- | :--- | :--- |
| `Question` | Stores system design problems. | `constraints` (JSON), `ideal_solution` (JSON) |
| `Submission` | User diagram submissions. | `diagram` (JSONB), `evaluation_result` (JSONB), `score` |
| `CollaborationSession` | Manages multi-user sync. | `id` (UUID/String), `diagram_state` (JSONB) |
| `LLMCallLog` | Observability for AI calls. | `prompt_tokens`, `completion_tokens`, `latency_ms` |

---

## 2. Real-time Collaboration

The collaboration system enables multiple users to edit the same diagram simultaneously with low-latency updates and cursor tracking.

### 2.1 WebSocket Protocol
Implemented via `CollaborationConsumer` in [consumers.py](file:///home/capybara/code/capynodes/capynodes-backend/api/consumers.py).

- **Connection**: Auth-guarded WebSockets. Users join a room identified by `collab_{session_id}`.
- **State Synchronization (`state_update`)**: 
  - When a user modifies the diagram, the frontend sends the updated state.
  - The backend broadcasts this state to all other participants in the room.
  - The state is persisted to the database asynchronously via `database_sync_to_async`.
- **Cursor Tracking (`cursor_update`)**: 
  - Rapidly broadcasts `(x, y)` coordinates to all participants.
  - These updates are **not** persisted to the database to minimize overhead and latency.

### 2.2 Latency Management
To prevent feedback loops and ensure responsiveness:
1. **Immediate Broadcast**: The backend broadcasts updates before (or while) persisting to the DB.
2. **Sender Filtering**: Consumers ignore their own broadcast messages based on `channel_name` filtering.

---

## 3. AI Evaluation Engine

The "Judge" system is a multi-stage pipeline designed to provide high-accuracy, consistent scoring of system design diagrams.

### 3.1 The Hybrid Pipeline
The engine uses a three-stage approach to balance speed and accuracy:

1.  **Stage 1: Rule-Based Validation** ([rule_engine.py](file:///home/capybara/code/capynodes/capynodes-backend/api/evaluation/rule_engine.py))
    - Detects structural issues (orphaned nodes, missing connections).
    - Checks for anti-patterns (e.g., single point of failure).
    - Fast, deterministic scoring (approx. 30% weight).
2.  **Stage 2: LLM Chain-of-Thought (CoT)** ([llm_evaluator.py](file:///home/capybara/code/capynodes/capynodes-backend/api/evaluation/llm_evaluator.py))
    - **Primary Model**: Qwen 32B (via Groq) for low-latency reasoning.
    - **Process**: The model first summarizes the architecture, identifies strengths/weaknesses, and then assigns scores.
    - **Weight**: Approx. 70% weight.
3.  **Stage 3: Score Aggregation** ([score_aggregator.py](file:///home/capybara/code/capynodes/capynodes-backend/api/evaluation/score_aggregator.py))
    - Normalizes scores across dimensions (Scalability, Performance, Security, etc.).
    - Applies difficulty multipliers based on the question level.

### 3.2 Reproducibility & Hashing
To ensure evaluations are stable:
- **Graph Normalization**: UI-only fields (positions, styles) are stripped. Keys are sorted deterministically.
- **Hashing**: A SHA256 hash is generated from the normalized JSON.
- **Caching**: Future submissions with the same hash can bypass re-evaluation if the prompt/model version hasn't changed.

---

## 4. Observability & Quality Control

A dedicated observability service monitors the health and accuracy of the AI judge.

### 4.1 Streamlit Dashboard
Provides real-time visibility into:
- **Quality Metrics**: Trends in average fidelity and logical correctness.
- **Operational Metrics**: P50/P95 latency of Groq/Qwen calls and daily token costs.
- **Error Tracking**: Visibility into LLM API failures or decoding errors.

### 4.2 Golden Tests
The system maintains a "Golden Set" of curated diagrams with known ideal scores.
- **Regression Testing**: After any prompt change, the regression suite compares new scores against the baseline.
- **Hallucination Monitoring**: Judges like **Gemini 3 Pro/Flash** are used offline to evaluate the primary judge (Qwen) for hallucinations or scoring variance.
