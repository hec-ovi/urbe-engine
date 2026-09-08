export class WorldArchiveError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WorldArchiveError';
    this.code = code;
  }
}

export function fail(code, message, cause) {
  throw new WorldArchiveError(code, message, cause);
}
