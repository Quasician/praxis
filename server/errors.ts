/** An error with an HTTP status and a message written for the person using Praxis. */
export class ClaudeError extends Error { constructor(public status: number, msg: string) { super(msg); } }
