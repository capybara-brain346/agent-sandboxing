import BaseNode from './BaseNode';
import { nodeDefinitions } from '@/data/node-definitions';

// Create a nodeTypes object for React Flow
// All custom nodes use the same BaseNode component, which reads type from props
export const nodeTypes = nodeDefinitions.reduce(
  (acc, node) => {
    acc[node.type] = BaseNode;
    return acc;
  },
  {} as Record<string, typeof BaseNode>
);

export { BaseNode };
