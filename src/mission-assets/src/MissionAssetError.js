export class MissionAssetError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "MissionAssetError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
