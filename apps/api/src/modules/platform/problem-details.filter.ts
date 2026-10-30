import { ErrorCode, type ProblemDetails } from '@accordo/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
};

/** Renders every error as RFC 9457 Problem Details with a stable `code`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const problem = toProblem(exception, req.originalUrl);
    if (problem.status >= 500) this.logger.error(exception);
    http
      .getResponse<Response>()
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}

export function toProblem(exception: unknown, instance?: string): ProblemDetails {
  if (exception instanceof ZodError) {
    return {
      type: 'about:blank',
      title: 'Validation failed',
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_FAILED,
      instance,
      errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    // Domain errors pass `{ code, detail }` as the response body to override the default code.
    const custom =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    return {
      type: 'about:blank',
      title: exception.message,
      status,
      code:
        typeof custom.code === 'string'
          ? custom.code
          : (codeByStatus[status] ?? ErrorCode.INTERNAL),
      detail: typeof custom.detail === 'string' ? custom.detail : undefined,
      instance,
    };
  }
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL,
    instance,
  };
}
