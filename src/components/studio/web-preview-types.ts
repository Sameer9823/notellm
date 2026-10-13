export type WebPreviewResult = {
  embeddable: boolean;
  finalUrl: string;
  error?: string;
  reason?: string;
  title?: string;
  text?: string;
};

export type WebSnapshotResult = {
  imageUrl: string;
};
