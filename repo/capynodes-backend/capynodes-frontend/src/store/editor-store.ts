import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import type { Question, CreditStatus, CustomNodeDefinition } from '@/lib/api';

export type { Question };

export interface Constraints {
  targetQPS: string;
  latencyRequirement: string;
  monthlyBudget: string;
  dataVolume: string;
  other: string;
}

export interface EvaluationResult {
  overallScore: number;
  breakdown: {
    category: string;
    score: number;
    weight: number;
    explanation: string;
  }[];
  strengths: string[];
  improvements: string[];
  suggestedSolution: string;
  credits?: CreditStatus;
}

export interface ApiSettings {
  provider: 'openai' | 'anthropic' | 'groq' | 'grok';
  apiKey: string;
  model: string;
}

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

interface EditorState {
  // Canvas state
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  
  // History
  history: HistoryState[];
  historyIndex: number;
  
  // Problem state
  problemStatement: string;
  constraints: Constraints;
  questions: Question[];
  customQuestions: Question[];
  currentQuestion: Question | null;
  customNodeDefinitions: CustomNodeDefinition[];
  
  // Evaluation
  evaluationResult: EvaluationResult | null;
  isEvaluating: boolean;
  evaluationError: string | null;
  
  // UI state

  sidebarCollapsed: boolean;
  nodesSidebarCollapsed: boolean;
  propertiesPanelCollapsed: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  sidebarActiveTab: 'platform' | 'custom';
  
  // Credits
  credits: CreditStatus | null;
  creditsLoading: boolean;
  
  // Actions
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  
  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  
  // Problem actions
  setProblemStatement: (statement: string) => void;
  setConstraints: (constraints: Partial<Constraints>) => void;
  fetchQuestions: () => Promise<void>;
  setCurrentQuestion: (question: Question | null) => void;
  addCustomQuestion: (question: Question) => void;
  updateCustomQuestion: (id: number, question: Partial<Question>) => void;
  deleteCustomQuestion: (id: number) => void;
  isQuestionIncomplete: () => boolean;
  
  // Custom Node Definition actions
  fetchCustomNodes: () => Promise<void>;
  addCustomNode: (node: CustomNodeDefinition) => void;
  updateCustomNode: (id: number, node: Partial<CustomNodeDefinition>) => void;
  deleteCustomNode: (id: number) => void;
  
  // Evaluation actions
  setEvaluationResult: (result: EvaluationResult | null) => void;
  setIsEvaluating: (isEvaluating: boolean) => void;
  setEvaluationError: (error: string | null) => void;
  submitForEvaluation: () => Promise<void>;
  fetchCredits: () => Promise<void>;
  setCredits: (credits: CreditStatus) => void;
  
  // UI actions

  setSidebarCollapsed: (collapsed: boolean) => void;
  setNodesSidebarCollapsed: (collapsed: boolean) => void;
  setPropertiesPanelCollapsed: (collapsed: boolean) => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setSidebarActiveTab: (tab: 'platform' | 'custom') => void;
  
  // Save/Load
  exportDiagram: () => { nodes: Node[]; edges: Edge[]; problemStatement: string; constraints: Constraints };
  importDiagram: (data: { nodes: Node[]; edges: Edge[]; problemStatement?: string; constraints?: Constraints }) => void;
  clearDiagram: () => void;
}

const initialConstraints: Constraints = {
  targetQPS: '',
  latencyRequirement: '',
  monthlyBudget: '',
  dataVolume: '',
  other: '',
};

