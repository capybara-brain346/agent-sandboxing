export type ArtifactPointer = {
  artifactId: string;
  kind: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
  redacted: boolean;
};

export type ArtifactPreview = ArtifactPointer & { preview: string };

export type ArtifactContent = ArtifactPointer & {
  sessionId: string;
  messageId: string | null;
  content: string;
  createdAt: string;
};
