export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
