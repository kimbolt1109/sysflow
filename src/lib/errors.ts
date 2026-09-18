export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class QuotaError extends AppError {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message, 429);
  }
}

export class DriverError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}