const initialApiSettings: ApiSettings = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o',
};

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      // Initial state
      nodes: [],
      edges: [],
      selectedNodeId: null,
      history: [{ nodes: [], edges: [] }],
      historyIndex: 0,
      problemStatement: '',
      constraints: initialConstraints,
      questions: [],
      customQuestions: [],
      currentQuestion: null,
      customNodeDefinitions: [],
      evaluationResult: null,
      isEvaluating: false,
      evaluationError: null,

      sidebarCollapsed: false,
      nodesSidebarCollapsed: false,
      propertiesPanelCollapsed: true,
      leftSidebarWidth: 288,
      rightSidebarWidth: 288,
      sidebarActiveTab: 'platform',
      credits: null,
      creditsLoading: false,
      
      // Node/Edge actions
      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),
      
      onNodesChange: (changes) => {
        set({
          nodes: applyNodeChanges(changes, get().nodes),
        });
      },
      
      onEdgesChange: (changes) => {
        set({
          edges: applyEdgeChanges(changes, get().edges),
        });
      },
      
      onConnect: (connection) => {
        set({
          edges: addEdge(
            { ...connection, type: 'smoothstep', animated: true },
            get().edges
          ),
        });
        get().pushHistory();
      },
      
      addNode: (node) => {
        set({ nodes: [...get().nodes, node] });
        get().pushHistory();
      },
      
      updateNodeData: (nodeId, data) => {
        set({
          nodes: get().nodes.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, ...data } }
              : node
          ),
        });
        get().pushHistory();
      },
      
      deleteNode: (nodeId) => {
        set({
          nodes: get().nodes.filter((node) => node.id !== nodeId),
          edges: get().edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId
          ),
          selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
        });
        get().pushHistory();
      },
      
      deleteEdge: (edgeId) => {
        set({
          edges: get().edges.filter((edge) => edge.id !== edgeId),
        });
        get().pushHistory();
      },
      
      duplicateNode: (nodeId) => {
        const node = get().nodes.find((n) => n.id === nodeId);
        if (node) {
          const newNode: Node = {
            ...node,
            id: `${node.type}-${Date.now()}`,
            position: {
              x: node.position.x + 50,
              y: node.position.y + 50,
            },
            selected: false,
          };
          set({ nodes: [...get().nodes, newNode] });
          get().pushHistory();
        }
      },
      
      setSelectedNodeId: (id) => set({ selectedNodeId: id, propertiesPanelCollapsed: id === null }),
      
      // History actions
      pushHistory: () => {
        const { nodes, edges, history, historyIndex } = get();
        // Don't push if the state is the same as the current history state
        const currentState = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
        const lastHistoryState = history[historyIndex];
        
        if (lastHistoryState && 
            JSON.stringify(lastHistoryState.nodes) === JSON.stringify(currentState.nodes) && 
            JSON.stringify(lastHistoryState.edges) === JSON.stringify(currentState.edges)) {
          return;
        }

        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(currentState);
        // Keep only last 50 states
        if (newHistory.length > 50) newHistory.shift();
        set({ history: newHistory, historyIndex: newHistory.length - 1 });
      },
      
      undo: () => {
        const { historyIndex, history } = get();
        if (historyIndex > 0) {
          const prevState = JSON.parse(JSON.stringify(history[historyIndex - 1]));
          set({
            nodes: prevState.nodes,
            edges: prevState.edges,
            historyIndex: historyIndex - 1,
          });
        }
      },
      
      redo: () => {
        const { historyIndex, history } = get();
        if (historyIndex < history.length - 1) {
          const nextState = JSON.parse(JSON.stringify(history[historyIndex + 1]));
          set({
            nodes: nextState.nodes,
            edges: nextState.edges,
            historyIndex: historyIndex + 1,
          });
        }
      },
      
      // Problem actions
      setProblemStatement: (statement) => set({ problemStatement: statement }),
      setConstraints: (constraints) =>
        set({ constraints: { ...get().constraints, ...constraints } }),
      
      fetchQuestions: async () => {
        try {
          const { apiClient } = await import('@/lib/api');
          const data = await apiClient.getQuestions(1, 100);
          set({ questions: data.results || [] });
        } catch (error) {
          console.error('Error fetching questions:', error);
          set({ questions: [] });
        }
      },

      setCurrentQuestion: (question) => {
        if (!question) {
          set({ 
            currentQuestion: null, 
            problemStatement: '', 
            constraints: initialConstraints,
            nodes: [],
            edges: [],
            evaluationResult: null
          });
          return;
        }
        
        const transformedConstraints: Constraints = {
          targetQPS: question.constraints?.qps || question.constraints?.targetQPS || '',
          latencyRequirement: question.constraints?.latency || question.constraints?.latencyRequirement || '',
          monthlyBudget: question.constraints?.budget || question.constraints?.monthlyBudget || '',
          dataVolume: question.constraints?.dataVolume || '',
          other: question.constraints?.other || '',
        };
        
        const isSameQuestion = get().currentQuestion?.id === question.id;
        
        set({ 
          currentQuestion: question, 
          problemStatement: question.description, 
          constraints: transformedConstraints,
          nodes: isSameQuestion ? get().nodes : [],
          edges: isSameQuestion ? get().edges : [],
          evaluationResult: isSameQuestion ? get().evaluationResult : null
        });
      },

      addCustomQuestion: (question) => {
        set((state) => ({
          customQuestions: [...state.customQuestions, question]
        }));
      },

      updateCustomQuestion: (id, updatedQuestion) => {
        set((state) => ({
          customQuestions: state.customQuestions.map((q) => 
            q.id === id ? { ...q, ...updatedQuestion } : q
          ),
          currentQuestion: state.currentQuestion?.id === id 
            ? { ...state.currentQuestion, ...updatedQuestion } 
            : state.currentQuestion
        }));
      },

      deleteCustomQuestion: (id) => {
        set((state) => ({
          customQuestions: state.customQuestions.filter((q) => q.id !== id),
          currentQuestion: state.currentQuestion?.id === id ? null : state.currentQuestion
        }));
      },

      isQuestionIncomplete: () => {
        const state = get();
        const { currentQuestion } = state;
        if (!currentQuestion) return true;
        
        if (currentQuestion.id <= 0) {
          return (
            !currentQuestion.title?.trim() ||
            !currentQuestion.description?.trim() ||
            !currentQuestion.constraints?.targetQPS?.trim() ||
            !currentQuestion.constraints?.latencyRequirement?.trim() ||
            !currentQuestion.constraints?.monthlyBudget?.trim() ||
            !currentQuestion.constraints?.dataVolume?.trim() ||
            !currentQuestion.constraints?.other?.trim()
          );
        }
        
        return false;
      },

      fetchCustomNodes: async () => {
        try {
          const { apiClient } = await import('@/lib/api');
          const data = await apiClient.getCustomNodes();
          set({ customNodeDefinitions: data || [] });
        } catch (error) {
          console.error('Error fetching custom nodes:', error);
          set({ customNodeDefinitions: [] });
        }
      },

      addCustomNode: (node) => {
        set((state) => ({
          customNodeDefinitions: [...state.customNodeDefinitions, node]
        }));
      },

      updateCustomNode: (id, updatedNode) => {
        set((state) => ({
          customNodeDefinitions: state.customNodeDefinitions.map((n) => 
            n.id === id ? { ...n, ...updatedNode } : n
          )
        }));
      },

      deleteCustomNode: (id) => {
        set((state) => ({
          customNodeDefinitions: state.customNodeDefinitions.filter((n) => n.id !== id)
        }));
      },

      // Evaluation actions
      setEvaluationResult: (result) => set({ evaluationResult: result }),
      setIsEvaluating: (isEvaluating) => set({ isEvaluating }),
      setEvaluationError: (error) => set({ evaluationError: error }),
      
      submitForEvaluation: async () => {
        const { currentQuestion, nodes, edges } = get();
        if (!currentQuestion) {
          set({ evaluationError: 'Please select a question first.' });
          return;
        }
        
        set({ isEvaluating: true, evaluationError: null });
        
        try {
          const { apiClient } = await import('@/lib/api');
          const isCustom = currentQuestion.id <= 0;
          
          const result = await apiClient.submitEvaluation({
            questionId: isCustom ? 0 : currentQuestion.id,
            nodes,
            edges,
            customQuestion: isCustom ? {
              title: currentQuestion.title,
              description: currentQuestion.description,
              constraints: currentQuestion.constraints,
              difficulty: currentQuestion.difficulty,
            } : undefined
          });
          
          set({ 
            evaluationResult: result, 
            isEvaluating: false,
            credits: result.credits || get().credits // Update credits from result if available
          });
        } catch (error) {
          set({ 
            evaluationError: error instanceof Error ? error.message : 'An unknown error occurred', 
            isEvaluating: false 
          });
        }
      },

      fetchCredits: async () => {
        set({ creditsLoading: true });
        try {
          const { apiClient } = await import('@/lib/api');
          const credits = await apiClient.getCreditStatus();
          set({ credits, creditsLoading: false });
        } catch (error) {
          console.error('Error fetching credits:', error);
          set({ creditsLoading: false });
        }
      },

      setCredits: (credits) => set({ credits }),
      
      // UI actions

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setNodesSidebarCollapsed: (collapsed) => set({ nodesSidebarCollapsed: collapsed }),
      setPropertiesPanelCollapsed: (collapsed) => set({ propertiesPanelCollapsed: collapsed }),
      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: Math.max(200, Math.min(600, width)) }),
      setRightSidebarWidth: (width) => set({ rightSidebarWidth: Math.max(200, Math.min(600, width)) }),
      setSidebarActiveTab: (tab) => set({ sidebarActiveTab: tab }),
      
      // Save/Load
      exportDiagram: () => ({
        nodes: get().nodes,
        edges: get().edges,
        problemStatement: get().problemStatement,
        constraints: get().constraints,
      }),
      
      importDiagram: (data) => {
        set({
          nodes: data.nodes,
          edges: data.edges,
          problemStatement: data.problemStatement || '',
          constraints: data.constraints || initialConstraints,
        });
        get().pushHistory();
      },
      
      clearDiagram: () => {
        set({
          nodes: [],
          edges: [],
          selectedNodeId: null,
          evaluationResult: null,
        });
        get().pushHistory();
      },
    }),
    {
      name: 'ai-design-editor-storage',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        problemStatement: state.problemStatement,
        constraints: state.constraints,

        currentQuestion: state.currentQuestion,
        customQuestions: state.customQuestions,
        customNodeDefinitions: state.customNodeDefinitions,
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
      }),
    }
  )
);
