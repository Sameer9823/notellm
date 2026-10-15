export type EmbeddableResult = true | false | "unknown";

export type WebPreviewResult = {
  embeddable: EmbeddableResult;
  finalUrl: string;
  error?: string;
  reason?: string;
  title?: string;
  text?: string;
};

export type WebSnapshotResult = {
  imageUrl: string;
};
