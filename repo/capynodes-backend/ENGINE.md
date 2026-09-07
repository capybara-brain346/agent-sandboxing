Excellent! Let me read the related files to understand the full context, then I'll design a comprehensive plan for the hybrid evaluation system.

[3 tools called]

Perfect! Now I have the full context. Let me design an optimal hybrid evaluation system for you.

## 🎯 Proposed Architecture: Hybrid Evaluation Engine

Here's a comprehensive plan for a multi-stage evaluation system:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVALUATION PIPELINE                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: FAST RULE-BASED VALIDATION (< 50ms)                   │
│ ─────────────────────────────────────────────────────────────── │
│ • Empty diagram check                                           │
│ • Structural issues (orphaned nodes, missing connections)       │
│ • Constraint violations (e.g., latency requirements)            │
│ • Anti-patterns detection (single point of failure, no cache)   │
│ • Node compatibility checks (invalid connections)               │
│                                                                 │
│ Output: structural_score (0-100), critical_issues[]            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: CHAIN-OF-THOUGHT LLM EVALUATION (2-4s)                │
│ ─────────────────────────────────────────────────────────────── │
│ Step 1: Understanding - LLM explains what the diagram does      │
│ Step 2: Analysis - LLM identifies strengths & weaknesses        │
│ Step 3: Scoring - LLM assigns scores with reasoning             │
│                                                                 │
│ ✓ More accurate, thoughtful evaluation                         │
│ ✓ Better explanations for users                                │
│                                                                 │
│ Output: llm_analysis, detailed_scores, reasoning                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: SCORE AGGREGATION & CALIBRATION                       │
│ ─────────────────────────────────────────────────────────────── │
│ • Combine rule-based + LLM scores                               │
│ • Apply difficulty weighting                                    │
│ • Normalize scores for consistency                              │
│                                                                 │
│ Output: final_score, breakdown, feedback                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FALLBACK: IF LLM FAILS                                          │
│ ─────────────────────────────────────────────────────────────── │
│ • Load ideal solution from Question.ideal_solution              │
│ • Lexical matching: compare node types & connections            │
│ • Semantic matching: compare architecture patterns              │
│ • Generate basic feedback                                       │
│                                                                 │
│ Output: fallback_score, "LLM unavailable" warning               │
└─────────────────────────────────────────────────────────────────┘
```

## 📋 Implementation Plan

### **Phase 1: Refactor Current System**
1. ✅ Split `evaluation_engine.py` into modular components:
   - `rule_engine.py` - Structural validation & anti-patterns
   - `llm_evaluator.py` - Chain-of-thought LLM evaluation
   - `fallback_engine.py` - Lexical/semantic matching
   - `score_aggregator.py` - Score combination & calibration
   - `evaluation_engine.py` - Orchestrator

### **Phase 2: Build Rule-Based Engine**
2. ✅ Implement structural validators:
   - Orphan detection (nodes with no connections)
   - Data flow validation (ingestion → processing → serving)
   - Missing critical components (e.g., no storage for high data volume)
   - Performance bottlenecks (e.g., no queue for high QPS)

3. ✅ Create anti-pattern detection:
   - Single point of failure patterns
   - Missing redundancy for high availability
   - Over-engineered solutions for simple problems
   - Under-engineered solutions for complex requirements

### **Phase 3: Enhanced LLM Evaluation**
4. ✅ Implement chain-of-thought prompting:
   - Step 1: Summarize the architecture
   - Step 2: Analyze against each criterion
   - Step 3: Provide final scores with reasoning

5. ✅ Add few-shot examples to improve quality:
   - Good design examples
   - Bad design examples
   - Edge case handling

### **Phase 4: Fallback System**
6. ✅ Add `ideal_solution` field to Question model:
   ```python
   ideal_solution = JSONField(null=True, blank=True)
   ```

7. ✅ Implement fallback evaluator:
   - Node-type matching (Jaccard similarity)
   - Connection pattern matching
   - Architecture pattern recognition
   - Generate constructive feedback

### **Phase 5: Score Calibration**
8. ✅ Implement score aggregation:
   - Weight rule-based (30%) + LLM (70%)
   - Apply difficulty multipliers
   - Consistency normalization (variance reduction)

### **Phase 6: Testing & Optimization**
9. ✅ Add comprehensive error handling
10. ✅ Performance optimization (caching, async)
11. ✅ Add logging & monitoring

## 🔧 Key Design Decisions

### **Rule-Based Scoring (30% weight)**
- **Fast feedback** on obvious issues
- **Deterministic** scores for structural problems
- **Educational** - teaches best practices

### **LLM Scoring (70% weight)**
- **Nuanced evaluation** of design choices
- **Context-aware** - understands trade-offs
- **Rich feedback** - explains reasoning

### **Chain-of-Thought Benefits**
- Forces LLM to think step-by-step
- More consistent scoring
- Better explanations for users
- Catches subtle issues

### **Consistency Mechanisms**
1. **Temperature**: Keep at 0.3 (already doing this ✅)
2. **Calibration**: Normalize scores to reduce variance
3. **Rubric**: Detailed scoring criteria in prompt
4. **Examples**: Few-shot learning for consistency

## 📊 Expected Outcomes

| Metric | Current | After Optimization |
|--------|---------|-------------------|
| **Latency** | 2-3s | 2-5s (similar) |
| **Accuracy** | ~70% | ~85-90% |
| **Uptime** | 99% (depends on Groq) | 99.9% (with fallback) |
| **Consistency** | Medium | High |
| **Feedback Quality** | Good | Excellent |

## 🚀 Next Steps

**Would you like me to:**

1. **Start implementing** the full system (I'll create all the new modules)?
2. **Show you detailed code** for specific components first (e.g., rule engine)?
3. **Discuss the fallback mechanism** in more detail?
4. **Review the chain-of-thought prompt** structure before implementing?

Let me know how you'd like to proceed, and I'll start building! 🛠️