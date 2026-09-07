import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "capynodes_backend.settings")
django.setup()

from api.models import Question


def seed():
    questions = [
        {
            "title": "Design a High-Throughput Tokenizer & Preprocessing Service",
            "description": "Design a system that prepares massive raw datasets for LLM training. The system must handle petabytes of raw text and code, perform language detection, remove duplicates at scale, and convert text into tokenized sequences using various strategies (BPE, WordPiece). It must ensure that the output is optimally packed for GPU memory efficiency.",
            "difficulty": "Advanced",
            "category": "Data Engineering",
            "constraints": {
                "targetQPS": "Process 500,000 documents/sec",
                "latencyRequirement": "End-to-end processing pipeline < 1 hour for 1TB chunk",
                "dataVolume": "10 PB total corpus",
                "other": "Must support custom vocabulary mapping and 'Special Token' injection.",
            },
        },
        {
            "title": "Design a Real-time AI Voice Assistant Backend",
            "description": "Design a low-latency system that enables human-like voice interaction. The system must orchestrate three main components: Automatic Speech Recognition (ASR), a Large Language Model (LLM), and Text-to-Speech (TTS). It must handle 'interruptions' (if the user speaks while the AI is talking) and manage conversational state across multiple turns.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "50,000 concurrent voice sessions",
                "latencyRequirement": "< 500ms total 'glass-to-glass' latency",
                "other": "Must handle background noise cancellation and speaker diarization.",
            },
        },
        {
            "title": "Design a Prompt Engineering & Management Platform",
            "description": "Design an enterprise-grade platform for managing, versioning, and testing LLM prompts. The system must support 'Prompt A/B Testing', allow users to run 'Golden Dataset' evaluations to see how prompt changes affect model output, and provide a proxy layer for caching common prompt/response pairs to save costs.",
            "difficulty": "Intermediate",
            "category": "MLOps",
            "constraints": {
                "targetQPS": "5,000 proxy requests/sec",
                "latencyRequirement": "< 50ms overhead for the proxy layer",
                "other": "Must include Role-Based Access Control (RBAC) for sensitive system prompts.",
            },
        },
        {
            "title": "Design a Distributed Graph Neural Network (GNN) System",
            "description": "Design a system to train and serve a GNN for a social network with billions of nodes and edges. The system must handle graph partitioning across multiple machines, manage neighborhood sampling for mini-batch training, and provide real-time embeddings for fraud detection or friend recommendations.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "10,000 embedding lookups/sec",
                "latencyRequirement": "< 100ms for neighborhood aggregation",
                "dataVolume": "5 Billion nodes, 100 Billion edges",
                "other": "Must support dynamic graph updates (new edges/nodes) in near real-time.",
            },
        },
        {
            "title": "Design an AI Image Generation API (Stable Diffusion/Flux scale)",
            "description": "Design a scalable service for text-to-image generation. The system must handle large model weights (5GB-20GB+), manage a GPU worker pool with different VRAM capacities, provide a way for users to track generation progress via WebSockets, and implement a safety filter for generated content.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000 images generated per minute",
                "latencyRequirement": "< 5s for a standard 512x512 generation",
                "other": "Must support LoRA (Low-Rank Adaptation) weights dynamically loaded per request.",
            },
        },
        {
            "title": "Design a Distributed Vector Indexing Service",
            "description": "Design a system to build and update massive vector indices (HNSW, IVF-PQ) for a large-scale search engine. The system must handle incremental updates without taking the search service offline and must be able to re-index billions of vectors periodically to maintain recall accuracy.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "20,000 index updates/sec",
                "latencyRequirement": "New vectors searchable within 60s",
                "dataVolume": "50 Billion vectors (1536-dim)",
                "other": "Must support 'hot' and 'cold' storage tiers for cost efficiency.",
            },
        },
        {
            "title": "Design a Collaborative AI Workspace (Real-time)",
            "description": "Design the backend for a collaborative platform (like a shared AI Notebook or Canvas) where multiple users interact with an LLM simultaneously. The system must handle real-time state synchronization, operational transformation for text, and streaming LLM token delivery to multiple clients with low jitter.",
            "difficulty": "Intermediate",
            "category": "Software Architecture",
            "constraints": {
                "targetQPS": "10,000 concurrent active editors",
                "latencyRequirement": "< 50ms for local state sync",
                "other": "Must support 'branching' and 'merging' of AI-generated content versions.",
            },
        },
        {
            "title": "Design a Video Understanding & Event Detection System",
            "description": "Design a system for a security company that processes thousands of live camera feeds. The system must detect specific events (e.g., 'intruder detected', 'fire') in real-time, generate short text summaries of activities, and provide a searchable index of historical video clips based on visual content.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "5,000 concurrent 1080p video streams",
                "latencyRequirement": "< 1s from event occurrence to alert",
                "dataVolume": "10 PB of video storage per month",
                "other": "Must implement edge-cloud hybrid inference to save bandwidth.",
            },
        },
        {
            "title": "Design an Automated Dataset Labeling Platform",
            "description": "Design a platform that uses 'Active Learning' to label massive unlabelled datasets. The system should identify the most 'informative' samples for human labelers, use a teacher-student model to auto-label high-confidence samples, and manage the workflow between human annotators and AI models.",
            "difficulty": "Beginner",
            "category": "MLOps",
            "constraints": {
                "targetQPS": "Support 5,000 human annotators concurrently",
                "latencyRequirement": "Auto-labeling throughput of 1M items/hour",
                "other": "Must track inter-annotator agreement and labeler reputation.",
            },
        },
        {
            "title": "Design a Large-Scale Ad Click Prediction System",
            "description": "Design a high-throughput system to predict the Click-Through Rate (CTR) for billions of ad impressions. The system needs to handle massive categorical features (high cardinality), perform real-time feature extraction, and update model weights frequently based on user feedback loops.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000,000 predictions/sec",
                "latencyRequirement": "< 20ms P99 for inference",
                "dataVolume": "100 TB of log data generated per day",
                "other": "Must handle 'Cold Start' problem for new ads and new users.",
            },
        },
        {
            "title": "Design a Real-time Feature Store",
            "description": "Design a centralized repository to store, update, and serve machine learning features for both online inference and offline training. The system must solve the 'online-offline skew' problem, support point-in-time joins for backfilling, and allow data scientists to define features using a declarative framework.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "500,000 read requests/sec (Online)",
                "latencyRequirement": "< 10ms P99 for feature retrieval",
                "dataVolume": "Petabyte-scale historical data",
                "other": "Support streaming updates from Kafka/Flink and batch updates from Snowflake/S3.",
            },
        },
        {
            "title": "Design a Distributed Web Crawler for LLM Pre-training",
            "description": "Design a high-throughput web crawling system specifically optimized for gathering high-quality text data for LLM training. The system must handle URL frontier management, deduplication (exact and fuzzy), polite crawling constraints, and an automated cleaning pipeline to strip HTML and extract high-signal prose.",
            "difficulty": "Advanced",
            "category": "Data Engineering",
            "constraints": {
                "targetQPS": "10,000 pages crawled per second",
                "latencyRequirement": "Continuous operation 24/7",
                "dataVolume": "100 Billion unique URLs",
                "other": "Must detect and filter low-quality 'SEO spam' and non-informative content automatically.",
            },
        },
        {
            "title": "Design an AI-Powered Personal Search Engine",
            "description": "Design a system that allows users to search across their personal cloud data (Emails, Slack, Notion, Google Drive). The system must handle private data indexing, respect granular permission models (ACLs), and use a re-ranking model to provide personalized results based on user context.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "2,000 search queries/sec",
                "latencyRequirement": "< 300ms for end-to-end search",
                "dataVolume": "Average 100,000 documents per user for 10M users",
                "other": "Search index must be updated within 30 seconds of a document change.",
            },
        },
        {
            "title": "Design a Global Model Monitoring and Observability Service",
            "description": "Design a platform to monitor thousands of deployed ML models in production. The system should track performance metrics (accuracy, F1 score) and data distributions to detect 'Model Drift' and 'Feature Drift'. It must trigger alerts and automated retraining workflows when statistical anomalies are detected.",
            "difficulty": "Intermediate",
            "category": "MLOps",
            "constraints": {
                "targetQPS": "Ingest 1 Million prediction logs/sec",
                "latencyRequirement": "< 1 minute for drift detection alerting",
                "other": "Support 'Ground Truth' delayed ingestion for post-hoc accuracy calculation.",
            },
        },
        {
            "title": "Design a Serverless GPU Inference Platform",
            "description": "Design a cloud platform that allows developers to deploy AI models as serverless functions. The system must handle 'Cold Starts' effectively by optimizing model loading times, implement smart GPU sharing (Spatial/Temporal partitioning), and automatically scale from zero to thousands of nodes based on incoming traffic.",
            "difficulty": "Advanced",
            "category": "Infrastructure",
            "constraints": {
                "targetQPS": "Variable (0 to 10,000 req/sec)",
                "latencyRequirement": "Cold start < 2 seconds; warm start < 50ms overhead",
                "other": "Support multi-tenant isolation and diverse hardware (NVIDIA A100s, T4s, and L4s).",
            },
        },
        {
            "title": "Design a Scalable RAG System for Enterprise Docs",
            "description": "Design a Retrieval Augmented Generation (RAG) system that can index millions of enterprise documents and provide accurate answers using an LLM. Must handle various document formats and provide semantic search.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "10 queries/sec",
                "latencyRequirement": "< 2s for response",
                "dataVolume": "1,000,000 documents",
            },
        },
        {
            "title": "Design a Content Moderation Service",
            "description": "Design a service that automatically moderates user-uploaded images and text using AI models. Must be able to flag NSFW content, hate speech, and spam.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "500 requests/sec",
                "latencyRequirement": "< 500ms per moderation",
                "other": "Must support multi-lingual text",
            },
        },
        {
            "title": "Design an LLM Inference Serving System",
            "description": "Design a system to serve large language models (LLMs) at scale with low latency. Must handle request batching, model quantization, GPU resource management, and support multiple model variants.",
            "difficulty": "Begineer",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000 requests/sec",
                "latencyRequirement": "< 200ms p95 latency",
                "monthlyBudget": "$20,000",
                "other": "Must support models up to 70B parameters",
            },
        },
        {
            "title": "Design a Vector Database for Embeddings",
            "description": "Design a vector database system that can store and retrieve high-dimensional embeddings efficiently. Must support similarity search, indexing strategies, and handle billions of vectors.",
            "difficulty": "Begineer",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "50,000 queries/sec",
                "latencyRequirement": "< 10ms for nearest neighbor search",
                "dataVolume": "10 billion 768-dimensional vectors",
            },
        },
        {
            "title": "Design a Model Training Pipeline",
            "description": "Design a distributed training pipeline for deep learning models that can handle large datasets, checkpoint management, hyperparameter tuning, and experiment tracking.",
            "difficulty": "Begineer",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "Process 1TB dataset in 24 hours",
                "latencyRequirement": "Support training jobs up to 7 days",
                "monthlyBudget": "$30,000",
                "other": "Must support multi-GPU and multi-node training",
            },
        },
        {
            "title": "Design a Recommendation System",
            "description": "Design a machine learning-based recommendation system that provides personalized content recommendations. Must handle real-time feature computation, model serving, and A/B testing.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "100,000 recommendations/sec",
                "latencyRequirement": "< 50ms for recommendation generation",
                "dataVolume": "100 million users, 1 billion items",
            },
        },
        {
            "title": "Design a Computer Vision Pipeline",
            "description": "Design a system that processes images and videos using computer vision models. Must handle image preprocessing, model inference, post-processing, and support multiple CV tasks (detection, classification, segmentation).",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "5,000 images/sec",
                "latencyRequirement": "< 100ms per image",
                "dataVolume": "100 million images/month",
            },
        },
        {
            "title": "Design an MLOps Platform",
            "description": "Design an MLOps platform that manages the complete ML lifecycle including data versioning, model versioning, deployment pipelines, monitoring, and rollback capabilities.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "Support 1,000 concurrent training jobs",
                "latencyRequirement": "< 5 minutes for model deployment",
                "other": "Must support model drift detection and automatic retraining",
            },
        },
        {
            "title": "Design a Multi-modal AI System",
            "description": "Design a system that processes and combines multiple modalities (text, images, audio, video) using AI models. Must handle synchronization, feature fusion, and provide unified embeddings.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000 multi-modal requests/sec",
                "latencyRequirement": "< 500ms for processing",
                "other": "Must support real-time streaming inputs",
            },
        },
        {
            "title": "Design a Fine-tuning Service for LLMs",
            "description": "Design a service that enables fine-tuning of large language models on custom datasets. Must handle dataset management, distributed fine-tuning, model versioning, and deployment of fine-tuned models.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "Support 100 concurrent fine-tuning jobs",
                "latencyRequirement": "Complete fine-tuning in 24 hours for 1M samples",
                "monthlyBudget": "$40,000",
                "other": "Must support LoRA and full fine-tuning",
            },
        },
        {
            "title": "Object Detection System",
            "description": "Design a high-performance system for real-time object detection in video streams (e.g., for retail analytics or security). The system must handle multiple concurrent streams, perform object tracking across frames, and provide an API for querying historical detections.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "1,000 frames/sec",
                "latencyRequirement": "< 50ms per frame",
                "other": "Must support over 80 object classes (COCO dataset scale).",
            },
        },
        {
            "title": "Facial Recognition Attendance System",
            "description": "Design a secure and scalable facial recognition system for employee attendance. The system must handle high-resolution image uploads, perform face embedding extraction, and match against a database of thousands of employees with high precision.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "100 identification requests/sec",
                "latencyRequirement": "< 200ms for identification",
                "other": "Must be resilient to 'spoofing' attacks (photos/videos).",
            },
        },
        {
            "title": "License Plate Recognition",
            "description": "Design an automated system for reading license plates from high-speed traffic cameras. The system must handle various lighting conditions, weather, and plate formats across different regions, providing high-accuracy OCR results in real-time.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "500 plates/sec",
                "latencyRequirement": "< 100ms from capture to result",
                "other": "Must handle vehicle speeds up to 150 km/h.",
            },
        },
        {
            "title": "Hand Gesture Recognition",
            "description": "Design a low-latency hand gesture recognition system for touchless UI control. The system should detect and classify complex hand movements from a standard webcam feed and map them to system commands with high reliability.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "60 fps processing",
                "latencyRequirement": "< 20ms end-to-end",
                "other": "Must work across diverse lighting and skin tones.",
            },
        },
        {
            "title": "Plant Disease Detection",
            "description": "Design a mobile-first system that identifies plant diseases from user-submitted photos. The system must handle millions of diverse plant species, provide treatment recommendations, and work efficiently on edge devices or via a cloud API.",
            "difficulty": "Beginner",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "2,000 requests/minute",
                "latencyRequirement": "< 1s for diagnosis",
                "other": "Offline mode support for remote farming areas.",
            },
        },
        {
            "title": "Pose Estimation for Fitness",
            "description": "Design a real-time pose estimation system that tracks a user's form during exercises. The system must identify key body joints, count repetitions, and provide immediate feedback on posture or technique.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "30 fps per user",
                "latencyRequirement": "< 30ms for joint tracking",
                "other": "Must handle significant occlusion (e.g., limbs blocking each other).",
            },
        },
        {
            "title": "Document Scanner and OCR",
            "description": "Design a robust document scanning system that performs perspective correction, enhancement, and high-accuracy OCR on physical documents. The system should handle multi-page PDFs and extract structured data from receipts, invoices, or IDs.",
            "difficulty": "Beginner",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "5,000 pages/hour",
                "latencyRequirement": "< 2s for full page OCR",
                "other": "Support for 50+ languages and cursive handwriting.",
            },
        },
        {
            "title": "Pedestrian Detection for Autonomous Vehicles",
            "description": "Design a safety-critical pedestrian detection system for autonomous driving. The system must fuse data from multiple cameras (RGB, Infrared) and provide 360-degree awareness with near-zero false negatives.",
            "difficulty": "Advanced",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "100 frames/sec (multi-camera)",
                "latencyRequirement": "< 10ms P99",
                "other": "Must operate reliably in extreme weather (fog, heavy rain).",
            },
        },
        {
            "title": "Image Segmentation for Medical Imaging",
            "description": "Design a system that performs precise organ or tumor segmentation from medical scans (MRI, CT). The system must assist radiologists by highlighting areas of interest and calculating volume measurements automatically.",
            "difficulty": "Advanced",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "10 scans/minute",
                "latencyRequirement": "< 15s for 3D segmentation",
                "other": "High dice-coefficient requirement (>0.95) for clinical use.",
            },
        },
        {
            "title": "Emotion Detection System",
            "description": "Design a system that analyzes facial expressions to detect human emotions in real-time. This can be used for customer feedback analysis in retail or monitoring driver fatigue in logistics.",
            "difficulty": "Intermediate",
            "category": "Computer Vision",
            "constraints": {
                "targetQPS": "1,000 requests/sec",
                "latencyRequirement": "< 100ms",
                "other": "Must distinguish between discrete emotions (Joy, Sadness, Anger, Neutral).",
            },
        },
        {
            "title": "Customer Support Chatbot Fine-tuning",
            "description": "Design a system to fine-tune an LLM on proprietary support tickets and product documentation. The system must preserve the brand voice, handle multi-turn conversations, and integrate with a RAG pipeline for grounded answers.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "500 concurrent sessions",
                "latencyRequirement": "< 1s per token generation",
                "other": "Must implement PII masking for training data.",
            },
        },
        {
            "title": "Domain-Specific Code Generator",
            "description": "Design an AI system optimized for generating code in a proprietary or niche DSL. The system must include a verification layer (execution in a sandbox) to ensure generated snippets are syntactically correct and pass baseline tests.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "50 requests/sec",
                "latencyRequirement": "< 5s for full function generation",
                "other": "Must support context-aware completion using user-provided project files.",
            },
        },
        {
            "title": "Medical Diagnosis Assistant",
            "description": "Design a high-precision NLP system to assist doctors by extracting symptoms from patient notes and suggesting potential diagnoses. The system must prioritize explainability and cite specific medical literature for its suggestions.",
            "difficulty": "Advanced",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "10 requests/sec",
                "latencyRequirement": "< 2s for analysis",
                "other": "Requirement for high precision over recall; must be HIPAA compliant.",
            },
        },
        {
            "title": "Legal Document Analyzer",
            "description": "Design a system for lawyers to scan multi-hundred-page legal contracts. It should automatically identify high-risk clauses, calculate contract expiration dates, and flag deviations from standard company templates.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "20 documents/minute",
                "latencyRequirement": "< 10s for initial summary",
                "other": "Must handle extremely long contexts (100k+ tokens).",
            },
        },
        {
            "title": "Personalized Writing Style Adapter",
            "description": "Design a writing assistant that learns a user's unique stylistic traits (vocabulary, sentence structure, tone) from their past writing. It should then rewrite generic text to match that specific persona while maintaining the original meaning.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "100 requests/sec",
                "latencyRequirement": "< 500ms for style transfer",
                "other": "Consistency check to ensure the style doesn't drift during long text generation.",
            },
        },
        {
            "title": "Sentiment Analysis for Product Reviews",
            "description": "Design a large-scale system to perform aspect-based sentiment analysis on millions of E-commerce product reviews. The system must identify specific features (e.g., 'battery life', 'screen quality') and the sentiment associated with each.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "10,000 reviews/sec",
                "latencyRequirement": "< 50ms P99",
                "other": "Must support 20+ languages out-of-the-box.",
            },
        },
        {
            "title": "Technical Documentation Generator",
            "description": "Design a system that automatically generates comprehensive API documentation from source code comments and function signatures. The system must format output in Markdown and suggest code examples for common use cases.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "100 file scans/sec",
                "latencyRequirement": "< 3s for a standard library package",
                "other": "Must handle various docstring formats (Google, NumPy, JSDoc).",
            },
        },
        {
            "title": "Multi-language Translation Fine-tuning",
            "description": "Design a pipeline for fine-tuning machine translation models on specific domains (e.g., Medical or Legal) across 50 language pairs. The system must preserve document formatting (LaTeX, HTML) throughout the translation process.",
            "difficulty": "Intermediate",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000 sentences/sec",
                "latencyRequirement": "< 200ms for inference",
                "other": "Must utilize 'back-translation' to improve performance for low-resource languages.",
            },
        },
        {
            "title": "Resume Screening and Ranking System",
            "description": "Design an automated HR tool that extracts skills, education, and experience from resumes and ranks candidates against a specific job description. The system must mitigate common algorithmic biases found in hiring.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "1,000 resumes/sec",
                "latencyRequirement": "< 1s from upload to rank",
                "other": "Explainability layer for why a candidate was ranked highly.",
            },
        },
        {
            "title": "Educational Content Summarizer",
            "description": "Design a tool that summarizes complex scientific papers or lectures into different educational levels (e.g., 'Summary for a 5th Grader' vs 'Summary for a Grad Student'). It must identify and define key jargon terms automatically.",
            "difficulty": "Beginner",
            "category": "AI/ML",
            "constraints": {
                "targetQPS": "500 requests/min",
                "latencyRequirement": "< 2s",
                "other": "Must generate flashcards based on the summary automatically.",
            },
        },
        {
            "title": "Multi-Agent Customer Support Swarm",
            "description": "Design an enterprise-level customer support system that uses a 'Swarm' of specialized autonomous agents. The system should include a 'Supervisor/Router' agent that triages incoming tickets to specialized agents (e.g., 'Billing Agent', 'Technical Support Agent', 'Retention Agent'). Specialized agents must be able to use tools to look up user data, and the system must include a 'Human-in-the-loop' node for high-stakes decisions like issuing large refunds.",
            "difficulty": "Beginner",
            "category": "AI Agents",
            "constraints": {
                "targetQPS": "1000 concurrent conversations",
                "latencyRequirement": "Initial triage < 2s; Agent response < 5s",
                "other": "Must support cross-agent state sharing and hand-offs without losing context.",
            },
        },
        {
            "title": "Autonomous AI Software Engineer",
            "description": "Design an agentic system that can autonomously fix software bugs. The system should take a GitHub issue as input, explore the codebase using specialized tools (file search, grep, read file), plan a fix using a 'Reasoning Engine', and verify the fix by running tests in a sandbox. It must maintain a 'Deep Memory' of previous attempts and learned patterns to avoid repeating mistakes.",
            "difficulty": "Advanced",
            "category": "AI Agents",
            "constraints": {
                "targetQPS": "Support 50 parallel bug-fix attempts",
                "latencyRequirement": "Reasoning/Planning cycle < 20s",
                "other": "Must implement hard resource limits for the sandbox and a 'Safety Auditor' agent to review code changes before submission.",
            },
        },
        {
            "title": "Real-time Agentic Trading System",
            "description": "Design a high-frequency trading system powered by agents that monitor news, social media sentiment, and market data. Agents must autonomously execute trades via a 'Tool Hub' while adhering to strict risk management protocols. A 'Circuit Breaker' node must be able to instantly revoke tool access if anomalous trading behavior is detected.",
            "difficulty": "Advanced",
            "category": "AI Agents",
            "constraints": {
                "targetQPS": "Analyze 10,000 signals/sec",
                "latencyRequirement": "End-to-end signal-to-trade < 100ms",
                "other": "Must support 'Self-Correction' where agents evaluate their own trade performance in near real-time.",
            },
        },
        {
            "title": "Multi-Agent Research Assistant",
            "description": "Design a collaborative research system where multiple agents work in parallel to synthesize information from massive datasets. Different agents should be assigned to 'Source Gathering' (searching vector stores), 'Fact Checking' (verifying against a Tool Hub), and 'Synthesis' (generating the final report). The system must handle high-volume vector indexing of new research papers in real-time.",
            "difficulty": "Intermediate",
            "category": "AI Agents",
            "constraints": {
                "targetQPS": "Generate 100 reports/hour",
                "latencyRequirement": "Parallel search and synthesis < 1 minute",
                "dataVolume": "Index 1M documents per day",
                "other": "Must implement 'Consensus Reasoning' where multiple agents must agree on a fact before it is included in the report.",
            },
        },
        {
            "title": "AI Personal Health Companion",
            "description": "Design a proactive AI personal assistant that helps users manage their health and wellness. The agent must have 'Long-term Memory' to track historical health trends, use 'Tools' to integrate with wearable devices and meal trackers, and provide 'Proactive Nudges' based on reasoning about user goals and current data. The system must prioritize HIPAA-compliant data handling and reasoning safety.",
            "difficulty": "Intermediate",
            "category": "AI Agents",
            "constraints": {
                "targetQPS": "100,000 active users with data-sync",
                "latencyRequirement": "Proactive nudge generation < 5s",
                "other": "Implementation of 'Privacy Filtering' agents to ensure sensitive data never leaves the encrypted memory store.",
            },
        },
    ]

    for q_data in questions:
        Question.objects.get_or_create(title=q_data["title"], defaults=q_data)
    print("Seeding complete!")


if __name__ == "__main__":
    seed()
