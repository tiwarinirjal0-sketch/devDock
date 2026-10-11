/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

/**
 * A deployment failure attributed to a pipeline stage:
 * "extract" | "detection" | "build" | "start" | "cancelled".
 * The message is safe to show to the client.
 */
export class PipelineError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
  }
}
