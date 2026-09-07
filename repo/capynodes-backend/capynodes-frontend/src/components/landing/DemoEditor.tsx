'use client';

import { useCallback, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  getNodeDefinition,
  categoryColors,
  NodeDefinition,
  nodeDefinitions
} from '@/data/node-definitions';
import { nodeTypes } from '@/components/nodes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { useTheme } from 'next-themes';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  MousePointer2,
  Zap
} from 'lucide-react';
import Link from 'next/link';

// Demo nodes to show in sidebar
const DEMO_NODE_TYPES = ['api-endpoint', 'pinecone', 'vllm-server', 's3-storage', 'redis'];

function DemoEditorCanvas() {
  const onDemoDelete = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const [nodes, setNodes] = useState<Node[]>([
    {
      id: 'demo-vllm-server-default',
      type: 'vllm-server',
      position: { x: 350, y: 150 },
      data: {
        label: 'vLLM Server',
        isDemo: true,
        onDemoDelete: onDemoDelete
      },
    },
  ]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [validationResult, setValidationResult] = useState<{ success: boolean; message: string } | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { theme } = useTheme();

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );



  const onConnect = useCallback(
    (params: Connection) => {
      const edgeStyle = {
        stroke: theme === 'dark' ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)',
        strokeWidth: 2
      };
      return setEdges((eds) => addEdge({ ...params, animated: true, style: edgeStyle }, eds));
    },
    [theme]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const addNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const definition = getNodeDefinition(type);
      if (!definition) return;

      const newNode: Node = {
        id: `demo-${type}-${Date.now()}`,
        type,
        position: position || { x: 100, y: 100 },
        data: {
          label: definition?.label,
          isDemo: true,
          onDemoDelete: onDemoDelete
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setValidationResult(null);
    },
    [onDemoDelete]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [screenToFlowPosition, addNode]
  );

  const validateArchitecture = () => {
    // Crude matching for RAG: API -> Pinecone -> vLLM
    const hasApi = nodes.some(n => n.type === 'api-endpoint');
    const hasPinecone = nodes.some(n => n.type === 'pinecone');
    const hasVllm = nodes.some(n => n.type === 'vllm-server');

    if (!hasApi || !hasPinecone || !hasVllm) {
      setValidationResult({
        success: false,
        message: "Missing key components. You need an API Endpoint, Pinecone, and vLLM Server."
      });
      return;
    }

    const apiNode = nodes.find(n => n.type === 'api-endpoint');
    const pineconeNode = nodes.find(n => n.type === 'pinecone');
    const vllmNode = nodes.find(n => n.type === 'vllm-server');

    const connectedToPinecone = edges.some(e => e.source === apiNode?.id && e.target === pineconeNode?.id);
    const connectedToVllm = edges.some(e => e.source === pineconeNode?.id && e.target === vllmNode?.id);

    if (connectedToPinecone && connectedToVllm) {
      setValidationResult({
        success: true,
        message: "Perfect! You've built a basic RAG architecture."
      });
    } else {
      setValidationResult({
        success: false,
        message: "Almost there! Connect API to Pinecone, and Pinecone to vLLM Server."
      });
    }
  };

  const demoNodeDefinitions = nodeDefinitions.filter(d => DEMO_NODE_TYPES.includes(d.type));

  return (
    <div className="flex flex-col md:flex-row h-[650px] md:h-[550px] w-full border border-border rounded-[2rem] overflow-hidden bg-background shadow-2xl relative group/editor font-sans">
      {/* Mini Sidebar */}
      <div className="w-full md:w-52 border-b md:border-b-0 md:border-r border-border bg-muted/20 p-4 md:p-6 flex flex-col gap-4 md:gap-6 z-10">
        <div className="space-y-1 md:space-y-1.5">
          <h4 className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest font-sans">Components</h4>
          <p className="text-[10px] text-muted-foreground leading-tight font-medium hidden md:block">Drag components to the canvas</p>
          <p className="text-[10px] text-muted-foreground leading-tight font-medium md:hidden">Tap to add component</p>
        </div>
        <div className="flex flex-row md:flex-col gap-3 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 scrollbar-hide">
          {demoNodeDefinitions.map((node) => {
            const colors = categoryColors[node.category];
            return (
              <div
                key={node.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', node.type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addNode(node.type)}
                className="flex items-center gap-2 md:gap-3 px-3 py-2 rounded-xl border border-border bg-card cursor-grab hover:border-primary/50 transition-all active:scale-95 group/sidebar-item shrink-0"
              >
                <div className={cn("p-1.5 rounded-lg group-hover:scale-110 transition-transform", colors.bg, colors.text)}>
                  <node.icon size={14} />
                </div>
                <span className="text-[12px] font-bold tracking-tight truncate whitespace-nowrap">{node.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-muted/30 min-h-[400px]">
        <div className="absolute top-4 md:top-6 left-4 md:left-6 z-10 flex flex-col gap-2 md:gap-3 max-w-[calc(100%-2rem)]">
          <Badge variant="outline" className="w-fit bg-background/80 backdrop-blur-sm border-primary/20 text-primary flex gap-2 py-1 px-2 md:py-1.5 md:px-3 rounded-full font-bold text-[9px] md:text-[10px] uppercase tracking-wider">
            <Sparkles className="w-3 h-3 md:w-3.5 md:h-3.5" />
            Interactive Demo
          </Badge>
          <div className="bg-background/80 backdrop-blur-md border border-border p-3 md:p-4 rounded-xl md:rounded-2xl shadow-xl max-w-xs md:max-w-[280px]">
            <p className="text-[11px] md:text-[12px] font-medium leading-relaxed">
              <span className="text-primary font-bold font-display">Challenge:</span> Build a RAG system. Connect <span className="underline underline-offset-4 decoration-primary/30">API Endpoint</span> → <span className="underline underline-offset-4 decoration-primary/30">Pinecone</span> → <span className="underline underline-offset-4 decoration-primary/30">vLLM Server</span>.
            </p>
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)'}
          />
        </ReactFlow>

        {/* Action Button & Feedback */}
        <div className="absolute bottom-6 md:bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-4 md:gap-5 w-full px-4 md:px-8">
          {validationResult && (
            <div className={cn(
              "px-4 py-2 md:px-5 md:py-2.5 rounded-full border text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-2 md:gap-3 animate-in fade-in slide-in-from-bottom-3 backdrop-blur-md shadow-2xl text-center",
              validationResult.success
                ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
            )}>
              {validationResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {validationResult.message}
            </div>
          )}

          <div className="flex gap-3 md:gap-4">
            {!validationResult?.success ? (
              <Button
                onClick={validateArchitecture}
                className="rounded-full shadow-lg px-6 md:px-8 h-10 md:h-12 text-[10px] md:text-xs font-bold uppercase tracking-widest transition-all duration-200 border bg-zinc-950 text-white border-zinc-800 hover:bg-zinc-900 dark:bg-white dark:text-black dark:border-zinc-200 dark:hover:bg-zinc-100 active:scale-[0.98] group"
              >
                Check Architecture
                <Zap size={14} className="ml-2 fill-current group-hover:scale-125 transition-transform" />
              </Button>
            ) : (
              <Button
                asChild
                className="rounded-full shadow-2xl px-8 md:px-10 h-10 md:h-12 bg-green-600 hover:bg-green-700 text-white border-none font-bold uppercase tracking-widest animate-bounce-subtle transition-all hover:scale-105 active:scale-95"
              >
                <Link href="/register">
                  Excellent! Sign Up Now
                  <ArrowRight className="ml-2 w-3.5 h-3.5 md:w-4 md:h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Helper floating mouse icon */}
      {nodes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-4 animate-reveal">
          <div className="p-5 bg-primary/5 rounded-full ring-1 ring-primary/10 animate-pulse">
            <MousePointer2 className="w-8 h-8 text-primary" />
          </div>
          <span className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground/50">Drag a component to start</span>
        </div>
      )}

      <style jsx global>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default function DemoEditor() {
  return (
    <ReactFlowProvider>
      <DemoEditorCanvas />
    </ReactFlowProvider>
  );
}
